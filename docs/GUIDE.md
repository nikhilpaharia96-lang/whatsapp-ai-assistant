# Guide: ye repo kya hai, kya karta hai, kaise use karein

## 1. Ye repo kya karta hai

Ye ek **self-hosted WhatsApp AI assistant** hai. Aapke WhatsApp number pe jo bhi message aata hai,
ye usko padhta hai, **Google Gemini** se jawab banwata hai, aur aapke number se hi wapas bhej deta hai,
bilkul aapki tarah baat karte hue. Sab kuch aapke apne computer/server pe Docker me chalta hai.

Isme 4 main hisse hain:

| Hissa | Kaam |
|-------|------|
| **Evolution API** | WhatsApp se connect hota hai (QR scan karke, jaise WhatsApp Web). Message receive aur send karta hai. |
| **n8n** | Dimaag/workflow. Har message pe step-by-step logic chalata hai (neeche dekhein). |
| **Google Gemini** | AI model jo asli jawab likhta hai. |
| **PostgreSQL** (+ Redis) | Contacts, puri chat history, escalations, rate limits aur logs save karta hai. |

## 2. Ye kya-kya kar sakta hai

- **Aapki jagah auto-reply**: text message aate hi AI jawab deta hai, thoda random delay (1-3 sec) ke saath taaki natural lage.
- **Alag-alag logon ke liye alag tone**:
  - `friend`: casual, dost jaisa
  - `family`: pyaar aur care wala
  - `client`: professional, aur aapki `portfolio` table se skills/pricing/projects ka context use karta hai
  - `unknown`: friendly par thoda reserved
- **Yaaddasht**: har contact ki pichhli 48 ghante ki (max 30) baatein yaad rakhta hai, to conversation beech se nahi tootti.
- **Escalation alert**: agar baat me legal dhamki, medical emergency, bada deal ($5000+), emotional crisis ya "urgent baat karni hai" jaisa kuch ho, to AI normal reply deta hai **aur aapko WhatsApp pe alert bhejta hai** (`ESCALATION_PHONE` pe).
- **Spam se bachav**: ek number se ghante me `RATE_LIMIT_PER_HOUR` (default 20) se zyada message ho jayein to unko jawab nahi milta.
- **Block list**: kisi contact ko block kar dein to bot use kabhi jawab nahi dega.
- **Error alert**: workflow me kuch toote to aapko WhatsApp pe "System Error" message aata hai aur DB me log hota hai.
- **Audit log**: har processed message ka record (`audit_log` table).

## 3. Kaise kaam karta hai (ek message ka safar)

```
Koi aapko WhatsApp message bhejta hai
        |
        v
Evolution API  --(webhook, ?secret=...)-->  n8n
                                              |
   1. Validate     : secret sahi? text message hai? 1:1 chat hai? (group/photo/apna message = skip)
   2. Rate limit   : is number ne ghante me limit cross to nahi ki?  (cross = 429, ruk jao)
   3. Contact      : DB me dhundho/banao. FAMILY_NUMBERS / FRIEND_NUMBERS se type tay hota hai
   4. Blocked?     : block hai to yahin khatam
   5. History      : pichhle 48h ke max 30 messages + (client ho to) portfolio load
   6. Save         : aaya hua message DB me save
   7. Prompt       : tone + rules + contact info + history se Gemini ke liye request banti hai
   8. Gemini       : jawab generate
   9. Parse        : jawab saaf karo, [ESCALATE:...] tag hatao, lamba ho to chunks me todo
  10. Send         : Evolution ke through WhatsApp pe reply (har chunk, order me)
  11. Save + log   : reply aur audit log DB me
  12. Escalation?  : ho to escalation save + aapko alert
```

Zyada detail ke liye `n8n-workflows/main-workflow.json` n8n me kholkar dekh sakte hain, har step ek node hai.

## 4. Kaise use karein (short version)

Poore steps `README.md` me hain. Chhota rasta:

