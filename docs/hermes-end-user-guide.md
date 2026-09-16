# คู่มือการใช้งาน Secretary บน Hermes Agent (สำหรับ End User)

อัปเดต: 2026-09-12 · เวอร์ชันระบบ 0.2.0

---

## 1. เลือก Model ตัวไหนดี?

เปิดแอป Hermes → ไปที่การเลือก model (หรือพิมพ์ `hermes model` ใน terminal เพื่อเลือกแบบ interactive) จะพบ provider ที่เกี่ยวกับ AIPASS อยู่ 2 ตัว:

| Provider ในแอป | Model ที่มี | เหมาะกับ | เครดิต |
|---|---|---|---|
| **aipass-bridge** | `gemini-3.1-flash-lite` | ใช้งานทั่วไป คุย/สั่งงาน/โค้ดทั่วไป — **แนะนำค่าเริ่มต้น** | 🆓 ฟรี (ใช้ได้แม้ quota เต็ม) |
| **aipass-bridge** | `gemini-3.1-pro-preview` | งานวางแผนซับซ้อน | ใช้เครดิต |
| **aipass** (orchestrator) | `claude-sonnet-5@default` | งานคุณภาพสูงสุด | ใช้เครดิต — **ถ้า quota หมด ระบบจะสลับเป็น gemini-3.1-flash-lite ให้อัตโนมัติพร้อมแจ้งเตือน** |
| (ค่าเริ่มต้นเดิม) | node6-gpu / Qwen2.5-Coder | งานโค้ดบนเครือข่ายภายใน | ไม่ใช้เครดิต |

### คำแนะนำสั้น ๆ

- **ไม่แน่ใจ → เลือก `aipass-bridge` + `gemini-3.1-flash-lite`** (ฟรี, เร็ว, ใช้ได้เสมอ)
- **อยากได้คุณภาพสุด → เลือก `aipass` + `claude-sonnet-5@default`** (ถ้า quota หมดจะสลับให้เองและมีข้อความแจ้งเตือนขึ้นมา ไม่ต้องทำอะไร)
- Model ของแชทไม่ต้องตรงกับ model ของ Secretary — ระบบจัดการภายในเอง (ดูหัวข้อ 3)

---

## 2. สั่งงาน Secretary ผ่านแชทในแอป

Secretary คือ "สมองที่สอง" ที่วางแผน → ลงมือทำจริง → ตรวจสอบผล ใช้เมื่อต้องการ
**สร้าง/แก้ไข/ลบไฟล์ หรืองานหลายขั้นตอนบนเครื่อง** ไม่ใช่แค่ถาม-ตอบ

### วิธีสั่ง

เพียงพิมพ์บอกในแชทว่าให้ใช้ skill **secretary-brain** พร้อมบอกรายละเอียดงานและตำแหน่งไฟล์ (absolute path) เช่น

> ใช้ secretary-brain สร้างไฟล์ /Users/kimlenglim/Desktop/notes.txt พร้อมข้อความ "สวัสดี"

> ใช้ secretary-brain ลบไฟล์ /tmp/test.txt

> ใช้ secretary-brain ช่วยวางแผนและสร้างโปรเจกต์ web scraper ในโฟลเดอร์ /Users/kimlenglim/Project/scraper

Agent จะรันคำสั่งให้เอง:
```bash
python3 /Users/kimlenglim/Project/aipass-web-bridge/secretary.py "<คำสั่งของคุณ>" --cwd <โฟลเดอร์ทำงาน>
```
แล้วรายงานผลกลับมาเป็น: สถานะ (`success`), สิ่งที่ execute ไป, ผล verification และสรุปภาษาคน

### ข้อควรรู้ตอนใช้

- **ระบุ path ไฟล์เต็ม** เสมอ (เช่น `/Users/...`) เพราะ Secretary ทำงานเฉพาะใน `--cwd` ที่กำหนด
- **ถ้า quota AIPASS หมด**: จะเห็นข้อความแจ้งเตือนว่า model ถูกเปลี่ยน (เช่น Claude → Gemini Flash Lite) หรือไปใช้ consultant ฟรี (Nous) แทน — งานยังเดินต่อจนเสร็จ ไม่ต้องทำอะไร
- **งานเดิมที่เคยทำสำเร็จ** จะถูกจำใน skill library → ครั้งหน้าสั่งเหมือนเดิม ระบบจะ reuse แผนเดิมทันที (เร็วขึ้น, ไม่เสียเครดิต)
- ถ้าล้มเหลว ระบบจะพยายาม **self-heal สูงสุด 2 รอบ** ก่อนรายงานว่า `degraded` พร้อมเหตุผล — ให้รายงานต่อผู้ใช้ตามจริง ไม่ควร retry เกิน 1 ครั้งด้วยคำสั่งเดิม

---

## 3. ใช้งานผ่าน Terminal (สำรอง)

```bash
# คุยกับ model บน AIPASS bridge โดยตรง
hermes -z "สวัสดี" --provider aipass-bridge -m gemini-3.1-flash-lite

# สั่ง Secretary ตรง ๆ (ไม่ผ่านแชท)
python3 /Users/kimlenglim/Project/aipass-web-bridge/secretary.py \
  "create file /tmp/demo.txt with content hello" --cwd /tmp

# เลือก model ค่าเริ่มต้นของแอปแบบ interactive
hermes model
```

---

## 4. คำถามที่พบบ่อย

**Q: ขึ้นเตือน "auto-switched the model" คืออะไร?**
A: AIPASS เปลี่ยน model ให้อัตโนมัติเพราะ quota หมด (เช่น Claude → Gemini Flash Lite ฟรี) Secretary จะใช้ model ใหม่นั้นต่อทันที งานไม่หยุด

**Q: ทำไมไม่ต้องเสียเครดิตทั้งที่ใช้ Claude?**
A: ถ้า quota หมด ระบบจะสลับเป็น model ฟรีให้เอง หรือหันไปใช้ consultant ฟรี (Nous) เป็นแผนสำรอง

**Q: จะเช็คว่า bridge พร้อมใช้ไหม?**
A: `curl http://127.0.0.1:8787/status` — ดู `extensions` (ต้อง ≥ 1 = ล็อกอินแล้ว) และ `credits`

**Q: skill ไหนที่เกี่ยวข้อง?**
A: `secretary-brain` (สั่งงาน Secretary), `aipass-bridge-agent` (ใช้ bridge agent โดยตรง)
