WITH pend AS (SELECT COUNT(*)::int AS n FROM outreach WHERE status = 'draft' AND expires_at > NOW())
SELECT c.display_name, c.phone, c.business_name, c.last_active, c.do_not_contact,
       (SELECT o.status FROM outreach o WHERE o.contact_id = c.id ORDER BY o.created_at DESC LIMIT 1) AS last_outreach,
       (SELECT o.sent_at FROM outreach o WHERE o.contact_id = c.id AND o.status = 'sent' ORDER BY o.sent_at DESC LIMIT 1) AS last_sent,
       (SELECT n FROM pend) AS pending
FROM (SELECT 1) one
LEFT JOIN contacts c ON c.contact_type = 'client' AND NOT c.is_blocked
ORDER BY c.last_active DESC NULLS LAST
LIMIT 15;
