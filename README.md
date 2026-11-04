# WhatsApp AI Assistant (Gemini)

A self-hosted WhatsApp AI assistant powered by **Google Gemini**, **n8n**, and **Evolution API v2**, running entirely in Docker.

> New here? Read **[docs/GUIDE.md](docs/GUIDE.md)** (Hinglish): what this project does, how a message flows
> through it, and how to customize contacts, tone and portfolio.

---

## Quick Start (Windows 11 / Docker Desktop)

### 1. Copy and fill in `.env`

```bat
copy .env.example .env
```

Open `.env` in any text editor and fill in every `CHANGE_ME` value (at minimum `GEMINI_API_KEY`,
your phone numbers and `EVOLUTION_INSTANCE_NAME`).

> Use only **letters and digits** in passwords/keys — they are embedded in connection URLs.

**Important field — `N8N_OWNER_PASSWORD_HASH`:**
n8n v1+ no longer supports basic-auth environment variables. Your login password must be stored as a **bcrypt hash**.

**Option A — Use the setup script (Linux/Mac/WSL/Git Bash):**
```bash
bash scripts/setup.sh
```
It generates safe random values for all passwords/keys, asks for your n8n password and writes the hash
(correctly quoted) into `.env`. Then only `GEMINI_API_KEY` and your phone numbers are left to fill in.

**Option B — Generate the hash manually on Windows with Python:**
```bat
pip install bcrypt
python -c "import bcrypt; print(bcrypt.hashpw(b'YourPassword', bcrypt.gensalt(12)).decode())"
```
Paste the output (starting with `$2b$`) into `.env` **wrapped in single quotes**:
```
N8N_OWNER_PASSWORD_HASH='$2b$12$abcdefghijklmnopqrstuv...'
```
Without the single quotes Docker Compose treats every `$...` in the hash as a variable and corrupts it
(you would then be unable to log in).

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

**Save it with the name `PostgreSQL`**, then open both imported workflows and make sure every
PostgreSQL node (red warning icon) has this credential selected — n8n cannot guess the credential ID
from the exported file.

### 6. Set the error workflow and activate

