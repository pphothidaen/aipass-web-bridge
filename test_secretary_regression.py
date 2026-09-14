#!/usr/bin/env python3
"""
Regression test for Secretary workflow: CREATE, UPDATE, DELETE operations
Uses secretary.py directly with verification

Run: python3 test_secretary_regression.py
"""
import json
import os
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path

# Test project root
TEST_ROOT = Path(tempfile.mkdtemp(prefix="secretary-regression-"))
print(f"[TEST] Test root: {TEST_ROOT}")

# Import secretary from project root
sys.path.insert(0, str(Path(__file__).parent))
import secretary


def cleanup_test_dir():
    """Clean up test directory."""
    if TEST_ROOT.exists():
        shutil.rmtree(TEST_ROOT)
        print(f"[TEST] Cleaned up: {TEST_ROOT}")


def run_secure_workflow(request: str, cwd: str = None):
    """Run secretary workflow with test cwd."""
    cwd = cwd or str(TEST_ROOT)
    # Override gather_context to use our test CWD
    original_cwd = os.getcwd()
    os.chdir(cwd)
    try:
        result = secretary.run_secrets_workflow(request, cwd)
        return result
    finally:
        os.chdir(original_cwd)


def verify_file_exists(path: str, should_exist: bool = True) -> tuple[bool, str]:
    """Verify file existence."""
    exists = Path(path).exists()
    if should_exist:
        return exists, f"File {path} exists" if exists else f"File {path} NOT found"
    else:
        return not exists, f"File {path} deleted" if not exists else f"File {path} still exists"


def verify_file_content(path: str, expected_content: str) -> tuple[bool, str]:
    """Verify file content."""
    try:
        content = Path(path).read_text(encoding="utf-8")
        return expected_content in content, f"Content verified: '{expected_content}' found"
    except Exception as e:
        return False, f"Failed to read file: {e}"


# ========================
# Test: CREATE operation
# ========================
def test_create_file():
    """Test CREATE: create a new file."""
    print("\n" + "="*60)
    print("TEST 1: CREATE operation")
    print("="*60)
    
    request = f"สร้างไฟล์ {TEST_ROOT}/hello.txt พร้อมข้อความ Hello World"
    
    result = run_secure_workflow(request)
    
    print(f"\n[RESULT] Status: {result['status']}")
    print(f"[RESULT] Verification: {'✅ PASS' if result.get('verification', {}).get('verified') else '❌ FAIL'}")
    
    # External verification
    file_path = str(TEST_ROOT / "hello.txt")
    exists, msg = verify_file_exists(file_path, should_exist=True)
    print(f"[EXT-CHECK] {msg}")
    
    if result['status'] == 'success' and result.get('verification', {}).get('verified') and exists:
        print("[TEST 1] ✅ CREATE passed")
        return True
    else:
        print(f"[TEST 1] ❌ CREATE failed - status={result['status']}, verification={result.get('verification', {}).get('verified')}, exists={exists}")
        return False


# ========================
# Test: UPDATE operation
# ========================
def test_update_file():
    """Test UPDATE: modify existing file."""
    print("\n" + "="*60)
    print("TEST 2: UPDATE operation")
    print("="*60)
    
    # First ensure file exists
    test_file = TEST_ROOT / "update_test.txt"
    test_file.write_text("Original content\n")
    
    request = f"แก้ไขไฟล์ {test_file} โดยเปลี่ยนเป็น Updated content"
    
    result = run_secure_workflow(request)
    
    print(f"\n[RESULT] Status: {result['status']}")
    print(f"[RESULT] Verification: {'✅ PASS' if result.get('verification', {}).get('verified') else '❌ FAIL'}")
    
    # External verification
    exists, _ = verify_file_exists(str(test_file), should_exist=True)
    content_ok, msg = verify_file_content(str(test_file), "Updated content")
    print(f"[EXT-CHECK] {msg}")
    
    if result['status'] == 'success' and result.get('verification', {}).get('verified') and exists and content_ok:
        print("[TEST 2] ✅ UPDATE passed")
        return True
    else:
        print(f"[TEST 2] ❌ UPDATE failed")
        return False


# ========================
# Test: DELETE operation
# ========================
def test_delete_file():
    """Test DELETE: remove a file."""
    print("\n" + "="*60)
    print("TEST 3: DELETE operation")
    print("="*60)
    
    # First create file to delete
    test_file = TEST_ROOT / "delete_test.txt"
    test_file.write_text("To be deleted\n")
    
    request = f"ลบไฟล์ {test_file}"
    
    result = run_secure_workflow(request)
    
    print(f"\n[RESULT] Status: {result['status']}")
    print(f"[RESULT] Verification: {'✅ PASS' if result.get('verification', {}).get('verified') else '❌ FAIL'}")
    
    # External verification
    exists, msg = verify_file_exists(str(test_file), should_exist=False)
    print(f"[EXT-CHECK] {msg}")
    
    if result['status'] == 'success' and result.get('verification', {}).get('verified') and exists:
        print("[TEST 3] ✅ DELETE passed")
        return True
    else:
        print(f"[TEST 3] ❌ DELETE failed")
        return False


# ========================
# Main
# ========================
def main():
    print("="*60)
    print("SECRETARY REGRESSION TEST SUITE")
    print("="*60)
    
    results = []
    
    try:
        # Test 1: CREATE
        results.append(("CREATE", test_create_file()))
        
        # Test 2: UPDATE
        results.append(("UPDATE", test_update_file()))
        
        # Test 3: DELETE
        results.append(("DELETE", test_delete_file()))
        
    finally:
        cleanup_test_dir()
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    
    for name, ok in results:
        status = "✅ PASS" if ok else "❌ FAIL"
        print(f"  {name}: {status}")
    
    print(f"\nTotal: {passed}/{total} passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
