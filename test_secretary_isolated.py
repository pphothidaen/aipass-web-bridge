#!/usr/bin/env python3
"""
Isolated local tests for Secretary capabilities C9, C12-C14, C17.

- C9  : should_consult routing decision
- C12 : skill reuse (load_skill + workflow reuse, including no-duplicate-save)
- C13 : skill save (only on verified success, never for reused skills)
- C14 : plan execution + automated verification (real shell, temp sandbox)
- C17 : self-heal loop (max attempts, structured degradation, malformed output)

Rules honored by this suite:
- No network access: all consultant/bridge interactions are function-level mocks.
- All file I/O happens inside temporary directories.
- Deliberately does NOT reuse test_secretary.py's env-var "mock" (it mutates
  os.environ after import and can still reach the configured bridge).
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parent

# Isolate logging BEFORE importing secretary
_TEST_LOG_DIR = Path(tempfile.mkdtemp(prefix="secretary-iso-logs-"))
os.environ["SECRETARY_LOG_DIR"] = str(_TEST_LOG_DIR)

sys.path.insert(0, str(PROJECT_ROOT))
import secretary  # noqa: E402


def _make_skill(request: str, plan: dict) -> dict:
    return {
        "request": request,
        "plan": plan,
        "execution_meta": {"verification_passed": True},
        "created_at": "2026-09-10T00:00:00Z",
        "version": 1,
    }


class SecretaryIsolatedTestCase(unittest.TestCase):
    """Base: temp sandbox dirs, module attributes restored after each test."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="secretary-iso-"))
        self.skills_dir = self.tmp / "skills"
        self.skills_dir.mkdir()
        self._saved = {
            name: getattr(secretary, name)
            for name in ("SKILLS_DIR", "gather_context", "call_consultant",
                         "self_heal", "MAX_HEAL_ATTEMPTS",
                         "ACTIVE_CONSULTANT_MODEL", "ACTIVE_PRIMARY_BRAIN_MODEL")
        }
        secretary.SKILLS_DIR = self.skills_dir
        # Default: context gathering is fully mocked (no curl, no uname)
        self.context = {
            "request": "test", "cwd": str(self.tmp), "python_version": "3.x",
            "os_info": "test", "relevant_files": [], "timestamp": "test",
            "bridge_available": False,
        }
        secretary.gather_context = mock.Mock(return_value=self.context)
        secretary.call_consultant = mock.Mock(return_value=None)
        secretary.self_heal = mock.Mock(return_value=None)

    def tearDown(self):
        for name, value in self._saved.items():
            setattr(secretary, name, value)
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)
        shutil.rmtree(_TEST_LOG_DIR, ignore_errors=True)


# ============================================================
# C9 — should_consult routing
# ============================================================
class TestC9ShouldConsult(SecretaryIsolatedTestCase):

    CASES = [
        ("สร้างไฟล์ hello.txt", False, "Thai CREATE direct file op"),
        ("ลบไฟล์ data.txt", False, "Thai DELETE direct file op"),
        ("แก้ไขไฟล์ config.json เป็นใหม่", False, "Thai UPDATE direct file op"),
        ("ออกแบบสถาปัตยกรรมระบบใหม่", True, "Thai design work"),
        ("วางแผน deploy ระบบ", True, "Thai planning work"),
        ("วิธีที่ดีที่สุดในการ optimize query", True, "Thai advisory work"),
        ("build new feature", True, "build work"),
        ("debug production issue", True, "debug work"),
    ]

    def test_routing_decisions(self):
        for request, expected, desc in self.CASES:
            with self.subTest(desc=desc, request=request):
                self.assertEqual(secretary.should_consult(request), expected)


