#!/usr/bin/env python3
"""Test should_consult after fix (C9 verification)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import secretary

tests = [
    ("สร้างไฟล์ hello.txt", False, "CREATE ตรงๆ"),
    ("ลบไฟล์ data.txt", False, "DELETE ตรงๆ"),
    ("แก้ไขไฟล์ config.json เป็นใหม่", False, "UPDATE ตรงๆ"),
    ("ออกแบบสถาปัตยกรรมระบบใหม่", True, "งานออกแบบ"),
    ("วางแผน deploy ระบบ", True, "งานวางแผน"),
    ("วิธีที่ดีที่สุดในการ optimize query", True, "งานปรึกษาแนวทาง"),
    ("build new feature", True, "งาน build"),
    ("debug production issue", True, "งาน debug"),
]

print("=== C9: should_consult After Fix ===")
passed = 0
failed = 0
for req, expected, desc in tests:
    result = secretary.should_consult(req)
    ok = result == expected
    status = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"{status} | {desc}")
    print(f"  Request: \"{req}\"")
    print(f"  Expected: {expected}, Got: {result}")
    print()

print(f"=== Results: {passed} passed, {failed} failed ===")
sys.exit(1 if failed > 0 else 0)
