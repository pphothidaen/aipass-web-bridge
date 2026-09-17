#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

STATUS_URL="https://aipass-web-bridge.taijustarrett417.workers.dev/status"
MCP_URL="${MCP_URL:-https://aipass-web-bridge.taijustarrett417.workers.dev/mcp}"
API_KEY="${AIPASS_API_KEY}"
LATENCY_MAX_SEC=8

echo "=== 1. Testing Hermes MCP connection (must see Connected + 3 tools) ==="
mcp_output=$(hermes mcp test aipass-web-bridge 2>&1)
echo "${mcp_output}"

if ! echo "${mcp_output}" | grep -qi "Connected"; then
  echo "FAIL: 'Connected' not found in hermes mcp test output" >&2
  exit 1
fi

if ! echo "${mcp_output}" | grep -qiE "Tools discovered:[[:space:]]*3|3 tools"; then
  echo "FAIL: '3 tools' not found in hermes mcp test output" >&2
  exit 1
fi
echo "PASS: Hermes MCP test connected and discovered 3 tools."
echo

echo "=== 2 & 3. Calling aipass_chat & checking warm latency < 8s ==="
aipass_chat() {
  local prompt="$1"
  local model="$2"
  curl -s -S -X POST "${MCP_URL}" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"aipass_chat\",\"arguments\":{\"prompt\":\"${prompt}\",\"model\":\"${model}\"}}}" 
}

prompt='ตอบสั้นว่าสถานะเป็นอะไร'
model='gemini-3.1-flash-lite'

if command -v python3 >/dev/null 2>&1; then
  start_time=$(python3 -c 'import time; print(time.time())')
  chat_output=$(aipass_chat "${prompt}" "${model}")
  end_time=$(python3 -c 'import time; print(time.time())')
  duration=$(awk -v s="${start_time}" -v e="${end_time}" 'BEGIN { printf "%.2f", e - s }')
else
  start_time=$(date +%s)
  chat_output=$(aipass_chat "${prompt}" "${model}")
  end_time=$(date +%s)
  duration=$((end_time - start_time))
fi

echo "Response: ${chat_output}"
echo "Latency: ${duration}s"

if [ -z "${chat_output}" ]; then
  echo "FAIL: Empty response from aipass_chat" >&2
  exit 1
fi

if ! awk -v d="${duration}" -v max="${LATENCY_MAX_SEC}" 'BEGIN { exit !(d < max) }'; then
  echo "FAIL: Warm latency ${duration}s >= ${LATENCY_MAX_SEC}s" >&2
  exit 1
fi
echo "PASS: Warm latency ${duration}s < ${LATENCY_MAX_SEC}s."
echo

echo "=== 4. Checking CONNECTED status via curl to ${STATUS_URL} ==="
status_output=$(curl -s -S "${STATUS_URL}")
echo "Status: ${status_output}"

if ! echo "${status_output}" | grep -qiE '"extension"[[:space:]]*:[[:space:]]*"connected"'; then
  echo "FAIL: Extension status is not CONNECTED" >&2
  exit 1
fi
echo "PASS: Extension status is CONNECTED."
echo

echo "=== 5. Checking for mock or canned response ==="
if echo "${chat_output}" | grep -qiE 'mock|canned'; then
  echo "FAIL: Mock response detected in aipass_chat output" >&2
  exit 1
fi

if echo "${status_output}" | grep -qiE 'mock|canned'; then
  echo "FAIL: Mock response detected in status output" >&2
  exit 1
fi
echo "PASS: No mock or canned response detected."
echo

echo "=== All checks passed successfully ==="
exit 0
