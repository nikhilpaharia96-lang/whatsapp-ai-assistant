# Kisse kaise baat: friend, family, teacher, client

Bot har number ko ek **type** deta hai. Type se tone aur jaankari tay hoti hai.

| Type | Tone | Kya jaanta hai |
|---|---|---|
| `friend` (dost) | Casual Hinglish, mazaak, chhote messages | Profile, college, goals, aapka status |
| `family` | Pyaar aur izzat, simple bhasha | Same as friend |
| `teacher` | "Sir/Ma'am", formal, bina slang, **kabhi jhoothi excuse nahi** | Profile aur college. Goals, status, price nahi |
| `client` | Professional sales assistant (neeche) | Profile, services, prices, payment structure |
| `unknown` | Dost jaisa par thoda reserved | Sirf public profile |

## Type kaise set karein
- **Numbers se (aasan):** n8n variables `FRIEND_NUMBERS`, `FAMILY_NUMBERS`, `TEACHER_NUMBERS` (comma se alag, country code ke saath). Pehli baar message aane par type lag jata hai.
- **SQL se (kabhi bhi):**
  ```sql
  UPDATE contacts SET contact_type='teacher', display_name='Sharma Sir',
         notes='Chemistry professor. Sir kehna.' WHERE phone='+91XXXXXXXXXX';
  ```
  `notes` me likho kaise baat karni hai aur kya nahi bolna. Bot ise follow karta hai.
- Jo pehle se `friend/family/client` hai, wo apne aap `unknown -> ...` se nahi badalta. Sirf `unknown` hi auto-set hota hai.

## Pehli baar setup (is order me)
1. Postgres me `database/migrate_teacher.sql` (teacher type ke liye, ek baar).
2. `database/profile.sql` (aapka profile) aur `database/services.sql` (services aur prices). Dono dobara chalane se bhi kuch nahi bigadta.
3. n8n me naya `main-workflow.json` lagao (ya sirf **Validate & Extract** aur **Build AI Prompt** nodes ka code).
4. Chaho to `TEACHER_NUMBERS` variable.

## Client ke saath bot ka tareeka
1. Garmjoshi se swagat, "main Nikhil ka assistant hu", aur pooche kya chahiye. Poori list nahi phenkta.
2. Ek-ek sawal: kaunsa business, goal, timeline, budget.
3. Sahi service batata hai (pehle fayda, phir kya milega), timeline aur **"starting price"**. Final quote scope par.
4. Objection (mehnga hai / sochna hai): kya included hai batata hai, chhota scope sujhata hai, dabav nahi.
5. Close: service page ka link (**Book Now** ya bina payment ke **enquiry**), naam aur requirement leta hai.
6. Taiyaar client (start karna hai, custom quote, discount, rush, call, ~Rs 20,000+ budget): "Nikhil khud confirm karenge" aur aapko WhatsApp par **hot lead** alert jata hai.

Bot kabhi nahi karta: price/discount/deadline/refund jo list me nahi, results ki guarantee, card/OTP/bank details maangna, doosre clients ki baat.

### Namoona (asli jawab Gemini ke hisaab se thoda alag hoga)
> **Client:** Mujhe apni dukaan ke liye website chahiye
> **Bot:** Hi! Main Nikhil ka assistant hu. Aapki dukaan kis cheez ki hai, aur website se aap kya chahte ho: online orders ya sirf pehchan?
> **Client:** Kapde, online orders chahiye
> **Bot:** Phir E-Commerce Solutions aapke liye theek rahega: store setup, payment gateway aur shipping, 5-15 din me. Starting price Rs 4,999, final quote products ke hisaab se. Yahan dekh sakte ho aur book ya enquiry bhej sakte ho: https://www.nikhilpaharia.online/services/e-commerce-solutions

## Prices kahan se aate hain
`database/services.sql` portfolio website repo ke `shared/servicePricing.ts` aur `shared/serviceInfo.ts` se bana hai. Live website khulne ka mauka nahi mila (is session me allow nahi), isliye **website par jo dikhe wo hi sahi maano**. Price badle to repo wali file badal kar `services.sql` dobara banao ya SQL me row edit karo.
