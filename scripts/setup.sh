#!/usr/bin/env bash
# ============================================================
#  WhatsApp AI Assistant — Setup Helper
#  Run this ONCE before first launch. It
#    1. creates .env from .env.example,
#    2. generates safe random secrets for every CHANGE_ME secret,
#    3. generates the bcrypt N8N_OWNER_PASSWORD_HASH from a password you type,
#    4. checks that the values you must fill in yourself are set.
#
#  Usage:  bash scripts/setup.sh
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

echo "=================================================="
echo "  WhatsApp AI Assistant — Setup"
echo "=================================================="
echo ""

# ── helpers ────────────────────────────────────────────────
# Replace KEY=... in .env without touching anything else. awk+ENVIRON keeps
# "$" and "/" in values (bcrypt hashes!) exactly as they are.
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$ENV_FILE"; then
    KEY="$key" VAL="$val" awk 'BEGIN{FS=OFS="="} $1==ENVIRON["KEY"]{print ENVIRON["KEY"] "=" ENVIRON["VAL"]; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Current value of KEY in .env, with surrounding quotes removed (no sourcing -> no "$" expansion)
get_env() {
  local v
  v="$(grep -E "^${1}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  v="${v%$'\r'}"
  v="${v#\'}"; v="${v%\'}"
  v="${v#\"}"; v="${v%\"}"
  printf '%s' "$v"
}

is_placeholder() { [[ -z "$1" || "$1" == CHANGE_ME* ]]; }

random_hex() { # random_hex <bytes>
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$1"
  else
    python3 -c "import secrets,sys; print(secrets.token_hex(int(sys.argv[1])))" "$1"
  fi
}

# ── 1. Check for .env ──────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  echo "✅ Created .env from .env.example"
else
  # tolerate .env files saved with Windows (CRLF) line endings
  sed -i 's/\r$//' "$ENV_FILE"
fi

# ── 2. Generate random secrets (letters/digits only: they end up inside URLs) ──
for pair in "POSTGRES_PASSWORD:16" "REDIS_PASSWORD:16" "N8N_ENCRYPTION_KEY:32" "EVOLUTION_API_KEY:24" "WEBHOOK_SECRET:16"; do
  KEY="${pair%%:*}"; BYTES="${pair##*:}"
  if is_placeholder "$(get_env "$KEY")"; then
    set_env "$KEY" "$(random_hex "$BYTES")"
    echo "🔑 Generated $KEY"
  fi
done

# ── 3. Generate bcrypt hash if placeholder ─────────────────
if is_placeholder "$(get_env N8N_OWNER_PASSWORD_HASH)"; then
  echo ""
  echo "🔐 You need a bcrypt password hash for N8N_OWNER_PASSWORD_HASH."
  read -rsp "   Enter the password you want to use for n8n login: " RAW_PASS
  echo ""
  if [[ -z "$RAW_PASS" ]]; then
    echo "❌ Empty password. Re-run the script."
    exit 1
  fi

  # Try htpasswd, then Python bcrypt, then a throw-away Docker container.
  # Every attempt is allowed to fail (e.g. Docker installed but not running).
  HASH=""
  if command -v htpasswd &>/dev/null; then
    HASH=$(htpasswd -bnBC 12 "" "$RAW_PASS" 2>/dev/null | tr -d ':\r\n') || HASH=""
  fi
  if [[ "$HASH" != \$2* ]] && python3 -c "import bcrypt" 2>/dev/null; then
    HASH=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(rounds=12)).decode())" "$RAW_PASS" 2>/dev/null | tr -d '\r\n') || HASH=""
  fi
  if [[ "$HASH" != \$2* ]] && command -v docker &>/dev/null; then
    HASH=$(docker run --rm httpd:2.4-alpine htpasswd -nbBC 12 "" "$RAW_PASS" 2>/dev/null | tr -d ':\r\n') || HASH=""
  fi

  if [[ "$HASH" != \$2* ]]; then
    echo ""
    echo "❌ Could not generate a bcrypt hash. Install ONE of these and re-run:"
    echo "     apt install apache2-utils   # Debian/Ubuntu (htpasswd)"
    echo "     pip install bcrypt          # any OS with Python"
    echo "     Docker Desktop (must be running)"
    exit 1
  fi

  # htpasswd prints $2y$ — n8n's bcrypt expects the equivalent $2b$ prefix
  HASH="${HASH/#\$2y\$/\$2b\$}"

  # Single quotes are REQUIRED: the hash contains "$" which Docker Compose and bash would expand.
  set_env N8N_OWNER_PASSWORD_HASH "'${HASH}'"
  echo "✅ N8N_OWNER_PASSWORD_HASH written to .env"
fi

# ── 4. Validate what the script cannot generate ────────────
MISSING=0
for VAR in GEMINI_API_KEY; do
  if is_placeholder "$(get_env "$VAR")"; then
    echo "❌ Missing or placeholder: $VAR  (get one at https://aistudio.google.com/apikey)"
    MISSING=1
  fi
done

for VAR in YOUR_PHONE ESCALATION_PHONE; do
  if [[ "$(get_env "$VAR")" == "+1234567890" ]]; then
    echo "⚠️  $VAR is still the example number +1234567890 — set your real number (with country code)."
  fi
done

if [[ "$MISSING" -eq 1 ]]; then
  echo ""
  echo "Open $ENV_FILE, fill in the values above, then re-run this script."
  exit 1
fi

# ── 5. Create ssl directory (needed even without production profile)
mkdir -p "$ROOT_DIR/config/ssl"

echo ""
echo "✅ .env is ready."
echo ""
echo "Start the stack:"
echo "  cd docker"
echo "  docker compose --env-file ../.env up -d"
echo ""
echo "Then open http://localhost:5678 and log in with:"
echo "  Email:    $(get_env N8N_OWNER_EMAIL)"
echo "  Password: (the password you just entered)"
echo ""
echo "Next: README steps 4-7 (import workflows, PostgreSQL credential, error workflow, QR)."
