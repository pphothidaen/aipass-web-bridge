#!/bin/bash
# recovery-rename.sh — กู้คืนหลังย้ายโฟลเดอร์ aipass-dev-suite → aipass-web-bridge
# รันครั้งเดียว: bash /Users/kimlenglim/Project/aipass-web-bridge/scripts/recovery-rename.sh
set -e
OLD=/Users/kimlenglim/Project/aipass-dev-suite
NEW=/Users/kimlenglim/Project/aipass-web-bridge

echo "== 0) Backup ไฟล์ config สำคัญ =="
cp ~/.hermes/config.yaml ~/.hermes/config.yaml.backup-before-recovery-$(date +%Y%m%d%H%M) \
  && echo "  backed up: ~/.hermes/config.yaml.backup-*"

echo "== 1) ทำ path เดิมเป็น symlink ชี้โฟลเดอร์ใหม่ (กัน reference เก่าพัง) =="
if [ -d "$OLD" ] && [ ! -L "$OLD" ]; then
  # placeholder dir ที่สร้างค้างไว้มีแค่ .keep — ลบแล้วแทนด้วย symlink
  rm -rf "$OLD"
fi
ln -sfn "$NEW" "$OLD"
ls -la "$OLD/" >/dev/null && echo "OK symlink $OLD -> $NEW"

echo "== 2) อัปเดตชื่อโปรเจกต์ในไฟล์ที่เหลือ =="
cd "$NEW"
for f in package.json package-lock.json scripts/aipass-bridge-recover.sh \
         docs/hermes-end-user-guide.md docs/cloudflare-deployment-assessment.md \
         docs/sequence-diagram.md CHANGELOG.md plan.md HANDOFF.md \
         packages/core/aipass-bridge/bridge/aipass-orchestrator.mjs \
         packages/core/aipass-bridge/bridge/test/secretary-workflow.test.mjs \
         packages/core/aipass-bridge/bridge/test/secretary-workflow-crud.test.mjs \
         packages/vscode-extension/package.json \
         packages/vscode-extension/package-lock.json .vscode/settings.json; do
  [ -f "$f" ] && sed -i '' 's|aipass-dev-suite|aipass-web-bridge|g' "$f" && echo "  updated: $f"
done
sed -i '' 's|/Users/kimlenglim/Project/aipass-dev-suite|/Users/kimlenglim/Project/aipass-web-bridge|g' \
  ~/.hermes/skills/secretary-brain/SKILL.md && echo "  updated: hermes secretary-brain skill"

echo "== 3) Restart bridge + orchestrator จาก path ใหม่ =="
for pid in $(ps aux | grep "aipass-dev-suite/packages/core/aipass-bridge" | grep -v grep | awk '{print $2}'); do
  kill "$pid" 2>/dev/null && echo "  killed old proc $pid" || true
done
sleep 1
cd "$NEW/packages/core/aipass-bridge/bridge"
nohup node server.mjs > /tmp/aipass-bridge.log 2>&1 &
nohup node aipass-orchestrator.mjs > /tmp/aipass-orchestrator.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "  bridge 8787: HTTP %{http_code}\n" http://127.0.0.1:8787/status
curl -s -o /dev/null -w "  orchestrator 8788: HTTP %{http_code}\n" http://127.0.0.1:8788/status

echo "== 4) Verify tests จาก path ใหม่ =="
cd "$NEW"
python3 test_c9_should_consult.py 2>&1 | tail -1
SECRETARY_SKILLS_DIR=$(mktemp -d)/skills SECRETARY_LOG_DIR=$(mktemp -d) \
  python3 -m unittest test_secretary_isolated 2>&1 | tail -1
SECRETARY_SKILLS_DIR=$(mktemp -d)/skills SECRETARY_LOG_DIR=$(mktemp -d) \
  python3 test_secretary_regression.py 2>&1 | grep "Total:"

echo "== 5) Deploy Cloudflare worker (แทน Hello World placeholder) =="
cd "$NEW/cloudflare"
# stdin จาก /dev/null กัน wrangler hang รอ interactive login; ถ้ายังไม่ login
# ให้รัน `npx wrangler login` เองก่อน (เปิดเบราว์เซอร์ยืนยันครั้งเดียว)
HOME=/Users/kimlenglim npx wrangler deploy < /dev/null && echo "  deployed OK" || \
  echo "  ⚠️ deploy ล้มเหลว — รัน: cd $NEW/cloudflare && HOME=/Users/kimlenglim npx wrangler login && npx wrangler deploy"
sleep 2
echo "== 6) Verify live endpoints =="
echo "  -- /status (public) --"
curl -s https://aipass-web-bridge.taijustarrett417.workers.dev/status | head -c 400; echo
echo "  -- /mcp tools/list (Bearer CLIENT_API_KEY) --"
curl -s -X POST https://aipass-web-bridge.taijustarrett417.workers.dev/mcp \
  -H "Authorization: Bearer hermes-secret-key-2026" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 500; echo
echo "== 7) ตรวจสอบว่า extension เชื่อม cloud hub แล้ว (หลังตั้ง popup) =="
curl -s https://aipass-web-bridge.taijustarrett417.workers.dev/status | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('  extension:', d.get('extension','?'))" 2>/dev/null || \
  echo "  (ยัง parse ไม่ได้ — deploy อาจยังไม่เสร็จ)"
echo "== DONE =="
echo "ขั้นถัดไป: ติดตั้ง extension ใน Chrome (ดู HANDOFF.md) แล้วทดสอบ:"
echo "  hermes -z 'ใช้ mcp tool aipass_status แล้วสรุปสถานะ bridge ให้ฟัง' "
