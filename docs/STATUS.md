# Live status from WhatsApp

Tum apne WhatsApp se bot ko batate ho ki abhi kya kar rahe ho. Bot friends/family ko usi hisaab se jawab deta hai.

## Commands

| Tum likho | Kya hota hai |
|---|---|
| `STATUS: College mein hu` | Status set. Expiry nahi di, to **12 ghante** baad apne aap hat jata hai |
| `STATUS: Busy hu \| 3h` | 3 ghante tak (`m` minute, `h` ghanta, `d` din; max 7 din) |
| `STATUS: Busy hu \| 6 PM tak` | Aaj shaam 6 baje (IST) tak. `till 18:30`, `by 9am` bhi chalta hai |
| `STATUS: Available hu \| never` | Jab tak khud na badlo |
| `STATUS: clear` | Status hata do |
| `STATUS?` ya `STATUS` | Abhi ka status dekho |

- Naya status purane ko **replace** kar deta hai. Hamesha sirf ek status rehta hai.
- Expiry `|` ke baad likhte hain. `STATUS: Busy hu, 6 PM free` me "6 PM" sirf text hai, expiry nahi.
- Bot tumhe usi chat me private confirmation bhejta hai (`✅ Update ho gaya ...`). Galat format ho to `⚠️` ke saath example aata hai.

## Kaun update kar sakta hai
1. **Connected number se khud ko message** ("Message yourself" chat). Ye hamesha chalta hai.
2. **Doosre phone se**, agar wo number `YOUR_PHONE` ya `STATUS_OWNER_NUMBERS` (comma se alag) me hai.

Kisi aur ka `STATUS: ...` bhejna kuch nahi badalta. Use bot normal message ki tarah jawab deta hai. Webhook secret pehle ki tarah check hota hai.
Tumhari kisi dost ke chat me likhi `STATUS:` line ignore hoti hai.

## AI isse kaise use karta hai
- Status sirf **friends aur family** ke prompt me jata hai (`FAMILY_NUMBERS` / `FRIEND_NUMBERS` ya contact type). Clients aur anjaan logon ko nahi.
- Prompt me likha hota hai kitni der pehle set hua ("set 2 h ago"). Expire hua status DB me rehta hai par AI ko nahi dikhta.
- **Exact location**: AI ko rule hai ki address, live location, coordinates ya status se zyada koi jagah kabhi na bataye, aur andaza na lagaye. Poochne par "main khud bata dunga". Ye prompt ka rule hai (model par bharosa), koi code-level lock nahi. Isliye status me address ya exact jagah mat likho. Sirf wahi likho jo friends ko batana theek ho.
- Status nahi hai to AI "baad me batata hu" bolta hai, kuch banata nahi.

## Setup
1. `database/profile.sql` pehle chala lo (profile ke liye). Status ke liye alag table ya migration **nahi** chahiye. Ye `portfolio` table ki ek row me rehta hai.
2. n8n me workflow update karo (naya `main-workflow.json` import, ya sirf 3 nodes: Validate & Extract, Load Portfolio, Build AI Prompt, aur 5 naye nodes `Status command?` se `Confirm Status to Owner` tak).
3. Optional n8n variables: `STATUS_OWNER_NUMBERS`, `STATUS_DEFAULT_TTL_HOURS` (default 12).
4. Test: apne aap ko `STATUS?` bhejo.

## Technical
- Status row: `portfolio(category='status', title='Right now')`. Expiry `tags` me `expires:<ISO>` ke roop me, aur retry-dedup ke liye `msg:<id>`.
- Evolution jab webhook retry kare, to same message dobara apply nahi hota aur confirmation sirf ek baar jata hai.
- Confirmation "STATUS" se shuru nahi hota, isliye bot apne hi message par loop nahi karta.

## Auto-reply ON / OFF

Apni "Message yourself" chat me (ya YOUR_PHONE se):

- `BOT OFF` (ya `OFF`): kisi ko auto-reply nahi jayega
- `BOT ON` (ya `ON`): wapas chalu
- `BOT?`: abhi ki state

State `bot_settings` table me save hoti hai (database/init.sql), isliye restart ke baad bhi rehti hai. STATUS commands OFF me bhi chalte hain.

## Client outreach (CLIENT command)

`CLIENT:` ab kabhi turant message nahi bhejta. Wo sirf ek **draft** banata hai jo tumhe approve karna hota hai.
Poori detail: [OUTREACH.md](OUTREACH.md).


## Saving contacts from Message Yourself

Send one or more lines (optionally after `SAVE:`):

```
naam | number | dost/family/teacher/client | kaise baat kare (optional)
Rahul | 919876543210 | dost | gaali-wala mazaak chalega
Priya Ma'am | 919123456789 | teacher | Chemistry ki teacher
```

Types: dost/friend/yaar -> friend, family/ghar -> family, teacher/sir/madam/professor -> teacher, client -> client, unknown. The note is stored in the contact's notes as data for the AI (not as instructions). Existing contacts are updated, never duplicated, and their chat history and blocked / do_not_contact flags are untouched. Up to 30 lines per message; bad lines are reported and skipped. Retried webhooks save and confirm once. Only works from your own self-chat or YOUR_PHONE.
