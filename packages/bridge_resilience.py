"""
packages/bridge_resilience.py - Standalone bridge-call enforcement for aipass-web-bridge.

All outbound bridge calls in this package MUST import and use this module.
Covers: timeout, retry with backoff, circuit-breaker, and fail-closed defaults.
"""
from __future__ import annotations

import asyncio
import functools
import inspect
import logging
import time
from typing import Any, Callable, Dict, Optional, Tuple, TypeVar

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fail-closed defaults
# ---------------------------------------------------------------------------
DEFAULT_TIMEOUT_S: float = 30.0
DEFAULT_MAX_RETRIES: int = 3
DEFAULT_BACKOFF_BASE_S: float = 1.0
DEFAULT_BACKOFF_MULTIPLIER: float = 2.0
DEFAULT_RETRY_AFTER_CAP_S: float = 600.0
SKIP_RETRY_ON_STATUS: Tuple[int, ...] = (422, 404, 409, 401)

try:
    import requests as _requests  # noqa: F401
    _REQUESTS_EXC: Tuple[type, ...] = (
        _requests.Timeout,
        _requests.ConnectionError,
        _requests.HTTPError,
    )
except ImportError:
    _REQUESTS_EXC = ()

DEFAULT_EXPECTED_EXCEPTIONS: Tuple[type, ...] = (
    ConnectionError,
    TimeoutError,
) + _REQUESTS_EXC

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Circuit breaker (embedded for standalone use)
# ---------------------------------------------------------------------------
class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        timeout: int = 60,
        expected_exception: tuple = (Exception,),
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.expected_exception = expected_exception
        self.failure_count = 0
        self.state = "closed"
        self.last_failure_time: Optional[float] = None
        self._success_count = 0

    @property
    def is_open(self) -> bool:
        if self.state == "open":
            if self._should_attempt_reset():
                self.state = "half_open"
                logger.info(f"Circuit breaker '{self.name}' → HALF_OPEN")
                return False
            return True
        return False

    def record_success(self):
        self.failure_count = 0
        self._success_count += 1
        if self.state == "half_open":
            logger.info(f"Circuit breaker '{self.name}' → CLOSED (recovered)")
        self.state = "closed"

    def record_failure(self, exc: Optional[Exception] = None):
        self.failure_count += 1
        self.last_failure_time = time.monotonic()
        if self.failure_count >= self.failure_threshold:
            self.state = "open"
            self._success_count = 0
            logger.error(f"Circuit breaker '{self.name}' → OPEN")

    def _should_attempt_reset(self) -> bool:
        if self.last_failure_time is None:
            return False
        return (time.monotonic() - self.last_failure_time) >= self.timeout


_BREAKERS: Dict[str, CircuitBreaker] = {}


def get_breaker(name: str) -> CircuitBreaker:
    if name not in _BREAKERS:
        _BREAKERS[name] = CircuitBreaker(
            name=name,
            failure_threshold=3,
            timeout=60,
            expected_exception=(ConnectionError, TimeoutError, Exception),
        )
    return _BREAKERS[name]


# ---------------------------------------------------------------------------
# Retry configuration
# ---------------------------------------------------------------------------
class RetryConfig:
    def __init__(
        self,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_base_s: float = DEFAULT_BACKOFF_BASE_S,
        backoff_multiplier: float = DEFAULT_BACKOFF_MULTIPLIER,
        respect_retry_after: bool = True,
        retry_after_cap_s: float = DEFAULT_RETRY_AFTER_CAP_S,
        skip_retry_on_status: Tuple[int, ...] = SKIP_RETRY_ON_STATUS,
    ) -> None:
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self.backoff_multiplier = backoff_multiplier
        self.respect_retry_after = respect_retry_after
        self.retry_after_cap_s = retry_after_cap_s
        self.skip_retry_on_status = skip_retry_on_status

    def next_backoff_s(
        self, attempt: int, retry_after_s: Optional[float] = None
    ) -> float:
        if retry_after_s is not None and self.respect_retry_after:
            return min(retry_after_s, self.retry_after_cap_s)
        return self.backoff_base_s * (self.backoff_multiplier ** attempt)

    def should_retry(
        self,
        attempt: int,
        status_code: Optional[int],
        exc: Optional[Exception],
    ) -> bool:
        if attempt >= self.max_retries:
            return False
        if status_code is not None and int(status_code) in self.skip_retry_on_status:
            return False
        return True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _extract_status_code(exc: Exception) -> Optional[int]:
    status = getattr(exc, "status_code", None)
    if status is not None:
        return int(status)
    response = getattr(exc, "response", None)
    if response is not None:
        status = getattr(response, "status_code", None)
        if status is not None:
            return int(status)
    return None


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------
class BridgeCallError(Exception):
    """Raised when a bridge call fails after all retries or is blocked."""


