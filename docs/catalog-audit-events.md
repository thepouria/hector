# Catalog Audit + Domain Events

Catalog state is the source of truth. **Audit** records historical evidence of mutations.
**Domain Events** signal facts to other Hector modules. They are not interchangeable.

This phase wires Catalog to the existing Phase 0 Audit + Domain Events infrastructure.
There is no second audit system, no second event bus, and no message broker.

---

## Architecture

```text
HTTP Request
  → Auth / Company / RBAC
  → Catalog service mutation
  → Prisma $transaction {
        domain write
        AuditService.record(tx, …)   // same transaction
        collect DomainEvent in memory
     }
  → commitThenPublish → DomainEventBus.publishMany (in-process)
  → HTTP response
```

Ghost Audit / ghost Events are prevented because:

1. Audit rows are inserted inside the same Prisma transaction as the mutation.
2. Events are only published after `work()` resolves (`commitThenPublish`).
3. If the transaction or audit insert throws, events are never published.
4. `AuditService.record` returns `null` (and skips insert) when before/after snapshots are equal — no-op mutations do not emit events either (services gate `events.push` on a successful audit where applicable).

### Delivery semantics (current)

| Concern | Behavior |
|---|---|
| Transport | In-process `DomainEventBus` |
| Outbox | **None** |
| Broker | **None** |
| Retry | Handler-level only if Phase 0 bus retries; no Catalog-specific retry |
| Ordering | Not globally ordered; entity-level order follows commit order within a request |
| Delivery | At-most-once within a single process today; future external delivery should be treated as **at-least-once** and keyed by `eventId` |

### Future outbox path (not implemented)

```text
transaction → Outbox row → Worker → Broker
```

Catalog services already collect events via `eventFactory.create` + `commitThenPublish`.
Moving to an outbox should not require rewriting Catalog domain logic — only the publish adapter.

---

## Actor / Company / Correlation

| Field | Source |
|---|---|
| `companyId` | Request company context (mandatory on Audit + Events) |
| `actorUserId` / `actorCompanyMemberId` | Authenticated request ALS |
| `requestId` / `correlationId` | Request middleware → Audit.requestId + Event.correlationId |
| `bulkOperationId` | `catalogMutationContext` ALS when inside Bulk execute |
| System / Import / Automation actors | Supported via explicit Audit/Event context overrides; not used by Catalog HTTP today |

Audit identity uses stable `entityType` + `entityId` (never display names as primary keys).
Snapshots may include human labels (`brand.label`, product `name`, barcode `value`).

Sensitive values (tokens, passwords, Authorization headers) are stripped by `sanitizeAuditSnapshot`.

---

## Mutation matrix

| Mutation | Audit | Domain Event | Notes |
|---|---|---|---|
| Brand create/update/activate/archive | YES | YES (`catalog.brand.*`) | |
| Category create/update/activate/archive | YES | YES (`catalog.category.*`) | |
| Category reparent/move | YES | YES (`catalog.category.moved`) | old/new parent in metadata/payload |
| Category path recalculation | NO separate | NO | Derived; covered by parent move |
| Product create | YES | YES (`catalog.product.created`) | |
| Product update (meaningful fields) | YES | YES (`catalog.product.updated`) | `changedFields` in payload |
| Product activate/deactivate/archive | YES | YES | |
| Product true no-op | NO | NO | Snapshot equality |
| `normalizedName` / `updatedAt` alone | NO separate | NO | Not user-facing |
| SKU create/update/lifecycle | YES | YES (`catalog.sku.*`) | |
| Variant option/value mutations | YES | YES (`catalog.variant_*`) | Meaningful config only |
| Barcode create / internal generate | YES | YES | Demotions recorded in metadata |
| Barcode set primary | YES | YES (`catalog.barcode.primary_changed`) | |
| Barcode archive | YES | YES (`catalog.barcode.archived`) | |
| Attribute definition / option lifecycle | YES | YES (`catalog.attribute*`) | |
| Category attribute bindings update | YES | YES | |
| Product/SKU attribute set/remove | YES | YES | BOOLEAN unknown ≠ false; MULTI_SELECT by option IDs |
| Bulk parent summary | YES (`CATALOG_BULK_EXECUTED`) | YES (`catalog.bulk_operation.completed`) | Counts + selection mode; **not** all IDs |
| Bulk per-entity mutation | YES (entity Audit) | YES (entity Events) | `metadata.bulkOperationId` / `event.bulkOperationId` |
| Search / list / resolve reads | NO | NO | |

---

## Event catalog

All events use `DOMAIN_EVENT_VERSION = 1`. Envelope fields when available:
`eventId`, `type`, `version`, `occurredAt`, `companyId`, `actor`, `correlationId`, `requestId`, `causationId?`, `bulkOperationId?`, `payload`.

### Product

