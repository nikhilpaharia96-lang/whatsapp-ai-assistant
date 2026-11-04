-- For databases created BEFORE this fix (init.sql only runs on first boot).
-- Removes duplicate incoming messages, then adds the UNIQUE constraint.
DELETE FROM messages a USING messages b
 WHERE a.wa_message_id IS NOT NULL
   AND a.wa_message_id = b.wa_message_id
   AND a.ctid > b.ctid;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_wa_message_id_key;
ALTER TABLE messages ADD CONSTRAINT messages_wa_message_id_key UNIQUE (wa_message_id);