# ============================================================
# C12 — skill reuse
# ============================================================
class TestC12SkillReuse(SecretaryIsolatedTestCase):

    def test_load_skill_matches_saved_request(self):
        request = f"สร้างไฟล์ {self.tmp}/hello.txt พร้อมข้อความ Hello"
        plan = {"plan": [{"step": 1, "action": request,
                          "command_hint": f"mkdir -p {self.tmp} && echo 'Hello' > '{self.tmp}/hello.txt'",
                          "is_file_operation": True}]}
        (self.skills_dir / "saved.json").write_text(
            json.dumps(_make_skill(request, plan), ensure_ascii=False), encoding="utf-8")

        loaded = secretary.load_skill(request)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["request"], request)

    def test_load_skill_returns_none_for_unrelated_request(self):
        request = f"สร้างไฟล์ {self.tmp}/hello.txt พร้อมข้อความ Hello"
        other = f"ลบไฟล์ {self.tmp}/other.txt"
        plan = {"plan": [{"step": 1, "action": other, "command_hint": "true"}]}
        (self.skills_dir / "saved.json").write_text(
            json.dumps(_make_skill(other, plan), ensure_ascii=False), encoding="utf-8")
        self.assertIsNone(secretary.load_skill(request))

    def test_workflow_reuses_skill_without_consulting_and_without_duplicate_save(self):
        """The reuse path must not consult and must not save a duplicate skill."""
        request = f"สร้างไฟล์ {self.tmp}/hello.txt พร้อมข้อความ Hello"
        plan = {"goal": request,
                "plan": [{"step": 1, "action": request,
                          "command_hint": f"mkdir -p {self.tmp} && echo 'Hello' > '{self.tmp}/hello.txt'",
                          "expected_outcome": "File created", "is_file_operation": True}]}
        (self.skills_dir / "saved.json").write_text(
            json.dumps(_make_skill(request, plan), ensure_ascii=False), encoding="utf-8")

        result = secretary.run_secrets_workflow(request, cwd=str(self.tmp))

        self.assertEqual(result["status"], "success")
        self.assertTrue(result["skill_reused"])
        self.assertFalse(result["skill_saved"])
        secretary.call_consultant.assert_not_called()
        secretary.self_heal.assert_not_called()
        # Duplicate-save regression: exactly one skill file remains
        self.assertEqual(len(list(self.skills_dir.glob("*.json"))), 1)
        self.assertTrue((self.tmp / "hello.txt").exists())


# ============================================================
# C13 — skill save
# ============================================================
class TestC13SkillSave(SecretaryIsolatedTestCase):

    def test_save_successful_skill_requires_verified_success(self):
        plan = {"plan": [{"step": 1, "action": "x", "command_hint": "true"}]}
        execution = {"status": "success", "completed_steps": [{"step": 1, "success": True}]}
        path = secretary.save_successful_skill("req", plan, execution, {"verified": True})
        self.assertIsNotNone(path)
        self.assertTrue(Path(path).exists())

        path2 = secretary.save_successful_skill("req", plan, execution, {"verified": False})
        self.assertIsNone(path2)
        path3 = secretary.save_successful_skill(
            "req", plan, {"status": "partial_failure"}, {"verified": True})
        self.assertIsNone(path3)
        # Only the one verified+successful save exists
        self.assertEqual(len(list(self.skills_dir.glob("*.json"))), 1)

    def test_workflow_saves_consultant_plan_on_verified_success(self):
        request = f"create file {self.tmp}/fresh.txt with content SavedSkill"
        consultant_plan = {
            "goal": request,
            "plan": [{"step": 1, "action": request,
                      "command_hint": f"mkdir -p {self.tmp} && echo 'SavedSkill' > '{self.tmp}/fresh.txt'",
                      "expected_outcome": "File created", "is_file_operation": True}],
        }
        secretary.call_consultant = mock.Mock(return_value=consultant_plan)
        # Force the routing decision to consult regardless of keyword heuristics
        with mock.patch.object(secretary, "should_consult", return_value=True):
            result = secretary.run_secrets_workflow(request, cwd=str(self.tmp))

        self.assertEqual(result["status"], "success")
        self.assertTrue(result["skill_saved"])
        self.assertFalse(result["skill_reused"])
        secretary.call_consultant.assert_called_once()
        self.assertEqual(len(list(self.skills_dir.glob("*.json"))), 1)
        self.assertTrue((self.tmp / "fresh.txt").exists())


# ============================================================
# C14 — execution + automated verification (real shell, temp sandbox)
# ============================================================
class TestC14ExecutionVerification(SecretaryIsolatedTestCase):

    def test_execute_and_verify_create(self):
        target = self.tmp / "created.txt"
        plan = {"plan": [{"step": 1, "action": f"Create file {target}",
                          "command_hint": f"echo 'data' > '{target}'",
                          "is_file_operation": True}]}
        execution = secretary.execute_plan(plan, str(self.tmp))
        self.assertEqual(execution["status"], "success")

        verification = secretary.verify_execution_result(plan, execution, str(self.tmp))
        self.assertTrue(verification["verified"], msg=str(verification["failures"]))
        self.assertTrue(target.exists())

    def test_execute_and_verify_delete(self):
        target = self.tmp / "gone.txt"
        target.write_text("bye", encoding="utf-8")
        plan = {"plan": [{"step": 1, "action": f"Delete file {target}",
                          "command_hint": f"rm -f '{target}'",
                          "is_file_operation": True}]}
        execution = secretary.execute_plan(plan, str(self.tmp))
        self.assertEqual(execution["status"], "success")

        verification = secretary.verify_execution_result(plan, execution, str(self.tmp))
        self.assertTrue(verification["verified"], msg=str(verification["failures"]))
        self.assertFalse(target.exists())

    def test_verify_detects_missing_file_after_create(self):
        target = self.tmp / "never.txt"
        plan = {"plan": [{"step": 1, "action": f"Create file {target}",
                          "command_hint": "true",  # does NOT create the file
                          "is_file_operation": True}]}
        execution = secretary.execute_plan(plan, str(self.tmp))
        self.assertEqual(execution["status"], "success")  # command succeeded...

        verification = secretary.verify_execution_result(plan, execution, str(self.tmp))
        self.assertFalse(verification["verified"])  # ...but verification catches it
        self.assertTrue(any(f["type"] == "file_not_found_after_create"
                            for f in verification["failures"]))

    def test_execute_reports_partial_failure_on_bad_command(self):
        plan = {"plan": [{"step": 1, "action": "fail on purpose",
                          "command_hint": "exit 3", "is_file_operation": False}]}
        execution = secretary.execute_plan(plan, str(self.tmp))
        self.assertEqual(execution["status"], "partial_failure")
        self.assertEqual(execution["failed_step"], 1)


