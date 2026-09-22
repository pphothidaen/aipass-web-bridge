"""TDD test suite for Secretary Brain CRUD verification operations (KBN-001).

Acceptance Criteria:
- test_create_path_verification: Test CREATE with correct path verification (not failing on skill-reused paths)
- test_read_returns_content: Test READ returns expected content
- test_update_modifies_target: Test UPDATE modifies correct target file
- test_delete_removes_file: Test DELETE removes correct file
"""
import os
import sys
from pathlib import Path
import pytest

# Ensure aipass-web-bridge is in sys.path
BRIDGE_DIR = Path(__file__).resolve().parent.parent
if str(BRIDGE_DIR) not in sys.path:
    sys.path.insert(0, str(BRIDGE_DIR))

import secretary


@pytest.fixture(autouse=True)
def isolate_skills_dir(tmp_path, monkeypatch):
    """Isolate skills directory during tests so temporary test skills aren't saved to repo."""
    test_skills = tmp_path / "skills"
    test_skills.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(secretary, "SKILLS_DIR", test_skills)


def test_create_path_verification(tmp_path):
    """Test CREATE with path-aware verification when skill reuse provides old action path.
    
    When a skill is reused, the plan action string contains the old skill's path,
    while the original request/goal contains the newly requested path.
    Verification must verify the newly requested path, not fail on the old path.
    """
    new_file = tmp_path / "new_created_file.txt"
    old_skill_path = tmp_path / "old_skill_file.txt"
    
    # Simulate execution where new_file was created
    new_file.write_text("hello created world")
    assert not old_skill_path.exists(), "Old skill file should not exist"
    
    user_request = f"create file {new_file} with content hello created world"
    plan = {
        "goal": user_request,
        "plan": [
            {
                "step": 1,
                "action": f"create file {old_skill_path} with content hello created world",
                "command_hint": f"echo 'hello created world' > '{new_file}'",
                "expected_outcome": "File created",
                "is_file_operation": True,
            }
        ],
    }
    exec_result = {
        "status": "success",
        "completed_steps": [
            {
                "step": 1,
                "action": f"create file {old_skill_path} with content hello created world",
                "command": f"echo 'hello created world' > '{new_file}'",
                "success": True,
                "is_file_operation": True,
            }
        ],
    }
    
    # 1. Direct path extraction must prefer original_request over skill action
    extracted = secretary._extract_file_path_from_action(
        f"create file {old_skill_path}",
        str(tmp_path),
        original_request=user_request
    )
    assert extracted == str(new_file), f"Expected {new_file}, got {extracted}"
    
    # 2. verify_execution_result must verify new_file exists (and pass)
    verif = secretary.verify_execution_result(plan, exec_result, cwd=str(tmp_path))
    assert verif["verified"] is True, f"Verification failed: {verif['failures']}"
    assert any(str(new_file) in note for detail in verif["details"] for note in detail.get("notes", []))


def test_read_returns_content(tmp_path):
    """Test READ returns expected content for an existing file.
    
    Secretary should recognize 'read file' as a simple file op without needing
    consultant, execute 'cat' / read command, return the content in output,
    and verify that the file exists and is readable.
    """
    target_file = tmp_path / "read_target.txt"
    expected_content = "Secretary READ verification content 12345"
    target_file.write_text(expected_content)
    
    user_request = f"read file {target_file}"
    
    # should_consult should not trigger consultation for reading a file
    assert secretary.should_consult(user_request) is False
    
    # run_secrets_workflow should execute and return content
    result = secretary.run_secrets_workflow(user_request, cwd=str(tmp_path))
    assert result["status"] == "success", f"Workflow failed: {result.get('error')}"
    assert result["verification"]["verified"] is True
    
    # Execution output should contain the file content
    completed_steps = result["execution"]["completed_steps"]
    assert len(completed_steps) > 0
    step_output = completed_steps[0].get("output", "")
    assert expected_content in step_output, f"Expected '{expected_content}' in output, got '{step_output}'"


def test_update_modifies_target(tmp_path):
    """Test UPDATE modifies the correct target file and verifies changes.
    
    Also tests that path verification identifies the target file even when
    action string comes from a reused skill with an old path.
    """
    target_file = tmp_path / "update_target.txt"
    target_file.write_text("initial content before update")
    
    old_file = tmp_path / "old_reused_update.txt"
    user_request = f"update file {target_file} to updated content 999"
    
    # 1. Path extraction test with reused action string
    extracted = secretary._extract_file_path_from_action(
        f"update file {old_file} to updated content 999",
        str(tmp_path),
        original_request=user_request
    )
    assert extracted == str(target_file), f"Expected {target_file}, got {extracted}"
    
    # 2. End-to-end workflow execution
    result = secretary.run_secrets_workflow(user_request, cwd=str(tmp_path))
    assert result["status"] == "success", f"Workflow failed: {result.get('error')}"
    assert result["verification"]["verified"] is True
    assert target_file.read_text().strip() == "updated content 999"


def test_delete_removes_file(tmp_path):
    """Test DELETE removes the target file and verifies deletion.
    
    Also tests that path verification targets the correct file even when
    action string comes from a reused skill with an old path.
    """
    target_file = tmp_path / "delete_target.txt"
    target_file.write_text("file to be deleted")
    assert target_file.exists()
    
    old_file = tmp_path / "old_reused_delete.txt"
    old_file.write_text("this old file should NOT be deleted")
    
    user_request = f"delete file {target_file}"
    
    # 1. Path extraction test with reused action string
    extracted = secretary._extract_file_path_from_action(
        f"delete file {old_file}",
        str(tmp_path),
        original_request=user_request
    )
    assert extracted == str(target_file), f"Expected {target_file}, got {extracted}"
    
    # 2. End-to-end workflow execution
    result = secretary.run_secrets_workflow(user_request, cwd=str(tmp_path))
    assert result["status"] == "success", f"Workflow failed: {result.get('error')}"
    assert result["verification"]["verified"] is True
    assert not target_file.exists(), f"Target file {target_file} should have been deleted"
    assert old_file.exists(), f"Old file {old_file} should remain intact"


def test_verify_uses_original_request_for_path(tmp_path):
    """Test verify_execution_result uses plan['goal'] as original_request for path extraction (KBN-002)."""
    target_file = tmp_path / "actual_requested_file.txt"
    target_file.write_text("actual file content")
    stale_skill_file = tmp_path / "stale_skill_file.txt"

    plan = {
        "goal": f"create file {target_file} with content actual file content",
        "plan": [
            {
                "step_num": 1,
                "action": f"create file {stale_skill_file} with content actual file content",
                "is_file_operation": True,
            }
        ]
    }
    exec_result = {
        "status": "success",
        "completed_steps": [
            {
                "step_num": 1,
                "action": f"create file {stale_skill_file} with content actual file content",
                "success": True,
                "is_file_operation": True,
            }
        ]
    }

    verif = secretary.verify_execution_result(plan, exec_result, cwd=str(tmp_path))
    assert verif["verified"] is True, f"Verification should pass for actual target: {verif}"
    assert not stale_skill_file.exists()
    assert target_file.exists()

