SELECT role, content, created_at
FROM (
  SELECT role, content, created_at
  FROM messages
  WHERE contact_id = $1::uuid
  ORDER BY created_at DESC
  LIMIT 40
) recent
ORDER BY created_at ASC;
