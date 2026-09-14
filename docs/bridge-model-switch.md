# aipass-bridge Model Switch Monitor

## พฤติกรรมที่เกิดขึ้น

เมื่อเลือก model ที่มี credit ไม่พอ (เช่น Claude Sonnet 5) bridge จะ auto-switch เป็น model อื่น และแจ้งใน response:

```json
{
  "reasoning_content": "[frame] unhandled \"data-model_switched\" — {\"type\":\"data-model_switched\",\"data\":{\"fromModelId\":\"claude-sonnet-5@default\",\"toModelId\":\"gemini-3.1-flash-lite\",\"reason\":\"credit_not_enough\"}}"
}
```

## วิธีตรวจสอบ

### 1. ใช้ script ตรวจสอบ

```bash
node scripts/check-bridge-model.mjs
```

### 2. เช็ค manual

```bash
curl -s -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-5@default","messages":[{"role":"user","content":"hi"}]}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('Model used:', r.get('model','?')); rc=r.get('choices',[{}])[0].get('message',{}).get('reasoning_content',''); print('Switch info:', rc[:200] if rc else 'none')"
```

## สาเหตุ

- `credit_not_enough` — บัญชี de.aipass.net มี credits ไม่พอสำหรับ model นั้น
- `model_not_available` — model ไม่พร้อมใช้งานชั่วคราว
- `account_restriction` — บัญชีถูกจำกัดสิทธิ์

## วิธีแก้

1. เติม credits บน de.aipass.net
2. เปลี่ยนเป็น model ที่มี credits พอ (เช่น gemini-3.1-flash-lite — free credit)
3. รอ credits เดือนใหม่
