# ประเมินความเป็นไปได้: ขึ้น AIPASS Bridge บน Cloudflare แทน localhost

อัปเดต: 2026-09-12

## คำตอบสั้น

**ได้ แต่ไม่ใช่ lift-and-shift** — Cloudflare ขึ้นได้เฉพาะ "ชั้น relay/API" ไม่ได้ขึ้น
ทั้งกลไก เพราะ upstream จริงคือ **เซสชันเบราว์เซอร์ที่ล็อกอิน de.aipass.net**
(Chrome + extension) ซึ่งต้องรันบนเครื่องจริงที่ไหนสักแห่งเสมอ

```
ปัจจุบัน:   Client → localhost:8787 (Node bridge) ←SSE← Chrome extension (Mac)
บน Cloudflare:  Client → Worker (DO hub) ←SSE (outbound)← Chrome extension (Mac เหมือนเดิม)
```

## สิ่งที่ต้องรู้ก่อนตัดสินใจ

### สถาปัตยกรรมปัจจุบัน (ตรวจสอบจากโค้ดแล้ว)
- Extension ต่อ bridge ด้วย **SSE** (`GET /ext/events` — ไม่ใช่ WebSocket) และ POST ผลกลับที่ `/ext/chunk|done|error`
- Extension reconnect ทุก 4 นาที (`CYCLE_MS` กัน Chrome ตัด long-request)
- Bridge เก็บ state ใน RAM (`extClients`, jobs, quota cache)

### ผลกับ Cloudflare
| ประเด็น | ผล |
|---|---|
| SSE streaming | ✅ Workers รองรับ |
| State ข้าม isolate (`extClients`, jobs) | ❌ Worker เปล่าเก็บไม่ได้ → **ต้องใช้ Durable Object** |
| เทมเพลตตัวอย่างที่ได้รับ (global `activeSocket`) | ⚠️ ใช้ได้เฉพาะ demo single-isolate — ต้องแปลงเป็น DO ก่อนใช้จริง |
| Chrome extension ต้องรันที่ไหน | ยังต้องรันบนเครื่องที่เปิด de.aipass.net ตลอด (Mac) — แต่เป็น **outbound** ไปหา cloud ไม่ต้องเปิดพอร์ต |
| quota/credits | ยังอ่านจาก extension เหมือนเดิม |

## 3 ทางเลือก

### ทางเลือก 1: Cloudflare Tunnel (ง่ายสุด, แนะนำเริ่มต้น)
รัน `cloudflared tunnel --url http://127.0.0.1:8787` → ได้ URL public + TLS
**ไม่แก้โค้ดแม้แต่บรรทัดเดียว** — Hermes/ผู้ใช้ที่อื่นชี้มาที่ URL นี้แทน localhost
ข้อจำกัด: Mac ต้องเปิดอยู่ (เหมือนเดิม), ไม่ใช่ high-availability

### ทางเลือก 2: Worker + Durable Object hub (cloud จริง)
แปลงชั้น relay เป็น Worker — เทมเพลตปรับใช้อยู่ใน `cloudflare/worker.js`
Extension แค่เปลี่ยน bridge URL ใน popup เป็น `https://<worker>.workers.dev`
(พาธ `/ext/events`, `/ext/chunk`… เหมือนเดิมทุกอย่าง ไม่ต้องแก้โค้ด extension)
ข้อจำกัด: โค้ด Node บางฟีเจอร์ (agent ลงมือทำไฟล์เครื่อง, quota cache ยาว) ต้องอยู่เครื่องเดิม

### ทางเลือก 3: ย้ายไป VPS/Cloud Run (Docker)
รัน bridge เดิมทั้งตัวบน VM — เหมาะเมื่อต้องการ HA จริง แต่หลุดโจทย์ "Cloudflare"

## เปรียบเทียบ

| | Tunnel | Worker+DO | VPS |
|---|---|---|---|
| แก้โค้ด | ไม่แก้ | เขียน hub ใหม่ (มีเทมเพลตแล้ว) | ไม่แก้ |
| เข้าถึงจากภายนอก | ✅ | ✅ | ✅ |
| Mac ต้องเปิด | ✅ (Chrome) | ✅ (Chrome) | ❌ แต่ต้องมีเครื่องรันเบราว์เซอร์อยู่ดี |
| ต้นทุน | ฟรี | ฟรี/ถูกมาก | ~$5/เดือน |
| ความเสี่ยง | ต่ำสุด | กลาง (ต้อง harden auth) | ต่ำ |

## ความปลอดภัย (บังคับก่อนขึ้นจริง)

1. ตั้ง `BRIDGE_TOKEN` เป็น secret ยาว ๆ (`wrangler secret put`) — เทมเพลตปฏิเสธ request ไม่มี token
2. อย่าใช้ CORS `*` ถ้าเรียกจากเบราว์เซอร์ — ระบุ origin (Hermes CLI เรียกได้โดยไม่ต้อง CORS)
3. Cloudflare เปิด request สู่ public internet — จำกัดด้วย Cloudflare Access ถ้าใช้ส่วนตัว
4. ข้อมูลที่ไหลผ่าน cloud = เนื้อหา prompt/plan — ไม่มี credential ของ de.aipass.net (cookies อยู่แค่ใน Chrome เครื่องคุณ)

## ขั้นตอนใช้เทมเพลต (ทางเลือก 2)

```bash
cd cloudflare
npm install
wrangler secret put BRIDGE_TOKEN        # ตั้ง token
wrangler deploy                          # ขึ้น Worker
# ใน Chrome extension popup: เปลี่ยน bridge URL เป็น https://<name>.workers.dev
# ใน Hermes (~/.hermes/config.yaml): เปลี่ยน base_url เป็น https://<name>.workers.dev/v1
curl https://<name>.workers.dev/status -H "Authorization: Bearer <token>"
```
