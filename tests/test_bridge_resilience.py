"""
Unit tests for packages/bridge_resilience.py
Tests circuit breaker, retry configuration with backoff, and sync/async wrappers.
Uses standard library unittest for zero-dependency execution across CI runners.
"""
import asyncio
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from packages.bridge_resilience import (
    CircuitBreaker,
    RetryConfig,
    BridgeCallError,
    with_bridge_resilience,
    enforce,
    enforce_async,
)


class TestBridgeResilience(unittest.TestCase):
    def test_circuit_breaker_lifecycle(self):
        breaker = CircuitBreaker("test-service", failure_threshold=2, timeout=1)
        self.assertFalse(breaker.is_open)
        self.assertEqual(breaker.state, "closed")

        # 1 failure: still closed
        breaker.record_failure(ConnectionError("fail 1"))
        self.assertFalse(breaker.is_open)
        self.assertEqual(breaker.state, "closed")

        # 2 failures: opens
        breaker.record_failure(ConnectionError("fail 2"))
        self.assertTrue(breaker.is_open)
        self.assertEqual(breaker.state, "open")

        # Before timeout: still open
        self.assertTrue(breaker.is_open)

        # Simulate timeout elapsed
        breaker.last_failure_time = time.monotonic() - 2.0
        # Next check transitions to half_open
        self.assertFalse(breaker.is_open)
        self.assertEqual(breaker.state, "half_open")

        # Success in half_open resets to closed
        breaker.record_success()
        self.assertEqual(breaker.state, "closed")
        self.assertFalse(breaker.is_open)

    def test_retry_config(self):
        cfg = RetryConfig(
            max_retries=3,
            backoff_base_s=0.1,
            backoff_multiplier=2.0,
            skip_retry_on_status=(401, 404, 422),
        )
        # Exponential backoff
        self.assertAlmostEqual(cfg.next_backoff_s(0), 0.1)
        self.assertAlmostEqual(cfg.next_backoff_s(1), 0.2)
        self.assertAlmostEqual(cfg.next_backoff_s(2), 0.4)

        # Retry-After header respect
        self.assertEqual(cfg.next_backoff_s(0, retry_after_s=5.0), 5.0)

        # Should retry logic
        self.assertTrue(cfg.should_retry(0, 500, None))
        self.assertTrue(cfg.should_retry(1, 503, None))
        self.assertFalse(cfg.should_retry(3, 500, None))  # max_retries reached
        self.assertFalse(cfg.should_retry(0, 401, None))  # skipped status
        self.assertFalse(cfg.should_retry(0, 422, None))  # skipped status

    def test_sync_enforcement_success(self):
        mock_func = MagicMock(return_value={"status": "ok"})
        res = enforce(
            "test-bridge-sync",
            mock_func,
            "arg1",
            timeout_s=5.0,
            max_retries=2,
        )
        self.assertEqual(res, {"status": "ok"})
        self.assertEqual(mock_func.call_count, 1)

    def test_sync_enforcement_retry_then_success(self):
        breaker = CircuitBreaker("test-retry-sync", failure_threshold=5, timeout=10)
        mock_func = MagicMock(side_effect=[ConnectionError("temp fail"), {"result": "recovered"}])

        @with_bridge_resilience(
            "test-retry-sync",
            timeout_s=2.0,
            max_retries=2,
            backoff_base_s=0.01,
            breaker=breaker,
        )
        def call():
            return mock_func()

        res = call()
        self.assertEqual(res, {"result": "recovered"})
        self.assertEqual(mock_func.call_count, 2)
        self.assertEqual(breaker.state, "closed")

    def test_sync_enforcement_exhausted_raises_bridge_error(self):
        breaker = CircuitBreaker("test-exhaust-sync", failure_threshold=5, timeout=10)
        mock_func = MagicMock(side_effect=ConnectionError("fatal connection failure"))

        @with_bridge_resilience(
            "test-exhaust-sync",
            timeout_s=2.0,
            max_retries=2,
            backoff_base_s=0.01,
            breaker=breaker,
        )
        def call():
            return mock_func()

        with self.assertRaises(BridgeCallError) as cm:
            call()

        self.assertIn("failed after 3 attempts", str(cm.exception))
        self.assertEqual(mock_func.call_count, 3)

    def test_sync_enforcement_circuit_open(self):
        breaker = CircuitBreaker("test-circuit-open", failure_threshold=1, timeout=60)
        breaker.record_failure(ConnectionError("initial error"))
        self.assertTrue(breaker.is_open)

        mock_func = MagicMock()

        @with_bridge_resilience("test-circuit-open", breaker=breaker)
        def call():
            return mock_func()

        with self.assertRaises(BridgeCallError) as cm:
            call()

        self.assertIn("circuit_open", str(cm.exception))
        mock_func.assert_not_called()

    def test_async_enforcement_success(self):
        async def mock_async(param: str):
            await asyncio.sleep(0.01)
            return f"async-{param}"

        res = asyncio.run(enforce_async(
            "test-bridge-async",
            mock_async,
            "hello",
            timeout_s=2.0,
            max_retries=1,
        ))
        self.assertEqual(res, "async-hello")

    def test_async_enforcement_retry_and_exhaust(self):
        calls = 0

        async def mock_failing():
            nonlocal calls
            calls += 1
            raise TimeoutError("upstream timeout")

        with self.assertRaises(BridgeCallError) as cm:
            asyncio.run(enforce_async(
                "test-async-exhaust",
                mock_failing,
                timeout_s=1.0,
                max_retries=2,
                retry_cfg=RetryConfig(max_retries=2, backoff_base_s=0.01),
            ))

        self.assertIn("upstream timeout", str(cm.exception))
        self.assertEqual(calls, 3)


if __name__ == "__main__":
    unittest.main()
