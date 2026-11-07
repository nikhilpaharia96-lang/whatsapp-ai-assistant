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

## Troubleshooting
- **Services can't reach each other**: Railway's private network can be IPv6-only in older environments. Check
  the "Private Networking" docs; if needed, enable dual-stack or use the TCP proxy hostnames for a test.
- **n8n "Bad Gateway"**: the public domain must target port 5678 (`N8N_PORT=5678`).
- **Out of memory / restarts**: Usage -> check RAM per service; Trial caps each service at 1 GB.
- **Credit running out fast**: stop `Evolution` and `n8n` when you are not testing.
