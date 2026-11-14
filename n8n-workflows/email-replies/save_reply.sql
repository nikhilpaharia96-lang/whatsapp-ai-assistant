INSERT INTO messages (contact_id, role, content, wa_message_id, tokens_used, model_used)
SELECT $1::uuid, 'assistant', $2::text, 'mail:' || $3::text, $4::int, NULLIF($5::text, '')
WHERE $6::boolean
ON CONFLICT (wa_message_id) DO NOTHING
RETURNING id;
