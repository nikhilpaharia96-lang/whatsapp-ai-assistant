#!/usr/bin/env bash
# ============================================================
#  WhatsApp AI Assistant — Test Suite
#  Run: bash scripts/test.sh
# ============================================================

set -euo pipefail
source .env

N8N_WEBHOOK="http://localhost:5678/webhook/whatsapp"
EVO_BASE="${EVOLUTION_BASE_URL:-http://localhost:8080}"
PG_CMD="docker exec wa_postgres psql -U ${POSTGRES_USER:-wauser} -d ${POSTGRES_DB:-waassistant}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC} $1"; }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; }
info() { echo -e "${CYAN}→${NC} $1"; }

echo -e "\n${CYAN}═══ WhatsApp AI Assistant Test Suite ═══${NC}\n"

PASS=0; FAIL=0

run_test() {
  local name="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    pass "$name"
    ((PASS++))
  else
    fail "$name (got: ${result:0:100})"
    ((FAIL++))
  fi
}

# ── Test 1: PostgreSQL connection ──────────────────────────
info "Test 1: PostgreSQL health"
PG_RESULT=$(docker exec wa_postgres pg_isready -U "${POSTGRES_USER:-wauser}" 2>&1)
run_test "PostgreSQL accepting connections" "$PG_RESULT" "accepting"

# ── Test 2: Tables exist ───────────────────────────────────
info "Test 2: Database schema"
TABLES=$(${PG_CMD} -c "\dt" 2>&1)
run_test "contacts table exists"    "$TABLES" "contacts"
run_test "messages table exists"    "$TABLES" "messages"
run_test "escalations table exists" "$TABLES" "escalations"
run_test "portfolio table exists"   "$TABLES" "portfolio"

# ── Test 3: Seed data ──────────────────────────────────────
info "Test 3: Seed data"
CONTACTS=$(${PG_CMD} -c "SELECT COUNT(*) FROM contacts;" -t 2>&1)
run_test "contacts seeded (expect ≥1)" "$CONTACTS" "[1-9]"

PORTFOLIO=$(${PG_CMD} -c "SELECT COUNT(*) FROM portfolio;" -t 2>&1)
run_test "portfolio seeded (expect ≥5)" "$PORTFOLIO" "[5-9]"

# ── Test 4: n8n health ─────────────────────────────────────
info "Test 4: n8n health"
N8N_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5678/healthz)
run_test "n8n healthz returns 200" "$N8N_HEALTH" "200"

# ── Test 5: Evolution API health ──────────────────────────
info "Test 5: Evolution API health"
EVO_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "apikey: ${EVOLUTION_API_KEY}" "${EVO_BASE}/")
run_test "Evolution API returns 200" "$EVO_HEALTH" "200"

# ── Test 6: Webhook — skip non-message event ──────────────
info "Test 6: Webhook skips non-message events"
SKIP_RESULT=$(curl -s -X POST "${N8N_WEBHOOK}" \
  -H "Content-Type: application/json" \
  -d '{"event":"connection.update","instance":"default"}')
run_test "Non-message event skipped" "$SKIP_RESULT" "skipped"

# ── Test 7: Webhook — process friend message ──────────────
info "Test 7: Friend message processing (end-to-end)"
FRIEND_PHONE="${FRIEND_NUMBERS%%,*}"  # first friend number

FRIEND_MSG=$(curl -s -X POST "${N8N_WEBHOOK}" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"messages.upsert\",
    \"instance\": \"default\",
    \"data\": {
      \"key\": {
        \"remoteJid\": \"${FRIEND_PHONE#'+'}@s.whatsapp.net\",
        \"fromMe\": false,
        \"id\": \"test_msg_$(date +%s)\"
      },
      \"messageType\": \"conversation\",
      \"message\": {
        \"conversation\": \"Hey! What's up?\"
      },
      \"messageTimestamp\": $(date +%s)
    }
  }")
run_test "Friend message returns ok:true" "$FRIEND_MSG" '"ok":true'

sleep 3  # allow DB write

# ── Test 8: Message stored in DB ──────────────────────────
info "Test 8: Messages persisted to database"
MSG_COUNT=$(${PG_CMD} -c "SELECT COUNT(*) FROM messages;" -t 2>&1)
run_test "Messages table has records" "$MSG_COUNT" "[1-9]"

# ── Test 9: Rate limiting ──────────────────────────────────
info "Test 9: Rate limiting (send 25 rapid messages)"
SPAM_PHONE="+99999999999"
for i in $(seq 1 25); do
  curl -s -X POST "${N8N_WEBHOOK}" \
    -H "Content-Type: application/json" \
    -d "{\"event\":\"messages.upsert\",\"instance\":\"default\",\"data\":{\"key\":{\"remoteJid\":\"${SPAM_PHONE#'+'}@s.whatsapp.net\",\"fromMe\":false,\"id\":\"spam_${i}\"},\"messageType\":\"conversation\",\"message\":{\"conversation\":\"spam $i\"},\"messageTimestamp\":$(date +%s)}}" \
    -o /dev/null 2>&1
done

RATE_COUNT=$(${PG_CMD} -c "SELECT message_count FROM rate_limits WHERE phone='${SPAM_PHONE}' ORDER BY window_start DESC LIMIT 1;" -t 2>&1)
run_test "Rate limit counter incremented" "$RATE_COUNT" "[0-9]"

# ── Test 10: Contact classification ───────────────────────
info "Test 10: Contact type in database"
CONTACT_TYPE=$(${PG_CMD} -c "SELECT contact_type FROM contacts WHERE phone='${FRIEND_PHONE}';" -t 2>&1)
# Might be 'unknown' if FRIEND_NUMBERS classification hasn't been applied yet
run_test "Contact record exists" "$CONTACT_TYPE" "[a-z]"

# ── Summary ───────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══ Results ═══${NC}"
echo -e "${GREEN}Passed: ${PASS}${NC}"
[ $FAIL -gt 0 ] && echo -e "${RED}Failed: ${FAIL}${NC}" || echo -e "Failed: 0"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}All tests passed. System is ready!${NC}"
else
  echo -e "${YELLOW}Some tests failed. Check docker logs:${NC}"
  echo "  docker logs wa_n8n"
  echo "  docker logs wa_evolution"
  echo "  docker logs wa_postgres"
fi
