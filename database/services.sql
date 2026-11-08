-- Generated from the portfolio repo (shared/servicePricing.ts + shared/serviceInfo.ts). Safe to re-run.
-- Re-generate / edit when your prices change. Clients get these rows in the AI prompt (category 'services').
INSERT INTO portfolio (category, title, content, tags) VALUES
('services', 'Website Development',
 'Website Development: starting price Rs 2,999 (final quote depends on scope). Usual delivery: 3 – 12 days (depending on pages). Typical timelines: Landing page 3 – 5 days; Business website (5–8 pages) 7 – 12 days; Custom web app 3 – 6 weeks. The starting price includes: Responsive single-page website; Contact form; Basic SEO setup; 1 round of revisions; Deployment support. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/website-development',
 ARRAY['services','pricing']),
('services', 'Video Editing',
 'Video Editing: starting price Rs 499 (final quote depends on scope). Usual delivery: 1 – 5 days (depending on length). Typical timelines: Reel / Short 1 – 2 days; YouTube video (up to 10 min) 3 – 5 days; Ad / promo / corporate video 4 – 7 days. The starting price includes: Edit up to 60 seconds; Colour correction; Music & basic sound design; Captions; 1 round of revisions. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/video-editing',
 ARRAY['services','pricing']),
('services', 'Digital Marketing',
 'Digital Marketing: starting price Rs 1,999/month (final quote depends on scope). Usual delivery: Setup in ~1 week, then monthly. Typical timelines: Setup & strategy 3 – 5 days; First campaign live Within 1 week; Visible results 30 – 60 days. The starting price includes: Monthly content plan; Social media posting; Basic ad setup; Monthly report. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/digital-marketing',
 ARRAY['services','pricing']),
('services', 'Graphic Designing',
 'Graphic Designing: starting price Rs 499 (final quote depends on scope). Usual delivery: 1 – 7 days (depending on scope). Typical timelines: Social post / banner 1 – 2 days; Logo design 3 – 5 days; Full branding kit 7 – 10 days. The starting price includes: Up to 2 concepts; Print & web-ready files; 1 round of revisions. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/graphic-designing',
 ARRAY['services','pricing']),
('services', 'UI/UX Design',
 'UI/UX Design: starting price Rs 1,499 (final quote depends on scope). Usual delivery: 5 – 14 days (depending on screens). Typical timelines: Wireframes 2 – 3 days; Website UI (5 screens) 5 – 7 days; Mobile app UI 2 – 3 weeks. The starting price includes: Up to 5 screens; Clickable prototype; Basic design system; 1 round of revisions. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/ui-ux-design',
 ARRAY['services','pricing']),
('services', 'Automation & AI Solutions',
 'Automation & AI Solutions: starting price Rs 4,999 (final quote depends on scope). Usual delivery: 3 – 12 days (depending on complexity). Typical timelines: Simple automation 2 – 4 days; WhatsApp chatbot 5 – 8 days; CRM + multi-app workflow 10 – 15 days. The starting price includes: 1 workflow or chatbot; Up to 3 app integrations; Testing & walkthrough; Basic documentation. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/automation-ai-solutions',
 ARRAY['services','pricing']),
('services', 'E-Commerce Solutions',
 'E-Commerce Solutions: starting price Rs 4,999 (final quote depends on scope). Usual delivery: 5 – 15 days (depending on catalogue). Typical timelines: Store setup (up to 20 products) 5 – 8 days; Custom design store 10 – 15 days; Large catalogue / custom features 3 – 5 weeks. The starting price includes: Store set-up; Up to 10 products; Payment gateway integration; Basic shipping set-up; 1 round of revisions. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/e-commerce-solutions',
 ARRAY['services','pricing']),
('services', 'Cinematography & Video Production',
 'Cinematography & Video Production: starting price Rs 2,999 (final quote depends on scope). Usual delivery: 7 – 12 days (shoot to final). Typical timelines: Pre-production 2 – 3 days; Shoot 1 – 2 days; Post-production 4 – 7 days. The starting price includes: Half-day shoot; 1 short promo / reel; Editing & colour grading; 1 round of revisions. Book or send an enquiry (no payment needed): https://www.nikhilpaharia.online/services/cinematography-video-production',
 ARRAY['services','pricing']),
('services', 'Payment structure',
 'Online booking: 5% token when booking on the website, 25% advance when the project starts, 70% balance after completion (example: Rs 20,000 = Rs 1,000 + Rs 5,000 + Rs 14,000). Projects above Rs 5,00,000 are discussed personally. Payments only through the booking link or details Nikhil shares himself.',
 ARRAY['services','pricing']),
('services', 'How to get started',
 'Open the service page on https://www.nikhilpaharia.online, press Book Now (pay the small token) or send an enquiry without payment. Nikhil then contacts the client personally. Email: nikhilpaharia96@gmail.com. Projects and past work are on the website.',
 ARRAY['services','pricing'])
ON CONFLICT (category, title) DO UPDATE
  SET content = EXCLUDED.content, tags = EXCLUDED.tags, is_active = TRUE, updated_at = NOW();