# ---------------------------------------------------------------------------
# Core enforcement decorator
# ---------------------------------------------------------------------------
def with_bridge_resilience(
    bridge_name: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff_base_s: float = DEFAULT_BACKOFF_BASE_S,
    backoff_multiplier: float = DEFAULT_BACKOFF_MULTIPLIER,
    fail_closed: bool = True,
    retry_cfg: Optional[RetryConfig] = None,
    expected_exceptions: Tuple[type, ...] = DEFAULT_EXPECTED_EXCEPTIONS,
    breaker: Optional[CircuitBreaker] = None,
) -> Callable[..., Any]:
    """
    Decorator that enforces timeout, retry, and circuit-breaker on a bridge call.

    Works for both sync and async functions.  Non-network exceptions propagate
    immediately without retry or circuit recording.
    """
    cfg = retry_cfg or RetryConfig(
        max_retries=max_retries,
        backoff_base_s=backoff_base_s,
        backoff_multiplier=backoff_multiplier,
    )
    breaker = breaker or get_breaker(f"bridge:{bridge_name}")

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                if breaker.is_open:
                    msg = f"circuit_open — bridge '{bridge_name}' is in cooldown"
                    logger.error(msg)
                    raise BridgeCallError(msg)

                last_exc: Optional[Exception] = None
                last_status: Optional[int] = None

                for attempt in range(cfg.max_retries + 1):
                    try:
                        result = await asyncio.wait_for(
                            func(*args, **kwargs),
                            timeout=timeout_s,
                        )
                        breaker.record_success()
                        return result
                    except Exception as exc:
                        if not isinstance(exc, expected_exceptions):
                            raise
                        last_exc = exc
                        last_status = _extract_status_code(exc)
                        logger.warning(
                            f"[Bridge:{bridge_name}] exception: {exc} "
                            f"(attempt {attempt + 1}/{cfg.max_retries + 1})"
                        )
                        breaker.record_failure(exc)
                        if not cfg.should_retry(attempt, last_status, exc):
                            break
                        await asyncio.sleep(cfg.next_backoff_s(attempt))

                msg = (
                    f"bridge '{bridge_name}' failed after "
                    f"{cfg.max_retries + 1} attempts: {last_exc}"
                )
                logger.error(msg)
                raise BridgeCallError(msg) from last_exc

            return async_wrapper

        else:

            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                if breaker.is_open:
                    msg = f"circuit_open — bridge '{bridge_name}' is in cooldown"
                    logger.error(msg)
                    raise BridgeCallError(msg)

                last_exc: Optional[Exception] = None
                last_status: Optional[int] = None

                for attempt in range(cfg.max_retries + 1):
                    try:
                        result = func(*args, **kwargs)
                        breaker.record_success()
                        return result
                    except Exception as exc:
                        if not isinstance(exc, expected_exceptions):
                            raise
                        last_exc = exc
                        last_status = _extract_status_code(exc)
                        logger.warning(
                            f"[Bridge:{bridge_name}] exception: {exc} "
                            f"(attempt {attempt + 1}/{cfg.max_retries + 1})"
                        )
                        breaker.record_failure(exc)
                        if not cfg.should_retry(attempt, last_status, exc):
                            break
                        time.sleep(cfg.next_backoff_s(attempt))

                msg = (
                    f"bridge '{bridge_name}' failed after "
                    f"{cfg.max_retries + 1} attempts: {last_exc}"
                )
                logger.error(msg)
                raise BridgeCallError(msg) from last_exc

            return sync_wrapper

    return decorator


# ---------------------------------------------------------------------------
# Direct-call wrappers (when decorators are inconvenient)
# ---------------------------------------------------------------------------
def enforce(
    bridge_name: str,
    func: Callable[..., T],
    *args: Any,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_retries: int = DEFAULT_MAX_RETRIES,
    fail_closed: bool = True,
    retry_cfg: Optional[RetryConfig] = None,
    expected_exceptions: Tuple[type, ...] = DEFAULT_EXPECTED_EXCEPTIONS,
    **kwargs: Any,
) -> T:
    """Direct-call wrapper for sync bridge functions."""
    wrapped = with_bridge_resilience(
        bridge_name,
        timeout_s=timeout_s,
        max_retries=max_retries,
        fail_closed=fail_closed,
        retry_cfg=retry_cfg,
        expected_exceptions=expected_exceptions,
    )(func)
    return wrapped(*args, **kwargs)


async def enforce_async(
    bridge_name: str,
    func: Callable[..., Any],
    *args: Any,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_retries: int = DEFAULT_MAX_RETRIES,
    fail_closed: bool = True,
    retry_cfg: Optional[RetryConfig] = None,
    expected_exceptions: Tuple[type, ...] = DEFAULT_EXPECTED_EXCEPTIONS,
    **kwargs: Any,
) -> Any:
    """Async version of enforce()."""
    wrapped = with_bridge_resilience(
        bridge_name,
        timeout_s=timeout_s,
        max_retries=max_retries,
        fail_closed=fail_closed,
        retry_cfg=retry_cfg,
        expected_exceptions=expected_exceptions,
    )(func)
    return await wrapped(*args, **kwargs)
