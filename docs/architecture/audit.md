# Audit Log

## Purpose

Durable business/security traceability for company-scoped state changes.

Answers:

```text
Who changed this?
When?
In which company?
What action?
Which entity?
What was before / after?
Which request?
```

## Difference from application logging

| Application logs | AuditLog |
| --- | --- |
| Operational diagnostics | Business/security history |
| Ephemeral / infrastructure | Durable in PostgreSQL |
| Request timing, failures | Actor, entity, before/after |

Do **not** dump application logs into `AuditLog`.

## Audit structure

```text
actorUserId + actorCompanyMemberId
companyId
action
entityType + entityId
before / after (JSON snapshots)
metadata
requestId + ipAddress + userAgent
createdAt
```

## Transaction guarantee

Audited mutations own a Prisma transaction:

```text
BEGIN
  business mutation
  auditService.record(tx, …)
COMMIT
```

If audit insert fails, the business mutation rolls back.

## Immutability

Append-only through application APIs. No update/delete endpoints or service methods.

Stronger DB-level tamper resistance may be added later for compliance.

## Redaction

Explicit safe snapshots + `AuditSanitizer` remove secrets such as:

```text
password / passwordHash
accessToken / refreshToken / refreshTokenHash
authorization / cookie
secret / apiKey
DATABASE_URL
```

Raw request bodies are never stored.

## Company isolation

All queries use validated Company Context (`X-Company-Id`). Path/query `companyId` cannot select another company.

## RBAC

```text
audit.read
```

OWNER receives it via permission sync. Warehouse/custom roles do not by default.

## Phase 0.7 audited actions

```text
COMPANY_UPDATED
MEMBER_CREATED
MEMBER_REACTIVATED
MEMBER_STATUS_CHANGED
MEMBER_REMOVED
MEMBER_ROLES_CHANGED
ROLE_CREATED
ROLE_UPDATED
ROLE_PERMISSIONS_CHANGED
ROLE_DELETED
```

No-op mutations (identical before/after) do not create audit rows.

## Domain Events (Phase 0.8)

```text
AuditLog = durable historical evidence
Domain Event = post-commit reaction mechanism
```

They record related facts with separate registries (`AUDIT_ACTIONS` vs `DOMAIN_EVENTS`). See `docs/architecture/domain-events.md`.

## Future use

Architecture supports later inventory/finance/settlement actions with monetary or barcode metadata. Authentication secrets remain excluded.

## Non-goals

```text
event sourcing
rollback / undo
application logging replacement
async audit queues
```

Domain Events are implemented separately in Phase 0.8 (in-process bus; not stored in AuditLog).

