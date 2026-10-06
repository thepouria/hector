# Domain Events

## Purpose

Decouple Hector business modules so producers emit facts and interested handlers react without direct cross-module service chains.

```text
Producer
  ↓
Domain Event
  ↓
DomainEventBus
  ↓
Handlers
```

## Audit distinction

| AuditLog | Domain Event |
| --- | --- |
| Durable historical evidence | Post-commit reaction mechanism |
| Who / what / before / after | Something happened — react |
| PostgreSQL | In-process (Phase 0.8) |

Do **not** store domain events as AuditLog. Do **not** use AuditLog as an event bus.

## Event anatomy

```text
eventId
type
version
occurredAt
companyId?
actor? { userId, companyMemberId }
requestId?
correlationId
causationId?
payload
```

## Event naming

Past-tense business facts with stable keys:

```text
company.updated
member.created
member.status_changed
member.removed
member.reactivated
member.roles_changed
role.created
role.updated
role.permissions_changed
role.deleted
```

## Transaction lifecycle

```text
BEGIN
  business mutation
  AuditLog insert
  collect DomainEvent(s)
COMMIT
publish collected events
```

Events publish **only after** successful commit. Rollback / audit failure → no dispatch.

## Handler semantics

- Post-commit only
- Sequential per event
- Isolated: one handler failure is logged; others still run
- Must not reuse the completed Prisma transaction client
- Must not roll back committed business state or AuditLog
- HTTP success does not depend on non-critical handler success

Handlers should be **idempotent where practical** (future at-least-once delivery).

Handlers must **not** republish the same semantic event recursively.

## Current delivery guarantee

```text
in-process
non-durable
post-commit
```

If the process crashes after COMMIT and before publish, the event may be lost.

## Critical limitation

Until a transactional Outbox exists:

> Domain-event handlers must NOT be the only mechanism for critical financial, inventory, or settlement state transitions.

Phase 0.8 handlers must remain non-critical / reconstructable / best-effort.

## Future Outbox

Current envelope is plain serializable data. Later:

```text
Business tx + AuditLog + OutboxEvent → COMMIT → worker publishes
```

Business modules already depend on `DomainEventBus` / `DomainEventFactory`, not Nest EventEmitter.

## When NOT to use Domain Events

Intra-module repository calls and synchronous validation that needs an immediate answer stay direct. Events are for completed facts and cross-domain reactions.

## Current events (Phase 0.8)

```text
company.updated
member.created / member.reactivated / member.status_changed / member.removed / member.roles_changed
role.created / role.updated / role.permissions_changed / role.deleted
```

No-op mutations (same as suppressed audits) do not emit events.