# ============================================================
# C17 — self-heal loop and structured degradation
# ============================================================
class TestC17SelfHealLoop(SecretaryIsolatedTestCase):

    def _failing_plan(self):
        return {"goal": "fail", "plan": [{"step": 1, "action": "fail on purpose",
                                          "command_hint": "exit 3",
                                          "expected_outcome": "failure for test",
                                          "is_file_operation": False}]}

    def _heal_success_plan(self, filename="healed.txt"):
        target = self.tmp / filename
        return {"alternative_plan": [{"step": 1, "action": f"Create file {target}",
                                       "command_hint": f"echo 'recovered' > '{target}'",
                                       "expected_outcome": "File created",
                                       "is_file_operation": True}]}

    def setUp(self):
        super().setUp()
        secretary.MAX_HEAL_ATTEMPTS = 2
        # Route through consultation so the initial plan actually fails and
        # the self-heal loop runs (a non-consult request gets a no-op plan).
        secretary.call_consultant = mock.Mock(return_value=self._failing_plan())

    def _run(self):
        return secretary.run_secrets_workflow("debug a failing thing", cwd=str(self.tmp))

    def test_heal_succeeds_on_first_alternative(self):
        secretary.self_heal = mock.Mock(return_value=self._heal_success_plan())
        result = self._run()
        self.assertEqual(result["status"], "success")
        self.assertTrue(result["self_healing_applied"])
        self.assertEqual([a["outcome"] for a in result["heal_attempts"]], ["executed"])
        self.assertEqual(result["heal_attempts"][0]["attempt"], 1)
        self.assertTrue((self.tmp / "healed.txt").exists())

    def test_heal_recovers_after_unavailable_then_valid_alternative(self):
        secretary.self_heal = mock.Mock(side_effect=[None, self._heal_success_plan("second.txt")])
        result = self._run()
        self.assertEqual(result["status"], "success")
        self.assertEqual([a["outcome"] for a in result["heal_attempts"]],
                         ["consultant_unavailable", "executed"])
        self.assertTrue((self.tmp / "second.txt").exists())

    def test_degraded_after_malformed_heal_output_exhausts_attempts(self):
        secretary.self_heal = mock.Mock(return_value={"_parse_error": True,
                                                      "raw_alternative": "not json"})
        result = self._run()
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["degradation"]["reason"], "heal_attempts_exhausted")
        self.assertEqual([a["outcome"] for a in result["degradation"]["attempts"]],
                         ["malformed_output", "malformed_output"])
        self.assertEqual(result["degradation"]["max_heal_attempts"], 2)
        self.assertEqual(secretary.self_heal.call_count, 2)

    def test_degraded_after_alternatives_keep_failing(self):
        # Valid alternatives that still fail execution
        bad = {"alternative_plan": [{"step": 1, "action": "still fails",
                                     "command_hint": "exit 5",
                                     "is_file_operation": False}]}
        secretary.self_heal = mock.Mock(return_value=bad)
        result = self._run()
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["degradation"]["reason"], "heal_attempts_exhausted")
        self.assertEqual([a["outcome"] for a in result["degradation"]["attempts"]],
                         ["executed", "executed"])
        self.assertFalse(result["execution"]["status"] == "success")

    def test_consultant_unavailable_degrades_without_healing(self):
        secretary.call_consultant = mock.Mock(return_value=None)
        result = secretary.run_secrets_workflow("debug a failing thing", cwd=str(self.tmp))
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["degradation"]["reason"], "consultant_unavailable")
        secretary.self_heal.assert_not_called()
        secretary.call_consultant.assert_called_once()

    def test_consultant_malformed_output_degrades_without_healing(self):
        secretary.call_consultant = mock.Mock(return_value={"raw_analysis": "garbage",
                                                            "_parse_error": True})
        result = secretary.run_secrets_workflow("debug a failing thing", cwd=str(self.tmp))
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["degradation"]["reason"], "consultant_malformed_output")
        secretary.self_heal.assert_not_called()

    def test_workflow_ids_and_latency_are_recorded(self):
        before = secretary.METRICS.snapshot().get("workflow_total", {}).get("count", 0)
        secretary.self_heal = mock.Mock(return_value=self._heal_success_plan())
        result = self._run()
        self.assertTrue(result.get("workflow_id"))
        snapshot = secretary.METRICS.snapshot()
        self.assertIn("workflow_total", snapshot)
        self.assertEqual(snapshot["workflow_total"]["count"], before + 1)


