# Company Context

## Multi-company model

```text
User
  ↓
CompanyMember
  ↓
Company
```

A user may belong to many companies. There is **no** `companyId` on `User`.

## Company selection

Clients send:

```http
X-Company-Id: <company UUID>
```

Company context is resolved **server-side** after authentication. The header is never trusted alone.

## Validation

```text
authenticated user
  + ACTIVE CompanyMember for (userId, companyId)
  + ACTIVE Company (not soft-deleted)
  → companyId + companyMemberId attached to request context
```

Safe failures:

| Situation                         | Code                       | Status |
| --------------------------------- | -------------------------- | ------ |
| Missing header on scoped route    | `COMPANY_CONTEXT_REQUIRED` | 400    |
| Not a member / unknown company    | `COMPANY_NOT_FOUND`        | 404    |
| Membership suspended              | `MEMBERSHIP_SUSPENDED`     | 403    |
| Membership removed                | `MEMBERSHIP_REMOVED`       | 403    |
| Company suspended                 | `COMPANY_UNAVAILABLE`      | 403    |

## Request context

```text
requestId
userId
sessionId
companyId          ← after company context
companyMemberId    ← after company context
```

Structured logs include `companyId` when present.

## Isolation rule

> Every future company-owned business record must be queried using the **resolved server-side** company context (`companyContext.companyId`), never a client-supplied DTO `companyId`.

Do **not** add a global Prisma middleware that silently injects `companyId` into every query (platform admin, global permissions, jobs, and migrations must remain explicit).

Future company-scoped DTOs should omit `companyId` when context already comes from `X-Company-Id`.

## JWT rule

Access tokens identify **user + session** only (`sub`, `sid`).

They do **not** contain `companyId`, roles, or permissions. Switching companies is a header change on the same access token — no re-login.

## Membership lifecycle

```text
ACTIVE → SUSPENDED → ACTIVE   (temporary access freeze)
ACTIVE → REMOVED              (access removed; row kept for history)
REMOVED → ACTIVE              (reactivation; original joinedAt preserved)
```

Membership rows are never hard-deleted in Phase 0.5. Historical identity must survive for future audit/finance/inventory references.

Removing a membership does **not** revoke global Hector sessions. `/auth/me` still works; only that company's context fails.

## Temporary authorization (Phase 0.5) — replaced

Phase 0.5 used a temporary OWNER-only mutation gate.

Phase 0.6 replaced it with permission checks:

```text
@RequirePermissions(...)
+ PermissionsGuard
```

Ownership invariants remain separate business rules:

- only OWNER may grant/remove OWNER
- `LAST_OWNER_REQUIRED`

See `docs/architecture/rbac.md`.

## Last-owner invariant

An ACTIVE company must retain at least one ACTIVE OWNER membership.

Before suspending, removing, or stripping OWNER from an owner, Hector locks the company row (`SELECT … FOR UPDATE`) and rejects the change with `LAST_OWNER_REQUIRED` if it would leave zero active owners.

## Endpoints

```text
GET    /api/v1/companies                 # auth only
GET    /api/v1/companies/:companyId      # X-Company-Id + company.read
PATCH  /api/v1/companies/:companyId      # X-Company-Id + company.update

GET    /api/v1/members                   # member.read
POST   /api/v1/members                   # member.create
GET    /api/v1/members/:memberId         # member.read
PATCH  /api/v1/members/:memberId         # member.update
DELETE /api/v1/members/:memberId         # member.remove
PUT    /api/v1/members/:memberId/roles   # role.assign
```

Path `:companyId` must equal `X-Company-Id` for company profile routes.

## Company field policy (Phase 0.5)

| Field          | Editable |
| -------------- | -------- |
| name           | yes      |
| timezone       | yes (IANA) |
| slug           | immutable |
| baseCurrency   | immutable |

## Deferred

```text
RBAC / permissions → Phase 0.6
AuditLog writes → Phase 0.7
Domain Events → Phase 0.8
```
