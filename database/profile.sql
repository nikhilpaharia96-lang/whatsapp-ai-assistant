-- ============================================================
--  Nikhil's profile for the AI (safe to run more than once)
--  Run in Railway: Postgres service -> Data / Query tab (database whatsapp_ai)
--
--  Who sees what (decided in the "Build AI Prompt" node):
--    profile_public   -> everyone
--    profile_academic -> friends, family and teachers (college, hometown)
--    profile_personal -> friends and family only (goals)
--    status           -> friends and family only (see the bottom of this file)
--    other categories -> clients only
-- ============================================================

-- 1) Switch off the placeholder rows from init.sql. They describe an invented person
--    ("5+ years", "$80/hr") and would otherwise be told to clients as facts.
--    (Rows are only deactivated, never deleted.)
UPDATE portfolio SET is_active = FALSE
WHERE (category, title) IN (
  ('bio','About me'), ('skills','Technical skills'), ('projects','Recent projects'),
  ('pricing','Rates and availability'), ('process','How I work')
);

-- (If an earlier version of this file already ran, move that row to its new category first.)
UPDATE portfolio SET category = 'profile_academic' WHERE category = 'profile_personal' AND title = 'Background';

-- 2) Real profile
INSERT INTO portfolio (category, title, content, tags) VALUES
('profile_public', 'Who you are',
 'Nikhil Paharia, 21, from Assam, India. Student, freelance web developer, entrepreneur, video editor and digital marketer. Builds websites and AI automations (n8n, Gemini, WhatsApp assistants).',
 ARRAY['intro','about']),
('profile_public', 'Skills',
 'Full-stack web development: HTML, CSS, JavaScript, React, Next.js, Node.js, Express.js, NestJS. Databases: PostgreSQL, MongoDB, Prisma. UI/UX design, e-commerce development, digital marketing and Meta Ads, video editing, AI automation (n8n workflows, Gemini AI integration, WhatsApp AI assistants).',
 ARRAY['skills','tech']),
('profile_public', 'Projects',
 'ApunBazar (Assam-focused e-commerce platform), StudyNova (AI-powered learning platform), CreatorHub (digital products marketplace), a WhatsApp AI Assistant, a personal portfolio and brand, and a website for Gopal Krishna Tea. Also takes freelance website projects.',
 ARRAY['projects','work']),
('profile_academic', 'Background',
 'Hometown: Jagiroad / Morigaon, Assam. Studies BSc Chemistry (3rd semester) at Jagiroad College (Autonomous), affiliated with Gauhati University.',
 ARRAY['education','home']),
('profile_personal', 'Goals',
 'Build a successful technology business, become financially independent, earn Rs 1 lakh per month, build a personal brand (grow Instagram and YouTube), make useful AI-powered apps, and travel.',
 ARRAY['goals'])
ON CONFLICT (category, title) DO UPDATE
  SET content = EXCLUDED.content, tags = EXCLUDED.tags, is_active = TRUE, updated_at = NOW();

-- 3) Your current status is NOT set here any more: send "STATUS: College mein hu | 3h" from
--    your own WhatsApp (see docs/STATUS.md). It is stored as the portfolio row
--    category='status', title='Right now'. To clear it from SQL:
--      UPDATE portfolio SET is_active = FALSE WHERE category = 'status';

-- 4) Per-person notes (who they are, how to talk to them). Example:
-- UPDATE contacts
--    SET display_name = 'Rahul', contact_type = 'friend',
--        notes = 'Close friend from college. Casual Hinglish, jokes are fine. Do not mention his exam results.'
--  WHERE phone = '+91XXXXXXXXXX';
