#!/usr/bin/env bash
# ============================================================
#  WhatsApp AI Assistant — Setup Helper
#  Run this ONCE before first launch to generate your
#  N8N_OWNER_PASSWORD_HASH and validate the .env file.
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

# ── 1. Check for .env ──────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
  echo "✅ Created .env from .env.example"
  echo "   → Edit $ENV_FILE and fill in all CHANGE_ME values, then re-run this script."
  exit 0
fi

# ── 2. Generate bcrypt hash if placeholder ─────────────────
source "$ENV_FILE" 2>/dev/null || true

if [[ "${N8N_OWNER_PASSWORD_HASH:-}" == "CHANGE_ME_bcrypt_hash_of_your_password" || -z "${N8N_OWNER_PASSWORD_HASH:-}" ]]; then
  echo "🔐 You need a bcrypt password hash for N8N_OWNER_PASSWORD_HASH."
  read -rsp "   Enter the password you want to use for n8n login: " RAW_PASS
  echo ""

  # Try apache2-utils (htpasswd) first, then Python passlib as fallback
  if command -v htpasswd &>/dev/null; then
    HASH=$(htpasswd -bnBC 12 "" "$RAW_PASS" | tr -d ':\n')
  elif python3 -c "import bcrypt" 2>/dev/null; then
    HASH=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(rounds=12)).decode())" "$RAW_PASS")
  else
    echo ""
    echo "❌ Neither htpasswd nor Python bcrypt is available."
    echo "   Install one of:"
    echo "     apt install apache2-utils   # Debian/Ubuntu"
    echo "     pip install bcrypt"
    echo "   Then re-run this script."
    exit 1
  fi

  # Write hash into .env (replace the placeholder line)
  if grep -q "^N8N_OWNER_PASSWORD_HASH=" "$ENV_FILE"; then
    sed -i "s|^N8N_OWNER_PASSWORD_HASH=.*|N8N_OWNER_PASSWORD_HASH=${HASH}|" "$ENV_FILE"
  else
    echo "N8N_OWNER_PASSWORD_HASH=${HASH}" >> "$ENV_FILE"
  fi

  echo "✅ N8N_OWNER_PASSWORD_HASH written to .env"
fi

# ── 3. Validate required variables ─────────────────────────
source "$ENV_FILE" 2>/dev/null || true

REQUIRED_VARS=(
  POSTGRES_PASSWORD
  REDIS_PASSWORD
  N8N_ENCRYPTION_KEY
  N8N_OWNER_PASSWORD_HASH
  EVOLUTION_API_KEY
  GEMINI_API_KEY
)

MISSING=0
for VAR in "${REQUIRED_VARS[@]}"; do
  VAL="${!VAR:-}"
  if [[ -z "$VAL" || "$VAL" == CHANGE_ME* ]]; then
    echo "❌ Missing or placeholder: $VAR"
    MISSING=1
  fi
done

if [[ "$MISSING" -eq 1 ]]; then
  echo ""
  echo "Please fill in all CHANGE_ME values in $ENV_FILE and re-run this script."
  exit 1
fi

# ── 4. Create ssl directory (needed even without production profile)
mkdir -p "$ROOT_DIR/config/ssl"

echo ""
echo "✅ All required variables are set."
echo ""
echo "Start the stack:"
echo "  cd docker"
echo "  docker compose --env-file ../.env up -d"
echo ""
echo "Then open http://localhost:5678 and log in with:"
echo "  Email:    ${N8N_OWNER_EMAIL:-admin@localhost.local}"
echo "  Password: (the password you just entered)"
echo ""
echo "Next: go to http://localhost:8080 → create a WhatsApp instance → scan QR."
