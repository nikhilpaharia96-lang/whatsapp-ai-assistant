# Deploy on Oracle Cloud Always Free (₹0 hosting)

Oracle's Always Free tier gives an ARM VM (about 2 OCPU / 12 GB RAM at the time of writing, check Oracle's
page) with no monthly fee. Catches: sign-up needs a credit/debit card (no prepaid/virtual), the VM can be
"out of capacity" for days, idle VMs can be reclaimed, and accounts unused for 30 days can be suspended.

## 1. Create the account
1. https://www.oracle.com/cloud/free/ -> Start for free. Use a real card and phone number.
2. Pick your **home region** carefully (cannot be changed). Choose one close to you with free capacity.

## 2. Create the VM
Console -> Compute -> Instances -> Create instance:
- Image: **Canonical Ubuntu 24.04** (ARM / aarch64).
- Shape: **VM.Standard.A1.Flex**, 2 OCPU, 12 GB RAM (stay inside the "Always Free-eligible" label).
- Networking: public IPv4 assigned. Add your SSH public key (or let Oracle generate one and download it).
- Boot volume: 50-100 GB.
- "Out of host capacity"? Try another availability domain, try again later, or use fewer OCPU (1 OCPU / 6 GB works).
- Do NOT add open ports besides SSH (22). The app is reached through an SSH tunnel.

## 3. Prepare the server
```bash
ssh -i <your-key> ubuntu@<SERVER_PUBLIC_IP>
git clone https://github.com/nikhilpaharia96-lang/whatsapp-ai-assistant
cd whatsapp-ai-assistant
bash scripts/server-setup.sh     # installs Docker; log out/in once, run it again
```
The second run adds swap and checks that all four images have an **arm64** build. If one says FAIL,
that image cannot run on the free ARM VM; tell me/open an issue, or use a Hetzner x86 server (~EUR 4/month).

Ubuntu images on Oracle also block ports with iptables by default; that is fine, we need none.

## 4. Configure and start
```bash
bash scripts/setup.sh            # generates secrets, asks for your n8n password
nano .env                        # fill GEMINI_API_KEY, YOUR_NAME, YOUR_PHONE, ESCALATION_PHONE, FAMILY/FRIEND numbers, EVOLUTION_INSTANCE_NAME
cd docker
docker compose --env-file ../.env up -d
docker compose --env-file ../.env ps         # all services "running"/"healthy"
```

## 5. Open the dashboards from your laptop (SSH tunnel)
n8n and Evolution listen only on the server's localhost (`BIND_ADDR=127.0.0.1`), so nobody on the internet can reach them.
On **your laptop**:
```bash
ssh -i <your-key> -L 5678:localhost:5678 -L 8080:localhost:8080 ubuntu@<SERVER_PUBLIC_IP>
```
Keep it open, then browse to http://localhost:5678 (n8n) and http://localhost:8080/manager (Evolution).
Then follow README steps 4-7 (import workflows, PostgreSQL credential, error workflow, create instance, scan QR).

The bot itself keeps running without the tunnel; you only need it when you want the dashboards.

## 6. Keep it alive and healthy
- Containers restart automatically (`restart: unless-stopped`) and after a server reboot.
- Oracle may reclaim a VM that is idle for 7 days (CPU/network below 20%). A bot with regular messages is
  usually fine, but check the VM once a week. Back up before you rely on it:
  `docker exec wa_postgres pg_dump -U wauser waassistant > backup-$(date +%F).sql`
- Update: `git pull`, then `docker compose --env-file ../.env pull && docker compose --env-file ../.env up -d`.
- Logs: `docker logs wa_n8n --tail 50`, `docker logs wa_evolution --tail 50`.
- Keep the account active (log in at least monthly).

## 7. Use a secondary WhatsApp number first
Evolution API uses an unofficial WhatsApp Web connection. WhatsApp can restrict such numbers.