1. Open **WhatsApp AI Assistant — Main (Gemini)** → **⋯ → Settings → Error Workflow** → choose **Error Handler** → Save.
   (This can't be stored in the exported JSON because n8n assigns the workflow ID on import.)
2. Toggle both imported workflows to **Active**.

### 7. Connect WhatsApp (scan QR)

1. Create an instance (the instance name must match `EVOLUTION_INSTANCE_NAME` in `.env`):
   ```bash
   curl -X POST http://localhost:8080/instance/create \
     -H "apikey: <EVOLUTION_API_KEY from .env>" -H "Content-Type: application/json" \
     -d '{"instanceName":"my-whatsapp","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
   ```
2. Show the QR code: open **http://localhost:8080/manager** (log in with the API key), or call
   `GET /instance/connect/my-whatsapp` with the same `apikey` header.
3. Scan it with WhatsApp → **Linked devices**.
4. If you changed `EVOLUTION_INSTANCE_NAME`, restart n8n so the error handler picks it up:
   `docker compose --env-file ..\.env up -d`.
5. Done — incoming messages now flow Evolution → n8n → Gemini → reply. Only 1:1 text chats are answered
   (groups, status updates and media are ignored).

### 8. Test it

```bash
bash scripts/test.sh
```
Test 7 sends a real AI reply to `TEST_PHONE` (defaults to your `ESCALATION_PHONE`, i.e. yourself).

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
     │  global webhook → http://n8n:5678/webhook/whatsapp?secret=<WEBHOOK_SECRET>
     ▼
n8n workflow
  ├─ Validate & extract message  (checks secret, skips groups/media/own messages)
  ├─ Rate limit check  (PostgreSQL)
  ├─ Load / create contact  (PostgreSQL, classified via FAMILY_NUMBERS / FRIEND_NUMBERS)
  ├─ Load conversation history  (PostgreSQL)
  ├─ Build Gemini prompt
  ├─ Call Gemini API  (google generativelanguage.googleapis.com)
  ├─ Parse AI response  (split into WhatsApp-sized chunks)
  ├─ Send WhatsApp reply  → Evolution API (every chunk, in order)
  ├─ Save reply + audit log  (PostgreSQL)
  └─ Escalation check → alert you via WhatsApp (if needed) → respond 200
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

1. Edit `config/nginx.conf` — replace `n8n.yourdomain.com` and `evo.yourdomain.com` with your real domains,
   **and replace both `YOUR.IP.ADDRESS.HERE` with your own public IP** (nginx refuses to start otherwise).
2. Place your SSL certificates in `config/ssl/` as `fullchain.pem` and `privkey.pem`.
3. In `.env`, set:
   ```
   N8N_HOST=n8n.yourdomain.com
   N8N_PROTOCOL=https
   WEBHOOK_URL=https://n8n.yourdomain.com
   EVOLUTION_SERVER_URL=https://evo.yourdomain.com
   ```
   Leave `EVOLUTION_BASE_URL=http://evolution:8080` unchanged: n8n talks to Evolution inside Docker.
   (Pointing it at the public domain would send n8n's own calls through nginx, which only allows your IP.)
4. Start with the production profile:
   ```bash
   docker compose --env-file ../.env --profile production up -d
   ```

---

## Troubleshooting

**Can't log in to n8n / `N8N_OWNER_PASSWORD_HASH` error**
- The hash must start with `$2b$` and be wrapped in **single quotes** in `.env` (see step 1). Check with
  `docker compose --env-file ..\.env config` — you must see the complete hash (Compose prints each `$` as `$$`).
- The owner env vars need n8n ≥ 2.17 (`docker compose pull n8n`).

**`access to env vars denied` / `$env.… undefined` in n8n nodes**
- n8n 2.x blocks `$env` by default. `docker-compose.yml` sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`;
  make sure you recreated the container after updating (`docker compose --env-file ..\.env up -d`).

**Gemini returns 404 "model is no longer available"**
- `gemini-2.0-flash` was retired by Google in June 2026 and older 2.5 models are being phased out.
  Set `GEMINI_MODEL` in `.env` to a current Flash model (default: `gemini-3.8-flash`) and recreate n8n.
  List the models your key can use:
  `curl -H "x-goog-api-key: $GEMINI_API_KEY" https://generativelanguage.googleapis.com/v1beta/models`

**Bot never answers (nothing in n8n → Executions)**
- Check the instance is connected (`/manager`) and that `WEBHOOK_EVENTS_MESSAGES_UPSERT` is `true` for Evolution.
- The webhook URL carries `?secret=<WEBHOOK_SECRET>`; if you changed the secret, recreate **both** containers.
- Groups, status updates, voice notes, images etc. are intentionally ignored.

**Evolution API can't connect to PostgreSQL**
- Wait 30–60 s after first start — Evolution API runs Prisma migrations on boot.
- Evolution uses its own schema (`evolution`). `init.sql` creates it, but it only runs on a *fresh*
  database volume. On an existing volume run once:
  `docker exec wa_postgres psql -U wauser -d waassistant -c "CREATE SCHEMA IF NOT EXISTS evolution;"`
- Check logs: `docker logs wa_evolution --tail 50`

**Workflows say "credentials not found"**
- You must manually create the PostgreSQL credential in n8n UI and select it in each PostgreSQL node (step 5).

**QR code expired**
- Evolution API QR codes expire in ~60 seconds. Fetch a fresh one and scan immediately.

**`docker compose` vs `docker-compose`**
- This project requires **Docker Compose v2** (`docker compose` with a space).
- If you only have the old `docker-compose` binary, upgrade Docker Desktop.