| Type | Trigger | Payload (conceptual) |
|---|---|---|
| `catalog.product.created` | create | `companyId`, `productId` |
| `catalog.product.updated` | meaningful update | `companyId`, `productId`, `changedFields[]` |
| `catalog.product.activated` | activate | `companyId`, `productId` |
| `catalog.product.deactivated` | deactivate | `companyId`, `productId` |
| `catalog.product.archived` | archive | `companyId`, `productId` |

No redundant `ProductBrandChanged` alongside `updated` — brand/category appear in `changedFields`.

### SKU

| Type | Trigger |
|---|---|
| `catalog.sku.created` / `.updated` / `.activated` / `.deactivated` / `.archived` | SKU lifecycle |

### Barcode (Warehouse-critical)

| Type | Trigger | Notes |
|---|---|---|
| `catalog.barcode.created` | assign/create | Payload includes skuId, value, type, isPrimary |
| `catalog.barcode.internal_generated` | internal generate | |
| `catalog.barcode.primary_changed` | setPrimary / demotion path | Previous/new primary identity |
| `catalog.barcode.archived` | archive | Mapping removed from active resolve |

Deprecated aliases `catalog.barcode.assigned` / `.updated` remain in the registry for compatibility but Catalog writes the Phase 1.1 names.

**Contract for Warehouse:** consumers must key on company-scoped barcode identity and SKU id from the event, then fetch current Catalog state if needed. Fetching after an old event may return newer state.

### Brand / Category / Attributes / Variants / Bulk

See `DOMAIN_EVENTS` in `apps/api/src/infrastructure/events/domain-events.registry.ts`.

Notable:

- `catalog.category.moved` for reparent
- `catalog.product_attributes.updated` / `catalog.sku_attributes.updated`
- `catalog.bulk_operation.completed` summarizes a bulk run; entity events still fire per successful mutation

### Consumers

No fake Catalog handlers in this phase. Future Warehouse / Inventory / Purchasing / Marketplace / Analytics subscribe to these contracts without importing Catalog internals.

---

## Bulk correlation

```text
Bulk execute
  → runWithCatalogBulkContext(operationId)
  → ProductsService / SkusService / EntityAttributesService
       Audit.metadata.bulkOperationId = operationId
       DomainEvent.bulkOperationId = operationId
  → Parent Audit CATALOG_BULK_EXECUTED + catalog.bulk_operation.completed
```

Parent Audit stores selection mode, operation type, matched/succeeded/failed/skipped.
It does **not** dump thousands of selected IDs. QUERY selection stores a safe filter snapshot on the `BulkOperation` row, not arbitrary Prisma.

**Scale note:** tens of thousands of entity events are published in-process today. That is bounded by sync bulk caps (IDS ≤ 1000, QUERY resolve ≤ 5000). Larger future workloads need outbox/async — events are not silently dropped within current caps.

Partial failure: skipped/failed entities do not emit success Audit/Events for the failed attempt.

---

## Audit read API

```text
GET /api/v1/audit-logs?entityType=PRODUCT&entityId=…
GET /api/v1/audit-logs/:id
```

Requires `audit.read`. Always company-scoped. Foreign entity ids return empty list / not-found — no cross-tenant leak.

List items include `before`, `after`, and `bulkOperationId` (extracted from metadata) for Catalog History UI.
Default sort: newest first. Paginated.

Catalog does **not** add `/products/:id/history` endpoints.

### Permissions

| Action | Permission |
|---|---|
| Catalog mutation | `catalog.manage` |
| Catalog read | `catalog.read` |
| History UI / Audit list | `audit.read` |

Denied mutations produce no success entity Audit and no Domain Event. Security Audit for forbidden attempts (if Phase 0 emits it) is separate from entity mutation Audit.

---

## UI

Reusable `<EntityHistory entityType entityId />` on Product and SKU detail pages.

- Loading / empty (`هنوز تغییری ثبت نشده است.`) / error / pagination
- Human-readable action + field diffs (labels, not raw Prisma)
- Bulk badge when `bulkOperationId` is present
- Link to full Audit page for the entity

Backend returns structured data; Persian sentences are composed only in the frontend.

---

## Indexes / schema

Phase 0 Audit indexes already support company + entity + createdAt queries.
This phase added **no** Prisma migration — ALS `bulkOperationId` lives in Audit metadata / Event envelope JSON.

Audit records are append-only; Catalog users cannot edit/delete history.
No automatic retention/deletion in this phase.

---

## Seed

Development seed may create Catalog entities via Prisma directly and therefore may not produce operational Audit history. Seed actions are not human operational history.

---

## Testing focus

- Product/SKU/Barcode/Brand/Category/Attribute Audit + Events
- Boolean attribute unknown vs true/false
- No-op suppression
- Rollback: no ghost Audit/Event
- Tenant isolation on Audit read
- Bulk parent + entity `bulkOperationId` correlation
- Barcode demotion metadata on primary change

See `apps/api/test/catalog-audit-events.e2e-spec.ts` and existing Catalog e2e suites.
