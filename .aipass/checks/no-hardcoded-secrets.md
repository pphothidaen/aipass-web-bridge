---
name: No Hardcoded Secrets
description: เช็คว่าไม่มี API key หรือ secret ฝังในโค้ด
---
ตรวจสอบไฟล์ที่เปลี่ยนแปลงใน diff นี้ ว่ามีการ hardcode
API key, password, token ใดๆ หรือไม่

ถ้าเจอ: ตอบขึ้นต้นด้วย "FAIL:" ตามด้วยไฟล์และบรรทัดที่พบ
ถ้าไม่เจอ: ตอบ "PASS"