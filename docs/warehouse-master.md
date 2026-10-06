# Warehouse Master (Phase 3.2)

Canonical master data for physical/logical inventory-holding facilities.

Related:

- `docs/warehouse-architecture.md` (Phase 3.1 authority boundaries)
- `docs/warehouse-invariants.md` (inventory invariants + master invariants below)
- `docs/warehouse-purchasing-contract.md`
- `docs/warehouse-sales-contract.md`

> **Implementation status:** Phase **3.2 implemented**. Locations are documented in `docs/warehouse-locations.md` (Phase 3.3). Goods Receipts, Movements, Stock Balance, Batch, FIFO, Transfers, Counts, Reservations, and scanner UX remain **out of scope** of Warehouse Master.

---

## Ownership

```text
Company
  └── Warehouse (0..n)
```

- Every Warehouse belongs to exactly one Company (`companyId` FK, `ON DELETE RESTRICT`).
- Company may have **zero** warehouses (valid before setup).
- Warehouse cannot move between companies.
- Client payloads never assign `companyId`; scope comes from authenticated company context (`X-Company-Id` + membership).

---

## Model

| Field | Notes |
|---|---|
| `id` | Stable UUID identity (FK target for future Locations/Receipts/Movements/Stock/Transfers) |
| `companyId` | Tenant ownership |
| `code` | Operational code, stored **normalized uppercase**, unique per company |
| `name` | Human label (Unicode/Persian OK); not unique |
| `status` | `ACTIVE` \| `INACTIVE` |
| `isDefault` | Convenience default selection; at most one per company |
| `address` | Optional free-text |
| `notes` | Optional internal notes (not secrets storage) |

No `archivedAt` on Warehouse: lifecycle is status-based (`INACTIVE` retains historical identity). Ordinary API has **no hard delete**.

---

## Code normalization & uniqueness

```text
"  thr-01  " → "THR-01"
```

- Alphabet: `A–Z`, `0–9`, `_`, `-` (aligned with Catalog internal codes)
- Max length 64
- Uniqueness: `@@unique([companyId, code])` — DB-enforced
- Same code across companies is allowed (`Company A/MAIN` and `Company B/MAIN`)
- Code is **not** FK identity; relations use `warehouseId`
- Code may change while operational; audited; uniqueness re-enforced

No separate `normalizedCode` column: canonical uppercase `code` is the persisted value.

---

## Status

| Status | Meaning |
|---|---|
| `ACTIVE` | Available for future operational targeting (receiving, transfers, etc.) |
| `INACTIVE` | Historical master data; readable; not for new ops |

Transitions via explicit APIs:

```text
POST /warehouses/:id/activate
POST /warehouses/:id/deactivate
```

Generic `PATCH` does not change status or default.

---

## Default warehouse

### Invariants

```text
WH-MASTER-004  company has at most one default (partial unique index)
WH-MASTER-005  isDefault ⇒ status = ACTIVE (CHECK constraint)
WH-MASTER-006  if activeWarehouseCount > 0 ⇒ exactly one ACTIVE default
WH-MASTER-010  default switch is atomic (transaction + DB unique)
```

DB:

```sql
UNIQUE (company_id) WHERE is_default = true
CHECK (is_default = false OR status = 'ACTIVE')
```

### Behavior

1. **First ACTIVE warehouse** for a company is automatically default.
2. Additional creates default to `isDefault=false` unless `isDefault=true` (transactional switch).
3. `POST .../set-default` unsets previous + sets new in one transaction.
4. **Deactivate default** while other ACTIVE warehouses exist → require `replacementWarehouseId` (no silent pick).
5. **Deactivate sole ACTIVE default** → allowed; company may have zero defaults/active warehouses.
6. Inactive warehouse cannot become/remain default.

---

## API

```text
GET    /api/v1/warehouses
GET    /api/v1/warehouses/:warehouseId
POST   /api/v1/warehouses
PATCH  /api/v1/warehouses/:warehouseId   # code, name, address, notes only
POST   /api/v1/warehouses/:warehouseId/activate
POST   /api/v1/warehouses/:warehouseId/deactivate
POST   /api/v1/warehouses/:warehouseId/set-default
```

List supports `search` (code/name/address), `status`, `isDefault`, pagination, sort, `view=options`.

Cross-company ID access returns **404** (IDOR-safe).

---

## RBAC

| Permission | Use |
|---|---|
| `warehouse.read` | List/get |
| `warehouse.manage` | Create/update/activate/deactivate/set-default |

Seed role `WAREHOUSE_OPERATOR` receives `warehouse.read` only. Owners receive both via owner sync.

---

## Audit

Actions (existing AuditLog):

```text
WAREHOUSE_CREATED
WAREHOUSE_UPDATED
WAREHOUSE_ACTIVATED
WAREHOUSE_DEACTIVATED
WAREHOUSE_DEFAULT_CHANGED
```

Default change records previous/new warehouse ids in before/after (one business audit for the switch).

---

## Domain events

In-process (not durable; no outbox):

```text
warehouse.created
warehouse.updated
warehouse.activated
warehouse.deactivated
warehouse.default_changed
```

Payloads carry stable ids (`companyId`, `warehouseId`, …). Correctness does **not** depend on event delivery.

---

## Integrity check

```bash
pnpm db:check:warehouse
```

Validates: no orphan company relation, ≤1 default/company, default is ACTIVE, companies with ACTIVE warehouses have exactly one ACTIVE default.

---

## Seed

Pishteh: `MAIN` (default) + `RETURNS`. Demo B: `MAIN` (isolation sample). Seed is idempotent.

---

## Relationships

```text
Warehouse → WarehouseLocation   (Phase 3.3 — see warehouse-locations.md)
```

Still future:

```text
GoodsReceipt.warehouseId
InventoryMovement.warehouseId
StockBalance.warehouseId
StockTransfer.sourceWarehouseId / destinationWarehouseId
```

All must reference `warehouse.id`, never `code`.

---

## Negative gate (must stay FALSE for Master)

Warehouse Master does not contain stock quantity, Product/SKU masters, Goods Receipt, Movements, Stock Balance, Batch, FIFO, Transfers, Counts, Reservations, scanner UX, or Sales. (Locations are Phase 3.3.)
