#!/bin/bash
# Auto-recovery script for Hermes + aipass-bridge integration
# Checks bridge server and restarts if needed

set -e

BRIDGE_DIR="/Users/kimlenglim/Project/aipass-dev-suite/packages/core/aipass-bridge/bridge"
BRIDGE_LOG="/tmp/aipass-bridge.log"
MCP_AGENT="packages/core/aipass-bridge/bridge/mcp-agent.mjs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "🔍 Checking aipass-bridge status..."

# 1. Check if bridge server is running on port 8787
check_bridge() {
    if lsof -i :8787 -P -n 2>/dev/null | grep -q LISTEN; then
        echo -e "${GREEN}✓${NC} Bridge server running on :8787"
        return 0
    else
        echo -e "${YELLOW}✗${NC} Bridge server NOT running"
        return 1
    fi
}

# 2. Start bridge server
start_bridge() {
    echo "🚀 Starting bridge server..."
    cd "$BRIDGE_DIR"
    nohup node server.mjs > "$BRIDGE_LOG" 2>&1 &
    sleep 2
    
    if check_bridge; then
        echo -e "${GREEN}✓${NC} Bridge started successfully"
        echo "  Log: $BRIDGE_LOG"
    else
        echo -e "${RED}✗${NC} Failed to start bridge"
        echo "  Check log: tail $BRIDGE_LOG"
        exit 1
    fi
}

# 3. Test bridge health
test_bridge() {
    echo "🏥 Testing bridge health..."
    local health
    health=$(curl -s http://127.0.0.1:8787/health 2>/dev/null || echo "FAILED")
    
    if echo "$health" | grep -q '"ok":true'; then
        local models
        models=$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null || echo "?")
        echo -e "${GREEN}✓${NC} Bridge healthy ($models models available)"
    else
        echo -e "${RED}✗${NC} Bridge unhealthy"
        return 1
    fi
}

# 4. Test custom endpoints
test_custom_endpoints() {
    echo "🔧 Testing custom endpoints..."
    
    # Test /v1/files/read
    local test_result
    test_result=$(curl -s -X POST http://127.0.0.1:8787/v1/files/read \
        -H "Content-Type: application/json" \
        -d '{"path":"/Users/kimlenglim/Project/aipass-dev-suite/package.json","limit":3}' 2>/dev/null)
    
    if echo "$test_result" | grep -q '"content"'; then
        echo -e "${GREEN}✓${NC} /v1/files/read working"
    else
        echo -e "${YELLOW}⚠${NC} /v1/files/read not responding correctly"
    fi
    
    # Test /v1/files/list
    test_result=$(curl -s -X POST http://127.0.0.1:8787/v1/files/list \
        -H "Content-Type: application/json" \
        -d '{"path":"/Users/kimlenglim/Project/aipass-dev-suite/packages","limit":5}' 2>/dev/null)
    
    if echo "$test_result" | grep -q '"entries"'; then
        echo -e "${GREEN}✓${NC} /v1/files/list working"
    else
        echo -e "${YELLOW}⚠${NC} /v1/files/list not responding correctly"
    fi
}

# 5. Verify MCP config exists in Hermes
check_mcp_config() {
    echo "⚙️  Checking Hermes MCP config..."
    
    if hermes config get mcp_servers.aipass_agent >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} MCP config exists"
    else
        echo -e "${YELLOW}⚠${NC} MCP config missing — restoring..."
        restore_mcp_config
    fi
}

restore_mcp_config() {
    hermes config set mcp_servers.aipass_agent.command "node"
    hermes config set mcp_agents.aipass_agent.args '["packages/core/aipass-bridge/bridge/mcp-agent.mjs"]'
    hermes config set mcp_servers.aipass_agent.timeout 30
    hermes config set mcp_servers.aipass_agent.connect_timeout 15
    echo -e "${GREEN}✓${NC} MCP config restored"
}

# 6. Verify MCP agent file exists
check_mcp_agent_file() {
    if [ -f "$BRIDGE_DIR/mcp-agent.mjs" ]; then
        echo -e "${GREEN}✓${NC} MCP agent file exists"
    else
        echo -e "${RED}✗${NC} MCP agent file missing: $BRIDGE_DIR/mcp-agent.mjs"
        echo "  Run: git checkout packages/core/aipass-bridge/bridge/mcp-agent.mjs"
        return 1
    fi
}

# Main
echo "=========================================="
echo "  Hermes + aipass-bridge Auto-Recovery"
echo "=========================================="
echo ""

check_bridge || start_bridge
test_bridge
test_custom_endpoints
check_mcp_config
check_mcp_agent_file

echo ""
echo "=========================================="
echo -e "${GREEN}  All checks passed ✓${NC}"
echo "=========================================="