1. `bash scripts/setup.sh` : `.env` banata hai, passwords generate karta hai, n8n password ka hash banata hai.
2. `.env` me ye bharein: `GEMINI_API_KEY` ([aistudio.google.com/apikey](https://aistudio.google.com/apikey) se), `YOUR_NAME`, `YOUR_PHONE`, `ESCALATION_PHONE`, `FAMILY_NUMBERS`, `FRIEND_NUMBERS` (country code ke saath, jaise `+919876543210`).
3. `cd docker` phir `docker compose --env-file ../.env up -d`
4. n8n kholein (`http://localhost:5678`), dono workflows import karein, PostgreSQL credential banayein, Error Workflow set karein, workflows **Active** karein.
5. Evolution me instance banayein aur **QR scan** karein (WhatsApp > Linked devices).
6. Kisi dusre number se apne number pe "hi" bhej kar test karein, ya `bash scripts/test.sh` chalayein.

## 5. Apne hisaab se badalna

Database me seedhe command chalane ke liye:

```bash
docker exec wa_postgres psql -U wauser -d waassistant -c "<SQL YAHAN>"
```

| Kaam | SQL |
|------|-----|
| Contact ko client banana | `UPDATE contacts SET contact_type='client' WHERE phone='+919876543210';` |
| Contact ko block karna | `UPDATE contacts SET is_blocked=TRUE WHERE phone='+919876543210';` |
| Kisi ka tone alag karna | `UPDATE contacts SET tone_override='family' WHERE phone='+919876543210';` (sirf `friend`, `family`, `client`, `unknown`) |
| Contact ka naam/note dena | `UPDATE contacts SET display_name='Rahul', notes='College friend' WHERE phone='+919876543210';` |
| Pending escalations dekhna | `SELECT * FROM v_pending_escalations;` |
| Escalation resolve karna | `UPDATE escalations SET status='resolved', resolved_at=NOW() WHERE status='pending';` |
| Pichhli baatein dekhna | `SELECT * FROM v_recent_conversations LIMIT 50;` |
| Portfolio me nayi cheez | `INSERT INTO portfolio (category,title,content) VALUES ('skills','Meri skills','...');` |

Baaki cheezein:

- **Portfolio / bio / rates**: `database/init.sql` me seed example hain. **Inhe apni asli details se badal dein**, warna AI clients ko example wale rates batayega. Table me `UPDATE portfolio SET content='...' WHERE title='Rates and availability';`
- **Bot ka tone aur rules**: n8n me `Build AI Prompt` node kholein, upar `TONES` aur `Core Rules` text edit kar sakte hain.
- **Jawab ki lambai/creativity**: `.env` me `GEMINI_MAX_TOKENS` aur `GEMINI_TEMPERATURE`.
- **Model badalna**: `.env` me `GEMINI_MODEL`, phir `docker compose --env-file ../.env up -d`.
- **Rate limit**: `RATE_LIMIT_PER_HOUR`.

`.env` badalne ke baad containers ko dobara banana padta hai (`docker compose --env-file ../.env up -d`).

## 6. Roz ke commands

```bash
cd docker
docker compose --env-file ../.env up -d        # chalu
docker compose --env-file ../.env logs -f      # logs live
docker compose --env-file ../.env down         # band (data bacha rehta hai)
docker compose --env-file ../.env down -v      # band + SAARA data delete (sambhal ke!)
docker logs wa_n8n --tail 50                   # sirf n8n ke logs
```

n8n ke **Executions** tab me dikhta hai har message pe kya hua, kahan fail hua.

## 7. Limits aur dhyan rakhne wali baatein

- Sirf **text messages, 1-on-1 chats**. Photo, voice note, sticker, group aur status ignore hote hain.
- Evolution API **unofficial WhatsApp Web connection** (Baileys) use karta hai, official Business API nahi. WhatsApp kabhi-kabhi aise numbers ko restrict/ban kar deta hai, to **pehle kisi secondary number pe try karein**.
- Gemini API ke apne limits aur kharch hote hain. Free tier ke limits badalte rehte hain.
- Default prompt AI ko insaan ki tarah behave karne aur bot hone se inkaar karne ko kehta hai. Logon ke saath ye imaandaar nahi hai. Chahein to `Build AI Prompt` node me ye rule badal dein (jaise "agar koi seedha puchhe to bata do ki aap assistant ho").
- Jaisa AI ne bola, wo **aapke naam se** jata hai. Shuru me kuch din logs dekhte rahein.
- `.env` me API keys aur passwords hote hain. Isse kabhi GitHub pe push na karein (`.gitignore` me already hai).
- Production (internet pe) chalana ho to README ka "Production" section follow karein (HTTPS + IP restriction).

## 8. Folder ek nazar me

```
.env.example            -> settings ka template (copy karke .env banate hain)
docker/docker-compose.yml -> saari services ek saath chalata hai
n8n-workflows/          -> main-workflow.json (asli logic), error-handler.json
database/init.sql       -> tables, seed data, views
config/nginx.conf       -> sirf production HTTPS ke liye
scripts/setup.sh        -> pehli baar ka setup helper
scripts/test.sh         -> smoke tests
docs/GUIDE.md           -> ye file
```
