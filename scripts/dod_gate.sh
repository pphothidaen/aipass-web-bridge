#!/usr/bin/env bash
set -euo pipefail

# Configuration
BRIDGE_BASE_URL="${BRIDGE_BASE_URL:-https://aipass-web-bridge.taijustarrett417.workers.dev}"
CHAT_ENDPOINT="${BRIDGE_BASE_URL}/chat"
STATUS_ENDPOINT="${BRIDGE_BASE_URL}/status"

LATENCY_MAX_SEC=8
CONNECTED_MIN_RATE=99
MOCK_REGEX='mock|canned|simulated|placeholder'

FAILED_CHECKS=0

echo "=== Phase 6 DoD Gate Verification ==="
echo "Target Base URL: ${BRIDGE_BASE_URL}"
echo

# ---------------------------------------------------------
# Criterion 1: Warm latency < 8s (median of 5 chat requests)
# ---------------------------------------------------------
echo "Checking Criterion 1: Warm latency < ${LATENCY_MAX_SEC}s (5 requests)..."
latencies=()
chat_responses=()

for i in {1..5}; do
  response_file=$(mktemp)
  # Measure time taken in seconds (using curl's %{time_total})
  duration=$(curl -s -o "${response_file}" -w "%{time_total}" -X POST "${CHAT_ENDPOINT}" \
    -H "Content-Type: application/json" \
    -d '{"message": "ping"}' || echo "999")
  
  resp_body=$(cat "${response_file}")
  chat_responses+=("${resp_body}")
  rm -f "${response_file}"

  latencies+=("${duration}")
  echo "  Probe $i: ${duration}s"
done

# Sort latencies numerically to calculate median (index 2 in 0-indexed 5 items)
IFS=$'\n' sorted_latencies=($(sort -n <<<"${latencies[*]}"))
unset IFS
median_latency="${sorted_latencies[2]}"
echo "Median Warm Latency: ${median_latency}s"

if (( $(echo "${median_latency} < ${LATENCY_MAX_SEC}" | bc -l) )); then
  echo "  -> Criterion 1 Result: PASS"
else
  echo "  -> Criterion 1 Result: FAIL (Median ${median_latency}s >= ${LATENCY_MAX_SEC}s)"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo

# ---------------------------------------------------------
# Criterion 2: CONNECTED >= 99% (100 probes of /status)
# ---------------------------------------------------------
echo "Checking Criterion 2: Extension CONNECTED >= ${CONNECTED_MIN_RATE}% (100 probes)..."
total_probes=100
connected_count=0

for ((i=1; i<=total_probes; i++)); do
  status_json=$(curl -s "${STATUS_ENDPOINT}" || echo '{}')
  # Check if status JSON indicates connected extension state
  if echo "${status_json}" | grep -qi '"extension"[[:space:]]*:[[:space:]]*"connected"'; then
    connected_count=$((connected_count + 1))
  elif echo "${status_json}" | grep -qi '"connected"[[:space:]]*:[[:space:]]*true'; then
    connected_count=$((connected_count + 1))
  fi
done

failure_count=$((total_probes - connected_count))
connected_rate=$(( (connected_count * 100) / total_probes ))
echo "Connected: ${connected_count}/${total_probes} (${connected_rate}%), Failures: ${failure_count}"

if [ "${connected_rate}" -ge "${CONNECTED_MIN_RATE}" ]; then
  echo "  -> Criterion 2 Result: PASS"
else
  echo "  -> Criterion 2 Result: FAIL (${connected_rate}% < ${CONNECTED_MIN_RATE}%)"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo

# ---------------------------------------------------------
# Criterion 3: 0 mock responses
# ---------------------------------------------------------
echo "Checking Criterion 3: 0 mock responses (pattern: '${MOCK_REGEX}')..."
mock_detected=0

for resp in "${chat_responses[@]}"; do
  if echo "${resp}" | grep -Eiq "${MOCK_REGEX}"; then
    mock_detected=$((mock_detected + 1))
    echo "  Found mock token match in response: ${resp}"
  fi
done

if [ "${mock_detected}" -eq 0 ]; then
  echo "  -> Criterion 3 Result: PASS (0 mock tokens found)"
else
  echo "  -> Criterion 3 Result: FAIL (${mock_detected} mock responses detected)"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi
echo

# ---------------------------------------------------------
# Summary and Final Verdict
# ---------------------------------------------------------
echo "=== Phase 6 DoD Gate Summary ==="
echo "1. Warm Latency (Median): ${median_latency}s (Threshold: < ${LATENCY_MAX_SEC}s)"
echo "2. Extension Connected Rate: ${connected_rate}% (Failures: ${failure_count}/${total_probes}, Threshold: >= ${CONNECTED_MIN_RATE}%)"
echo "3. Mock Responses: ${mock_detected} (Threshold: 0)"
echo

if [ "${FAILED_CHECKS}" -eq 0 ]; then
  echo "OVERALL VERDICT: PASS"
  exit 0
else
  echo "OVERALL VERDICT: FAIL (${FAILED_CHECKS} check(s) failed)"
  exit 1
fi
