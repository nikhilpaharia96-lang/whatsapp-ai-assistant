# 30-day test deploy on Railway (Trial plan)

For **testing only**. Railway Trial = one-time $5 credit, valid for at most 30 days, max 1 GB RAM per service,
0.5 GB volumes, max 5 services per project
([Free Trial](https://docs.railway.com/pricing/free-trial), [Plans](https://docs.railway.com/pricing/plans)).
When the credit is spent (or after 30 days) the project drops to the Free plan and your services stop; volumes
(your database!) are deleted 30 days after the credit expires.

RAM costs about $10 per GB per month, so this stack (roughly 1 GB in total, my estimate) will probably eat the
$5 in **1-2 weeks**. Watch **Usage** in the dashboard from day one.

> Prerequisite: sign up with GitHub and let Railway verify the account. An unverified ("Limited") trial restricts
> outbound network and ports, so Evolution (WhatsApp) and Gemini calls may fail.

## 0. Prepare values on your computer
```bash
bash scripts/setup.sh          # creates .env with random passwords and the bcrypt hash
```
You will copy these values (POSTGRES_PASSWORD, REDIS_PASSWORD, N8N_ENCRYPTION_KEY, EVOLUTION_API_KEY,
WEBHOOK_SECRET, N8N_OWNER_PASSWORD_HASH) into the Railway variables below. Open `.env.railway.example`: it has one
ready-to-paste block per service.

## 1. Create the project and the 4 services
New Project -> **Empty project**, then add four services with **Add -> Docker Image**. Name them exactly:

| Service name | Image | Volume | Notes |
|---|---|---|---|
| `Postgres` | `postgres:16-alpine` | `/var/lib/postgresql/data` | Variables from the Postgres block |
| `Redis` | `redis:7-alpine` | none | Custom start command from the Redis block |
| `Evolution` | `evoapicloud/evolution-api:v2.3.7` | none | Variables from the Evolution block |
| `n8n` | `n8nio/n8n:latest` | `/home/node/.n8n` | Variables from the n8n block |

(If you name a service differently, change the `${{Name.RAILWAY_PRIVATE_DOMAIN}}` references to match.)
Trial allows only 0.5 GB per volume, so keep the n8n volume small (the n8n block already limits stored executions).

## 2. Create the database tables (once)
1. In `Postgres` -> Settings -> Networking, enable **TCP Proxy** for port 5432. Note the host and port shown.
2. From your computer (needs `psql`):
   ```bash
   psql "postgresql://wauser:<PG_PASSWORD>@<proxy-host>:<proxy-port>/waassistant" -f database/init.sql
   ```
3. Disable the TCP proxy again afterwards (nobody should reach your database from the internet).

## 3. Start the services in this order
`Postgres` -> `Redis` -> `Evolution` -> `n8n`. Check each one's **Deploy Logs** before starting the next.
- Evolution takes ~1 minute on first boot (database migration).
- n8n: Settings -> Networking -> **Generate Domain** (port 5678). Put that domain into `N8N_HOST` and `WEBHOOK_URL`, then redeploy n8n.
- Evolution: Generate Domain (port 8080) only while you need the QR code / manager; put it in `SERVER_URL`.
  Delete the domain afterwards.

## 4. Configure n8n and WhatsApp
Open `https://<n8n domain>`, log in with `N8N_INSTANCE_OWNER_EMAIL` and the password behind your hash, then
follow README steps 4-7: import both workflows, create the `PostgreSQL` credential (host = the private
domain of `Postgres`, port 5432, database `waassistant`), select it in every Postgres node, set Error Workflow,
activate, then create the Evolution instance (name = `EVOLUTION_INSTANCE_NAME`) and scan the QR.
Use a **secondary WhatsApp number** for the test.

## 5. Test
Send a message from another phone. In n8n -> Executions only failed runs are kept (by design, to save space);
for debugging a successful run, temporarily remove `EXECUTIONS_DATA_SAVE_ON_SUCCESS`.

## 6. Before the trial ends (day ~25, or when Usage shows < $1 left)
```bash
# via the Postgres TCP proxy again
pg_dump "postgresql://wauser:<PG_PASSWORD>@<proxy-host>:<proxy-port>/waassistant" > backup-$(date +%F).sql
```
Then either upgrade to Hobby ($5/month, includes $5 usage) to keep running, or move to the Oracle guide
(`docs/DEPLOY-ORACLE.md`) and restore with `psql ... < backup.sql`. Note: WhatsApp login lives in the Evolution
schema of the same database, so a restore keeps the session, but you may have to scan the QR again.

## Fixing "remaining connection slots are reserved..." and "access to env vars denied"

### A. `access to env vars denied` (Code node "Validate & Extract")
n8n 2.x blocks `$env.*` inside nodes by default. This workflow reads its settings (webhook secret, phone lists,
Gemini and Evolution keys) from `$env`, so the first Code node fails.
1. Railway -> service **n8n** (not Evolution) -> Variables -> add `N8N_BLOCK_ENV_ACCESS_IN_NODE` = `false`.
2. **Click Deploy**: Railway stages variable changes and n8n only reads them at start. Check Deploy Logs for a restart.
3. Check the other n8n variables the nodes need exist on the n8n service: `WEBHOOK_SECRET`, `GEMINI_API_KEY`,
   `GEMINI_MODEL`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `ESCALATION_PHONE`, `YOUR_NAME`.
Security note: with the block off, anyone who can edit workflows in your n8n can read these variables. That is fine for
a single-owner instance (owner is created from env, sign-up is closed). Never invite other users with edit rights.

### B. `remaining connection slots are reserved for roles with the SUPERUSER attribute`
Postgres allows 100 connections by default; the last few are reserved for superusers, so every normal client gets this
error once ~97 are in use. Likely consumers, from the code and configuration (confirm with the query below):
- **Evolution (Prisma)**: its pool defaults to (CPU cores x 2 + 1), and on Railway a container sees the host's cores.
  No cap was set. -> `connection_limit=5` now in `DATABASE_CONNECTION_URI`.
- **n8n Postgres credential**: "Maximum Number of Connections" defaults to a very high value (100 as far as I know).
  -> set it to 5 (below).
- **n8n's own DB pool** (`DB_POSTGRESDB_POOL_SIZE`, default 2) -> set to 4 explicitly.
- Leftovers from restarts/redeploys of those services.

Steps, in order (no data is deleted):
1. **Get in.** Postgres service -> Networking -> enable TCP Proxy (5432). Connect with the superuser (`POSTGRES_USER`),
   which can use the reserved slots: `psql "postgresql://<POSTGRES_USER>:<PW>@<proxy-host>:<port>/waassistant" -f database/diagnose_connections.sql`.
   It shows used/max, which application holds the connections, and which roles are superusers. If you cannot connect
   even as the superuser, restart **Evolution** and **n8n** first (Restart, not Redeploy-from-scratch; Postgres stays untouched).
2. **Cap the clients.**
   - Evolution variables: `DATABASE_CONNECTION_URI` must end with `?schema=evolution&connection_limit=5`.
   - n8n variables: `DB_POSTGRESDB_POOL_SIZE=4`.
   - n8n UI -> Credentials -> **PostgreSQL** -> **Maximum Number of Connections = 5** -> Save.
     (Edit the existing credential; do not recreate it.)
3. **Deploy** Evolution and n8n (staged variables only apply after Deploy).
4. Re-run the diagnose query: expect roughly <= 15 connections in total.
5. Turn the TCP Proxy off again.
Optional: if your n8n credential user is not a superuser while Evolution is, that explains why only n8n sees the error.

### C. Check the whole chain
From any terminal (replace the placeholders; nothing here sends a WhatsApp message):
```bash
# 1. production webhook reachable + secret check works  -> {"ok":true,"skipped":"not_a_message"}
curl -s -X POST "https://<N8N_PUBLIC_DOMAIN>/webhook/whatsapp?secret=<WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" -d '{"event":"connection.update","instance":"my-whatsapp"}'
# 2. wrong secret is refused  -> {"ok":true,"skipped":"unauthorized"}
curl -s -X POST "https://<N8N_PUBLIC_DOMAIN>/webhook/whatsapp?secret=wrong" \
  -H "Content-Type: application/json" -d '{"event":"messages.upsert"}'
# 3. Gemini key + model valid (prints model names)
curl -s -H "x-goog-api-key: <GEMINI_API_KEY>" https://generativelanguage.googleapis.com/v1beta/models | grep '"name"' | head
```
`/webhook/` (production) only answers while the workflow is **Active**; `/webhook-test/` works only while the editor
is listening. Evolution must call the production URL (`.../webhook/whatsapp?secret=...`), which `WEBHOOK_GLOBAL_URL` does.
If (1) works but real messages do not arrive: Evolution logs (`WEBHOOKS` lines) show the delivery error; most often the
`WEBHOOK_SECRET` differs between the Evolution and n8n services, or the private domain does not resolve.

## Troubleshooting
- **Services can't reach each other**: Railway's private network can be IPv6-only in older environments. Check
  the "Private Networking" docs; if needed, enable dual-stack or use the TCP proxy hostnames for a test.
- **n8n "Bad Gateway"**: the public domain must target port 5678 (`N8N_PORT=5678`).
- **Out of memory / restarts**: Usage -> check RAM per service; Trial caps each service at 1 GB.
- **Credit running out fast**: stop `Evolution` and `n8n` when you are not testing.
