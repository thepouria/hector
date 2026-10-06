# Backend architecture

## API architecture

Hector's API is a NestJS **modular monolith**.

| Concern              | Value         |
| -------------------- | ------------- |
| Application prefix   | `/api/v1`     |
| Health (unversioned) | `GET /health` |
| OpenAPI (optional)   | `/api/docs`   |

Future domain modules (identity, companies, products, inventory, finance, …) will be added under `apps/api/src/modules/` in later phases. Empty business modules are intentionally not created in Phase 0.3.

## Infrastructure (Phase 0.3)

### Configuration

- `@nestjs/config` with Zod validation (`src/config/env.validation.ts`)
- Typed namespaces: `app`, `database`
- Required: `NODE_ENV`, `API_PORT`, `DATABASE_URL`
- Optional: `CORS_ORIGINS`, `SWAGGER_ENABLED`, `LOG_LEVEL`
- Invalid configuration fails fast at startup

### Prisma integration

- Ownership remains in `@hector/database`
- Nest wraps the shared client via `DatabaseModule` / `DatabaseService`
- Single process-wide PrismaClient (`getPrismaClient`)
- `$connect` on module init; `disconnectPrismaClient` on shutdown
- Shutdown hooks enabled (`SIGTERM` / `SIGINT`)

### Validation

Global `ValidationPipe`:

- `whitelist: true`
- `forbidNonWhitelisted: true`
- `transform: true`

### Error contract

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": null
  },
  "requestId": "…"
}
```

Infrastructure codes: `VALIDATION_ERROR`, `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_SERVER_ERROR`, `SERVICE_UNAVAILABLE`.

`AppError` is available for intentional application failures. Prisma known errors are mapped generically (no schema/table leakage). Stack traces are logged server-side only; production clients get safe messages.

### Request IDs

- Header: `X-Request-Id`
- Valid incoming UUID is reused; otherwise a UUID is generated
- Returned on every response
- Stored in AsyncLocalStorage (`requestId` only for now)

### Logging

- `nestjs-pino` / Pino structured logs
- Development: pretty printing via `pino-pretty` (devDependency)
- Production: JSON logs
- Health requests are excluded from auto HTTP access logs
- Redacts authorization, cookies, password fields, and database URL material

### CORS

Configured from `CORS_ORIGINS` (comma-separated). Development default: `http://localhost:3000`. Credentials enabled. Not `origin: *`.

### Security

- `helmet` security headers
- JSON / urlencoded body limit: `1mb`
- Global throttling foundation (`@nestjs/throttler`, 120 req / 60s); `/health` is skipped
- Auth-specific throttling belongs to Phase 0.4

### Swagger

- Path: `/api/docs`
- Enabled when `SWAGGER_ENABLED=true`, or by default outside production
- Disabled in production unless explicitly enabled

### Compression

HTTP compression is left to the future reverse proxy / edge. Nest does not enable `compression` middleware in Phase 0.3.

### Success / pagination conventions

Success payloads should use:

```json
{ "data": {} }
```

Collections:

```json
{
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "total": 0 }
}
```

Query: `?page=1&pageSize=20` (`page >= 1`, default pageSize 20, max 100). Sort convention: `?sort=createdAt&order=desc`. No global response wrapper interceptor in Phase 0.3 (prefer explicit handlers). `PaginationQueryDto` is available for later modules.

## Request context

Current: `requestId`.

Later phases will add `userId` (0.4) and `companyId` (0.5) without making every provider request-scoped.

## Explicitly deferred

| Concern                           | Phase |
| --------------------------------- | ----- |
| Authentication / sessions         | 0.4   |
| Company context / membership APIs | 0.5   |
| RBAC                              | 0.6   |
| Audit logging behavior            | 0.7   |
| Domain events                     | 0.8   |

Also deferred: Redis, BullMQ, generic CRUD repositories, business modules, frontend auth UI.

## Testing

```bash
pnpm --filter @hector/api test
pnpm --filter @hector/api test:e2e
```

E2E health checks require PostgreSQL (`docker compose up -d`).
