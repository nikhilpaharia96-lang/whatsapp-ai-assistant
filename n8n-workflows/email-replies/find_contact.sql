WITH t AS (
  SELECT o.contact_id
  FROM outreach o
  WHERE o.wa_message_id = 'mail:' || $1::text AND o.status = 'sent'
  ORDER BY o.sent_at DESC NULLS LAST
  LIMIT 1
)
SELECT c.id, c.phone, c.display_name, c.contact_type, c.is_blocked, c.do_not_contact,
       COALESCE((SELECT value FROM bot_settings WHERE key = 'autoreply'), 'on') = 'off' AS bot_off,
       (SELECT COUNT(*) FROM messages m WHERE m.contact_id = c.id AND m.role = 'assistant'
          AND m.wa_message_id LIKE 'mail:%' AND m.created_at > NOW() - INTERVAL '24 hours') AS replies_24h,
       EXISTS (SELECT 1 FROM messages m WHERE m.wa_message_id = 'mail:in:' || $2::text) AS seen,
       $2::text AS in_msg_id
FROM t JOIN contacts c ON c.id = t.contact_id;