# ============================================================
# Model switch notification (AIPASS auto model change)
# ============================================================
class TestModelSwitchDetection(SecretaryIsolatedTestCase):

    SWITCH_RC = ('[frame] unhandled "data-model_switched" — '
                 '{"type":"data-model_switched","data":{"fromModelId":"claude-sonnet-5@default",'
                 '"toModelId":"gemini-3.1-flash-lite","reason":"credit_not_enough"}}')

    def test_detects_switch_in_reasoning_content(self):
        response = {"model": "gemini-3.1-flash-lite",
                    "choices": [{"message": {"reasoning_content": self.SWITCH_RC, "content": ""}}]}
        info = secretary.detect_model_switch(response)
        self.assertEqual(info["from_model"], "claude-sonnet-5@default")
        self.assertEqual(info["to_model"], "gemini-3.1-flash-lite")
        self.assertEqual(info["reason"], "credit_not_enough")

    def test_no_switch_returns_none(self):
        response = {"model": secretary.CONSULTANT_MODEL,
                    "choices": [{"message": {"content": "plain answer"}}]}
        self.assertIsNone(secretary.detect_model_switch(response))
        self.assertIsNone(secretary.detect_model_switch({}))
        self.assertIsNone(secretary.detect_model_switch(None))

    def test_notification_prints_and_logs(self):
        response = {"choices": [{"message": {"reasoning_content": self.SWITCH_RC}}]}
        info = secretary.detect_model_switch(response)
        with mock.patch("builtins.print") as mock_print:
            secretary.notify_model_switch(info, secretary.CONSULTANT_MODEL, workflow_id="wf-test")
        printed = " ".join(str(call) for call in mock_print.call_args_list)
        self.assertIn("auto-switched", printed)
        self.assertIn("credit_not_enough", printed)

    def test_get_current_model_returns_bridge_default(self):
        fake_response = mock.Mock(status_code=200)
        fake_response.json.return_value = {"defaultModel": "gemini-3.1-pro-preview"}
        fake_requests = mock.Mock()
        fake_requests.get.return_value = fake_response
        with mock.patch.dict("sys.modules", {"requests": fake_requests}):
            self.assertEqual(secretary.get_current_model(), "gemini-3.1-pro-preview")

    def test_default_consultant_model_is_claude_sonnet_5(self):
        self.assertEqual(secretary.CONSULTANT_MODEL, "claude-sonnet-5@default")
        self.assertEqual(secretary.ACTIVE_CONSULTANT_MODEL, "claude-sonnet-5@default")
        self.assertEqual(secretary.PRIMARY_BRAIN_MODEL, "claude-sonnet-5@default")

    def test_switch_notification_adopts_switched_model(self):
        """On quota exhaustion the secretary must USE the switched model after."""
        response = {"choices": [{"message": {"reasoning_content": self.SWITCH_RC}}]}
        info = secretary.detect_model_switch(response)
        self.assertEqual(secretary.ACTIVE_CONSULTANT_MODEL, "claude-sonnet-5@default")
        secretary.notify_model_switch(info, secretary.CONSULTANT_MODEL)
        self.assertEqual(secretary.ACTIVE_CONSULTANT_MODEL, "gemini-3.1-flash-lite")
        self.assertEqual(secretary.ACTIVE_PRIMARY_BRAIN_MODEL, "gemini-3.1-flash-lite")
        # requested constant stays untouched (the configured default)
        self.assertEqual(secretary.CONSULTANT_MODEL, "claude-sonnet-5@default")

    def test_subsequent_payloads_use_adopted_model(self):
        secretary.ACTIVE_CONSULTANT_MODEL = "gemini-3.1-flash-lite"
        payload = secretary.prepare_consult_request("req", {})
        self.assertEqual(payload["model"], "gemini-3.1-flash-lite")

    def test_unparsed_switch_does_not_adopt_unknown(self):
        info = {"from_model": "unknown", "to_model": "unknown", "reason": "unparsed"}
        before = secretary.ACTIVE_CONSULTANT_MODEL
        secretary.notify_model_switch(info, secretary.CONSULTANT_MODEL)
        self.assertEqual(secretary.ACTIVE_CONSULTANT_MODEL, before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
