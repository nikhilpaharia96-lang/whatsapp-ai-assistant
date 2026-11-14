WITH ins AS (
  INSERT INTO messages (contact_id, role, content, wa_message_id)
  VALUES ($1::uuid, 'user', $2::text, 'mail:in:' || $3::text)
  ON CONFLICT (wa_message_id) DO NOTHING
  RETURNING id, contact_id
), upd AS (
  UPDATE contacts SET
    last_active = NOW(),
    do_not_contact_at = CASE WHEN NOT do_not_contact AND $4::boolean AND contact_type NOT IN ('friend', 'family', 'teacher') THEN NOW() ELSE do_not_contact_at END,
    do_not_contact = do_not_contact OR ($4::boolean AND contact_type NOT IN ('friend', 'family', 'teacher'))
  WHERE id = $1::uuid AND EXISTS (SELECT 1 FROM ins)
  RETURNING 1
), o AS (
  UPDATE outreach SET status = 'skipped'
  WHERE contact_id = $1::uuid AND status = 'draft' AND $4::boolean AND EXISTS (SELECT 1 FROM ins)
  RETURNING 1
)
SELECT ins.contact_id, $3::text AS msg_id, $5::text AS mode FROM ins;
