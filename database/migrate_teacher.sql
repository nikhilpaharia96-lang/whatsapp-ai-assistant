-- Adds the 'teacher' contact type (formal, respectful tone). Safe to run more than once.
-- Run BEFORE you set TEACHER_NUMBERS or mark a contact as a teacher.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'contacts'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%contact_type%'
  LOOP
    EXECUTE format('ALTER TABLE contacts DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type IN ('friend','family','client','teacher','unknown'));

-- Mark one person (example):
-- UPDATE contacts SET contact_type = 'teacher', display_name = 'Sharma Sir',
--        notes = 'Chemistry professor. Address as Sir.' WHERE phone = '+91XXXXXXXXXX';
