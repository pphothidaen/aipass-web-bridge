"""Unit tests for the Primary-brain protocol, turn builder, and session calls."""
import json
import unittest
from unittest import mock

import secretary


class ParseBrainResponseTests(unittest.TestCase):
    def test_bare_instruction(self):
        content = json.dumps({"type": "instruction", "analysis": "why",
                              "steps": [{"step": 1, "action": "Create file a.txt",
                                         "expected_outcome": "exists",
                                         "is_file_operation": True}]})
        parsed = secretary.parse_brain_response(content)
        self.assertEqual(parsed["type"], "instruction")
        self.assertEqual(len(parsed["steps"]), 1)

    def test_fenced_question_and_done(self):
        fenced_q = '```json\n{"type":"question","questions":["what cwd?"]}\n```'
        self.assertEqual(secretary.parse_brain_response(fenced_q)["type"], "question")
        done = '{"type":"done","summary":"file created and verified"}'
        self.assertEqual(secretary.parse_brain_response(done)["type"], "done")

    def test_instruction_without_steps_invalid(self):
        self.assertIsNone(secretary.parse_brain_response(
            '{"type":"instruction","analysis":"no steps"}'))

    def test_prose_and_garbage_rejected(self):
        self.assertIsNone(secretary.parse_brain_response(
            'I would suggest creating the file yourself.'))
        self.assertIsNone(secretary.parse_brain_response(''))
        self.assertIsNone(secretary.parse_brain_response(None))
        self.assertIsNone(secretary.parse_brain_response('{"type":"unknown"}'))


class BuildTurnMessageTests(unittest.TestCase):
    def test_intro_contains_protocol_and_context(self):
        message = secretary.build_turn_message(
            "create x.txt", {"cwd": "/tmp", "os_info": "darwin",
                             "relevant_files": ["a", "b"], "bridge_available": True},
            intro=True)
        self.assertIn("Primary brain", message)
        self.assertIn("create x.txt", message)
        self.assertIn("relevant_files", message)

    def test_reports_and_char_limit(self):
        exec_result = {"status": "partial_failure", "total_steps": 2,
                       "completed_steps": [{"step": 1, "success": False,
                                            "execution_method": "hermes_lane",
                                            "output": "x" * 9000}],
                       "error": "boom"}
        verif = {"verified": False, "failures": [{"type": "file_not_found_after_create"}]}
        message = secretary.build_turn_message(
            "req", {"cwd": "/tmp"}, last_steps=[{"step": 1, "action": "a"}],
            exec_result=exec_result, verif_result=verif)
        self.assertIn("Execution report", message)
        self.assertIn("Verification report", message)
        # Per-step output is tail-capped, so the huge output cannot bloat the turn.
        self.assertNotIn("x" * 400, message)

        many_steps = [{"step": i, "action": "a" * 200} for i in range(200)]
        capped = secretary.build_turn_message(
            "req", {"cwd": "/tmp"}, last_steps=many_steps,
            exec_result={"status": "success", "completed_steps": [
                {"step": i, "success": True, "execution_method": "shell",
                 "output": "y" * 500} for i in range(200)]})
        self.assertIn("middle truncated", capped)
        self.assertLessEqual(len(capped), secretary.PRIMARY_BRAIN_TURN_CHAR_LIMIT + 64)


class BrainSessionTests(unittest.TestCase):
    def test_new_conversation_returns_id(self):
        with mock.patch.object(secretary.requests, "post") as post:
            post.return_value.json.return_value = {"id": "conv-1"}
            post.return_value.raise_for_status = lambda: None
            self.assertEqual(secretary.brain_new_conversation(), "conv-1")

    def test_new_conversation_failure_returns_none(self):
        with mock.patch.object(secretary.requests, "post",
                               side_effect=OSError("down")):
            self.assertIsNone(secretary.brain_new_conversation())

    def test_turn_detects_switch(self):
        switch_payload = {"choices": [{"message": {
            "content": "ok",
            "reasoning_content": '[frame] unhandled "data-model_switched" — '
            '{"type":"data-model_switched","data":{"fromModelId":"claude-sonnet-5@default",'
            '"toModelId":"gemini-3.1-flash-lite","reason":"credit_not_enough"}}'}}]}
        with mock.patch.object(secretary.requests, "post") as post, \
                mock.patch.object(secretary, "notify_model_switch") as notify:
            post.return_value.json.return_value = switch_payload
            post.return_value.raise_for_status = lambda: None
            result = secretary.brain_turn("hello")
        self.assertEqual(result["content"], "ok")
        self.assertEqual(result["switch"]["to_model"], "gemini-3.1-flash-lite")
        notify.assert_called_once()

    def test_turn_error_shape(self):
        with mock.patch.object(secretary.requests, "post",
                               side_effect=OSError("down")):
            result = secretary.brain_turn("hello")
        self.assertIsNone(result["content"])
        self.assertEqual(result["error"], "OSError")


class GatherAnswersTests(unittest.TestCase):
    def test_reads_mentioned_file(self):
        import os, tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "report.txt")
            with open(path, "w") as fh:
                fh.write("STATUS-OK")
            answers = secretary._gather_question_answers(
                ["What does /%s contain?" % "tmp/report.txt"], tmp,
                {"relevant_files": []})
            # absolute-path branch: pass the real path in the question
            answers = secretary._gather_question_answers(
                [f"What does {path} contain?"], tmp, {"relevant_files": []})
            self.assertIn("STATUS-OK", list(answers.values())[0])

    def test_unmatched_question_gets_file_listing(self):
        answers = secretary._gather_question_answers(
            ["why is the sky blue?"], "/tmp", {"relevant_files": ["a.txt"]})
        self.assertIn("a.txt", list(answers.values())[0])


if __name__ == "__main__":
    unittest.main()
