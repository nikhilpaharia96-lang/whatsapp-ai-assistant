#!/usr/bin/env bash
# ============================================================
#  WhatsApp AI Assistant — Smoke Tests
#  Run from the project root (stack must be up):  bash scripts/test.sh
#
#  Test 7 is a real end-to-end run: it sends a fake incoming message for
#  TEST_PHONE through n8n -> Gemini -> Evolution, so the AI's reply is really
#  delivered to that number. TEST_PHONE defaults to YOUR escalation number,
#  i.e. the reply lands in your own WhatsApp. Override with e.g.
#      TEST_PHONE=+911234567890 bash scripts/test.sh
#  The WhatsApp instance (EVOLUTION_INSTANCE_NAME) must be created and connected.
# ============================================================

# No `set -e`: every check reports PASS/FAIL itself and the suite keeps going.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ ! -f .env ]]; then
  echo "No .env found. Run: bash scripts/setup.sh" >&2
  exit 1
fi
set +u
# shellcheck disable=SC1091
source <(sed 's/\r$//' .env)
set -u

# These run on the HOST, so use localhost (the Docker-internal name `evolution`
# from EVOLUTION_BASE_URL does not resolve here).
N8N_BASE="http://localhost:5678"
EVO_BASE="${EVO_HOST_URL:-http://localhost:8080}"
N8N_WEBHOOK="${N8N_BASE}/webhook/whatsapp?secret=${WEBHOOK_SECRET:-}"
INSTANCE="${EVOLUTION_INSTANCE_NAME:-default}"
PG_USER="${POSTGRES_USER:-wauser}"
PG_DB="${POSTGRES_DB:-waassistant}"
psql_q() { docker exec wa_postgres psql -U "$PG_USER" -d "$PG_DB" -t -A -c "$1" 2>&1; }

TEST_PHONE="${TEST_PHONE:-${ESCALATION_PHONE:-}}"
TEST_DIGITS="${TEST_PHONE//[^0-9]/}"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC} $1"; }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; }
info() { echo -e "${CYAN}→${NC} $1"; }

PASS=0; FAIL=0

# run_test <name> <actual output> <expected substring/regex>
run_test() {
  if echo "$2" | grep -q -- "$3"; then
    pass "$1"; PASS=$((PASS + 1))
  else
    fail "$1 (got: ${2:0:120})"; FAIL=$((FAIL + 1))
  fi
}

# run_test_ge <name> <actual output> <minimum number>
run_test_ge() {
  local n; n="$(echo "$2" | tr -dc '0-9')"
  if [[ -n "$n" && "$n" -ge "$3" ]]; then
    pass "$1"; PASS=$((PASS + 1))
  else
    fail "$1 (got: ${2:0:120}, expected >= $3)"; FAIL=$((FAIL + 1))
  fi
}

# incoming_msg <digits> <text> <message-id>  -> Evolution-style messages.upsert payload
incoming_msg() {
  cat <<EOF
{"event":"messages.upsert","instance":"${INSTANCE}","data":{"key":{"remoteJid":"$1@s.whatsapp.net","fromMe":false,"id":"$3"},"pushName":"Test","messageType":"conversation","message":{"conversation":"$2"},"messageTimestamp":$(date +%s)}}
EOF
}
post() { curl -s -m "${2:-30}" -X POST "$N8N_WEBHOOK" -H "Content-Type: application/json" -d "$1"; }

echo -e "\n${CYAN}═══ WhatsApp AI Assistant Test Suite ═══${NC}\n"

# ── Test 1: PostgreSQL connection ──────────────────────────
info "Test 1: PostgreSQL health"
PG_RESULT=$(docker exec wa_postgres pg_isready -U "$PG_USER" 2>&1)
run_test "PostgreSQL accepting connections" "$PG_RESULT" "accepting"

# ── Test 2: Tables exist ───────────────────────────────────
info "Test 2: Database schema"
TABLES=$(docker exec wa_postgres psql -U "$PG_USER" -d "$PG_DB" -c "\dt" 2>&1)
for t in contacts messages escalations portfolio rate_limits audit_log; do
  run_test "$t table exists" "$TABLES" "$t"
done

# ── Test 3: Seed data ──────────────────────────────────────
info "Test 3: Seed data"
run_test_ge "contacts seeded (expect >= 1)"  "$(psql_q 'SELECT COUNT(*) FROM contacts;')"  1
run_test_ge "portfolio seeded (expect >= 5)" "$(psql_q 'SELECT COUNT(*) FROM portfolio;')" 5

