# WhatsApp AI Assistant (Gemini)

A self-hosted WhatsApp AI assistant powered by **Google Gemini**, **n8n**, and **Evolution API v2**, running entirely in Docker.

---

## Quick Start (Windows 11 / Docker Desktop)

### 1. Copy and fill in `.env`

```bat
copy .env.example .env
```

Open `.env` in any text editor and fill in every `CHANGE_ME` value.

**Important new field — `N8N_OWNER_PASSWORD_HASH`:**
n8n v1+ no longer supports basic-auth environment variables. Your login password must be stored as a **bcrypt hash**.

**Option A — Use the setup script (Linux/Mac/WSL):**
```bash
bash scripts/setup.sh
```

**Option B — Generate the hash manually on Windows with Python:**
```bat
pip install bcrypt
python -c "import bcrypt; print(bcrypt.hashpw(b'YourPassword', bcrypt.gensalt(12)).decode())"
```
Paste the output (starting with `$2b$`) as the value of `N8N_OWNER_PASSWORD_HASH` in `.env`.

### 2. Start the stack

```bat
cd docker
docker compose --env-file ..\.env up -d
```

That's it. Docker will start:
| Service | URL |
|---------|-----|
| **n8n** (workflow engine) | http://localhost:5678 |
| **Evolution API** (WhatsApp gateway) | http://localhost:8080 |
| PostgreSQL | internal only |
| Redis | internal only |

### 3. Log in to n8n

- URL: **http://localhost:5678**
- Email: value of `N8N_OWNER_EMAIL` (default: `admin@localhost.local`)
- Password: the plaintext password whose hash you put in `N8N_OWNER_PASSWORD_HASH`

### 4. Import the workflows

In n8n → **Workflows → Import from file**:

1. `n8n-workflows/main-workflow.json` — the main WhatsApp ↔ Gemini pipeline
2. `n8n-workflows/error-handler.json` — catches unhandled errors and alerts you

### 5. Create the PostgreSQL credential in n8n

In n8n → **Credentials → New → PostgreSQL**:

| Field | Value |
|-------|-------|
| Host | `postgres` |
| Port | `5432` |
| Database | value of `POSTGRES_DB` (default: `waassistant`) |
| User | value of `POSTGRES_USER` (default: `wauser`) |
| Password | value of `POSTGRES_PASSWORD` |

**Save it with the name `PostgreSQL`** — that matches what the imported workflows expect.

### 6. Activate the workflows

Toggle both imported workflows to **Active** in n8n.

### 7. Connect WhatsApp (scan QR)

1. Open **http://localhost:8080** (Evolution API swagger UI or use curl)
2. Create a new instance. Set the instance name (e.g., `my-whatsapp`).
3. Update `EVOLUTION_INSTANCE_NAME` in your `.env` to match.
4. Fetch the QR code and scan it with your WhatsApp mobile app.
5. Done — incoming messages will now flow through n8n → Gemini.

---

## Project Structure

```
whatsapp-ai-assistant/
├── .env.example          ← copy to .env and fill in
├── docker/
│   └── docker-compose.yml
├── database/
│   └── init.sql          ← auto-loaded by PostgreSQL on first start
├── n8n-workflows/
│   ├── main-workflow.json
│   └── error-handler.json
├── config/
│   ├── nginx.conf        ← used only with --profile production
│   └── ssl/              ← place fullchain.pem + privkey.pem here for HTTPS
├── scripts/
│   ├── setup.sh          ← generates bcrypt hash, validates .env
│   └── test.sh           ← smoke-tests the running stack
└── docs/
```

---

## Architecture

```
WhatsApp user
     │
     ▼
Evolution API v2  (port 8080)
     │  global webhook → http://n8n:5678/webhook/whatsapp
     ▼
n8n workflow
  ├─ Validate & extract message
  ├─ Rate limit check  (PostgreSQL)
  ├─ Load / create contact  (PostgreSQL)
  ├─ Load conversation history  (PostgreSQL)
  ├─ Build Gemini prompt
  ├─ Call Gemini API  (google generativelanguage.googleapis.com)
  ├─ Parse AI response
  ├─ Send WhatsApp reply  → Evolution API
  ├─ Save reply to DB  (PostgreSQL)
  └─ Escalation check → alert you via WhatsApp (if needed)
```

---

## Common Commands

```bat
# Start
cd docker
docker compose --env-file ..\.env up -d

# View logs
docker compose --env-file ..\.env logs -f

# Stop
docker compose --env-file ..\.env down

# Stop + wipe all data (careful!)
docker compose --env-file ..\.env down -v
```

---

## Production (VPS / HTTPS)

1. Edit `config/nginx.conf` — replace `n8n.yourdomain.com` and `evo.yourdomain.com` with your real domains.
2. Place your SSL certificates in `config/ssl/` as `fullchain.pem` and `privkey.pem`.
3. In `.env`, set:
   ```
   N8N_HOST=n8n.yourdomain.com
   N8N_PROTOCOL=https
   WEBHOOK_URL=https://n8n.yourdomain.com
   EVOLUTION_BASE_URL=https://evo.yourdomain.com
   ```
4. Start with the production profile:
   ```bash
   docker compose --env-file ../.env --profile production up -d
   ```

---

## Troubleshooting

**n8n won't start / `N8N_OWNER_PASSWORD_HASH` error**
- Make sure the hash starts with `$2b$` and has no quotes around it in `.env`.

**Evolution API can't connect to PostgreSQL**
- Wait 30–60 s after first start — Evolution API runs Prisma migrations on boot.
- Check logs: `docker logs wa_evolution --tail 50`

**Workflows say "credentials not found"**
- You must manually create the PostgreSQL credential in n8n UI (step 5 above).

**QR code expired**
- Evolution API QR codes expire in ~60 seconds. Fetch a fresh one and scan immediately.

**`docker compose` vs `docker-compose`**
- This project requires **Docker Compose v2** (`docker compose` with a space).
- If you only have the old `docker-compose` binary, upgrade Docker Desktop.
