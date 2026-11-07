-- Who is using PostgreSQL connection slots?  Read-only (except the optional cleanup at the end).
-- Run as the Postgres superuser (the POSTGRES_USER of the Postgres service). Superusers can still connect
-- when normal roles are blocked, because Postgres keeps a few slots reserved for them.
--
--   psql "postgresql://<POSTGRES_USER>:<PASSWORD>@<tcp-proxy-host>:<port>/waassistant" -f database/diagnose_connections.sql

-- 1. The limits
SHOW max_connections;
SHOW superuser_reserved_connections;

-- 2. Used vs. maximum (client connections only)
SELECT count(*) AS used, current_setting('max_connections')::int AS max
FROM pg_stat_activity WHERE backend_type = 'client backend';

-- 3. Who holds them? (expect: Evolution = prisma, n8n = n8n / pg-promise; look for one app with a huge count)
SELECT usename, application_name, state, count(*) AS connections
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY usename, application_name, state
ORDER BY connections DESC;

-- 4. Is the role that n8n / Evolution use a superuser? (the "reserved for SUPERUSER" error only hits NON-superusers)
SELECT rolname, rolsuper, rolconnlimit FROM pg_roles WHERE rolcanlogin ORDER BY rolname;

-- 5. OPTIONAL cleanup: close connections that have been idle > 10 minutes. Touches no data; pools reconnect.
-- Uncomment to run.
-- SELECT pg_terminate_backend(pid)
-- FROM pg_stat_activity
-- WHERE backend_type = 'client backend' AND state = 'idle'
--   AND state_change < now() - interval '10 minutes' AND pid <> pg_backend_pid();