# ── Test 4: n8n health ─────────────────────────────────────
info "Test 4: n8n health"
N8N_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${N8N_BASE}/healthz")
run_test "n8n healthz returns 200" "$N8N_HEALTH" "200"

# ── Test 5: Evolution API health ──────────────────────────
info "Test 5: Evolution API health"
EVO_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: ${EVOLUTION_API_KEY}" "${EVO_BASE}/")
run_test "Evolution API returns 200" "$EVO_HEALTH" "200"

# ── Test 6: Webhook — security + non-message events ───────
info "Test 6: Webhook rejects bad secret and skips non-message events"
BAD_SECRET=$(curl -s -m 30 -X POST "${N8N_BASE}/webhook/whatsapp?secret=wrong" \
  -H "Content-Type: application/json" -d "$(incoming_msg 15550000001 hi bad_secret_test)")
run_test "Wrong secret is rejected" "$BAD_SECRET" "unauthorized"

SKIP_RESULT=$(post '{"event":"connection.update","instance":"default"}')
run_test "Non-message event skipped" "$SKIP_RESULT" "skipped"

GROUP_RESULT=$(post "$(incoming_msg 120363000000000000 hi group_test | sed 's/@s.whatsapp.net/@g.us/')")
run_test "Group message skipped" "$GROUP_RESULT" "not_a_direct_chat"

# ── Test 7: Webhook — full pipeline (sends a REAL reply to TEST_PHONE) ──
info "Test 7: End-to-end message processing (reply goes to ${TEST_PHONE:-<TEST_PHONE not set>})"
if [[ -z "$TEST_DIGITS" ]]; then
  fail "Set TEST_PHONE or ESCALATION_PHONE in .env to run the end-to-end test"; FAIL=$((FAIL + 1))
else
  E2E=$(post "$(incoming_msg "$TEST_DIGITS" "Hey! What's up?" "test_msg_$(date +%s)")" 120)
  run_test "Message processed (returns ok:true)" "$E2E" '"ok":true'
fi

sleep 2  # allow DB writes to land

# ── Test 8: Message stored in DB ──────────────────────────
info "Test 8: Messages persisted to database"
run_test_ge "Messages table has records" "$(psql_q 'SELECT COUNT(*) FROM messages;')" 1

# ── Test 9: Rate limiting ──────────────────────────────────
info "Test 9: Rate limiting"
SPAM_PHONE="+99999999999"
LIMIT="${RATE_LIMIT_PER_HOUR:-20}"
# Put the sender exactly at the limit, so the next message must be refused
# (no 20 real Gemini calls / failed sends needed).
psql_q "INSERT INTO rate_limits (phone, window_start, message_count)
        VALUES ('${SPAM_PHONE}', DATE_TRUNC('hour', NOW()), ${LIMIT})
        ON CONFLICT (phone, window_start) DO UPDATE SET message_count = ${LIMIT};" >/dev/null
RATE_RESULT=$(post "$(incoming_msg "${SPAM_PHONE#+}" "spam" "spam_$(date +%s)")")
run_test "Message over the hourly limit is refused" "$RATE_RESULT" "rate_limit"
psql_q "DELETE FROM rate_limits WHERE phone='${SPAM_PHONE}';" >/dev/null

# ── Test 10: Contact record ────────────────────────────────
info "Test 10: Contact stored in database"
if [[ -n "$TEST_DIGITS" ]]; then
  CONTACT_TYPE=$(psql_q "SELECT contact_type FROM contacts WHERE phone='+${TEST_DIGITS}';")
  run_test "Contact record exists (type: ${CONTACT_TYPE:-none})" "$CONTACT_TYPE" "family\|friend\|client\|unknown"
fi

# ── Summary ───────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══ Results ═══${NC}"
echo -e "${GREEN}Passed: ${PASS}${NC}"
if [[ $FAIL -gt 0 ]]; then echo -e "${RED}Failed: ${FAIL}${NC}"; else echo "Failed: 0"; fi
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}All tests passed. System is ready!${NC}"
else
  echo -e "${YELLOW}Some tests failed. Check docker logs:${NC}"
  echo "  docker logs wa_n8n --tail 50"
  echo "  docker logs wa_evolution --tail 50"
  echo "  docker logs wa_postgres --tail 50"
  exit 1
fi
