# PostgreSQL role separation (P.3)

Goal: runtime API uses a least-privilege role; migrations use a schema-capable role.

## Recommended roles

| Role | Purpose | Privileges |
|---|---|---|
| `hector_migrator` | `prisma migrate deploy` only | CONNECT, CREATE on schema `public`, ALL on migrated objects (or ownership) |
| `hector_app` | NestJS runtime | CONNECT, USAGE on schema, SELECT/INSERT/UPDATE/DELETE on app tables/sequences — **no** DDL |

The Compose default uses a single `POSTGRES_USER` for disposable smoke. Production should split roles after first migrate.

## Bootstrap outline (operator-run on disposable DB first)

```sql
-- As postgres superuser / volume init admin
CREATE ROLE hector_migrator LOGIN PASSWORD '...';
CREATE ROLE hector_app LOGIN PASSWORD '...';
CREATE DATABASE hector OWNER hector_migrator;
GRANT CONNECT ON DATABASE hector TO hector_app;

\c hector
GRANT USAGE ON SCHEMA public TO hector_app;
-- After migrate deploy as hector_migrator:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hector_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hector_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hector_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hector_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hector_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hector_app;
```

Set:

```
DATABASE_URL=postgresql://hector_app:...@postgres:5432/hector
DATABASE_URL_MIGRATE=postgresql://hector_migrator:...@postgres:5432/hector
```

## Trust boundary

Traffic stays on the isolated Docker network (`hector_db`). TLS to Postgres is optional inside that boundary; host exposure of `5432` remains forbidden.

## Status

Role separation is **documented and supported by env vars**. Automated init of dual roles on first boot is optional and left to operators to avoid surprising Compose `POSTGRES_USER` ownership. Track residual risk until dual-role bootstrap is verified on the real host.
