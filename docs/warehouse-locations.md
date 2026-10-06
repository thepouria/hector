# Warehouse Locations (Phase 3.3)

Flexible physical location hierarchy under a Warehouse.

> **Implementation status:** Phase **3.3 implemented**. Goods Receipt, Putaway, Movements, Stock Balance, Batch, FIFO, Transfers, Counts, Reservations, and full scanner UX remain **out of scope**.

Companions: `docs/warehouse-architecture.md`, `docs/warehouse-invariants.md`, `docs/warehouse-master.md`.

---

## Model

Single adjacency-list table:

```text
WarehouseLocation
  id, companyId, warehouseId
  parentId?          # null = root under Warehouse
  type               # ZONE | AISLE | RACK | SHELF | BIN
  code               # normalized operational code (warehouse-scoped unique)
  name?              # optional display name
  barcode            # stable server-generated LOC-* operational barcode
  status             # ACTIVE | INACTIVE (WarehouseStatus)
  sortOrder
  notes?
  createdAt, updatedAt
```

No rigid `WarehouseZone` / `WarehouseAisle` / … tables.

---

## Flexible hierarchy

Levels may be skipped. All of these are valid:

```text
Warehouse → SHELF
Warehouse → ZONE → SHELF → BIN
Warehouse → ZONE → AISLE → RACK → SHELF → BIN
```

Type ranks (code-level only):

| Type  | Rank |
|-------|------|
| ZONE  | 10   |
| AISLE | 20   |
| RACK  | 30   |
| SHELF | 40   |
| BIN   | 50   |

Inverted ranks (e.g. `BIN` parent of `ZONE`) are rejected. Same-rank and skipped levels are allowed. No artificial max depth of 5; traversal is bounded for safety.

---

## Parent rules

- Parent must share `companyId` + `warehouseId`
- No self-parent
- No cycles (ancestor walk under advisory lock on parent change)
- `warehouseId` is immutable after create (no cross-warehouse move)

---

## Code

- Normalized: trim + uppercase (same alphabet as Warehouse codes)
- Unique per `(companyId, warehouseId, code)`
- Same code in two warehouses is allowed
- Code is not database identity

---

## Barcode (Warehouse-owned)

| Concern | Catalog product barcode | Location barcode |
|---------|-------------------------|------------------|
| Owner   | Catalog                 | Warehouse        |
| Resolves to | SKU                 | WarehouseLocation |
| Namespace | supplier / EAN / etc. | reserved `LOC-` |

- Server generates opaque `LOC-{HEX}` on create
- Stable across name / code / parent changes
- Exact match after trim-only normalization
- Never auto-creates on unknown scan
- Resolve is a read (no audit / domain event)
- Inactive locations still resolve (response includes `status`)

---

## Lifecycle

- Create only under **ACTIVE** Warehouse
- Cannot deactivate location while **ACTIVE descendants** exist
- Cannot deactivate Warehouse while **ACTIVE locations** exist
- No silent cascade

---

## API

```text
GET    /api/v1/warehouses/:warehouseId/locations
GET    /api/v1/warehouses/:warehouseId/locations/:locationId
POST   /api/v1/warehouses/:warehouseId/locations
PATCH  /api/v1/warehouses/:warehouseId/locations/:locationId
POST   /api/v1/warehouses/:warehouseId/locations/:locationId/activate
POST   /api/v1/warehouses/:warehouseId/locations/:locationId/deactivate
POST   /api/v1/warehouse-locations/resolve-barcode
```

List supports `view=tree|flat`, filters (`type`, `status`, `parentId`, `search`), pagination for flat view. Tree = single warehouse query + in-memory build (no N+1).

---

## RBAC

Reuses `warehouse.read` / `warehouse.manage` (resolve uses read).

---

## Audit / events

| Action | Audit | Domain event |
|--------|-------|--------------|
| create | `WAREHOUSE_LOCATION_CREATED` | `warehouse.location.created` |
| update | `WAREHOUSE_LOCATION_UPDATED` | `warehouse.location.updated` |
| move parent | `WAREHOUSE_LOCATION_MOVED` (+ previous/new parent) | `warehouse.location.moved` |
| activate / deactivate | matching actions | matching events |
| barcode resolve | none | none |

---

## UI

`/app/warehouse/[warehouseId]/locations` — tree with add root/child, edit/move parent, activate/deactivate, barcode copy, filters. RTL-aware indentation.

Query keys include `companyId` + `warehouseId`.

---

## Future inventory readiness

Locations expose stable `id` + `barcode` for future:

```text
StockBalance(warehouseId, locationId, …)
InventoryMovement(… locationId …)
Putaway / Transfer / Count targeting locationId
```

Location does **not** store quantity, sellable/reserved, capacity, or inventory state (SELLABLE/TESTER/…).
