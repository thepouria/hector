# Warehouse Audit (Phase 3.17)

Append-only operational accountability history. Complements — never replaces — `InventoryMovement`.

## Distinctions

| Concern | System |
| --- | --- |
| Why did physical quantity change? | `InventoryMovement` |
| Who did what to which operational object? | Audit (`AuditLog`) |
| Machine-readable domain fact for consumers | Domain Events (in-process) |

## Coverage

Meaningful successful transitions are audited, including (non-exhaustive):

- Warehouse / location lifecycle
- Goods receipt create / post / cancel
- Putaway completed
- Transfer create / dispatch / complete / cancel
- Stock issue create / post / cancel
- Classification change
- Adjustment create / approve / post / cancel
- Stock count start / submit / approve / post / cancel
- Supplier return execution create / dispatch / cancel
- Reservation reserve / release / consume / expire

**Not audited:** GETs, list/dashboard views, barcode lookups, availability reads (unless future security policy requires it).

## Actor & tenant

- Actor comes from authenticated / system request context — never from client body.
- Every row is company-scoped (`companyId`).
- Before/after snapshots are bounded; secrets are sanitized by Phase 0 audit sanitizer.

## Immutability

No normal edit/delete Audit API. Retention deletion is a future ops concern (not implemented).

## APIs

| API | Permission | Purpose |
| --- | --- | --- |
| `GET /audit-logs` | `audit.read` | Global technical audit (filters: action, entityType, entityId, actor, date range) |
| `GET …/:id/activity` on warehouse docs | domain read permission | Business timeline projection of Audit for that entity |

Activity endpoints (Phase 3.17):

- `GET /goods-receipts/:id/activity`
- `GET /warehouse/transfers/:id/activity`
- `GET /warehouse/adjustments/:id/activity`
- `GET /warehouse/counts/:id/activity`
- `GET /warehouse/issues/:id/activity`
- `GET /warehouse/supplier-return-executions/:id/activity`

## Traceability

Successful physical ops remain traceable:

`Audit action → operational document → InventoryMovement(s)`

Example: `STOCK_COUNT_POSTED` → Count → `STOCK_COUNT_ADJUSTMENT_*` movements.

## Seed policy

Seed does **not** fabricate operational Audit rows. Runtime operations create Audit. Seeded documents may therefore have empty activity timelines until touched via API.
