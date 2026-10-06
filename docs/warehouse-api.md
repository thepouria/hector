# Warehouse API (Phase 3.16–3.17)

HTTP surface for Hector Warehouse (Phases 3.1–3.15 domain + 3.16 integration + 3.17 dashboard/audit timelines).

Authority for domain rules: phase docs under `docs/` (`warehouse-architecture.md`, ledger, reservations, FIFO, valuation, …). This document is the **API boundary** for UI and scanner orchestration.

---

## Architecture

```text
Next.js UI / Scanner Center
        │
        ▼
Warehouse HTTP API  (/api/v1/…)
        │
        ▼
Controllers (auth / RBAC / DTO only)
        │
        ▼
Application / Domain Services
        │
        ▼
Canonical Warehouse Domain
        │
        ▼
Inventory Movement Ledger → StockBalance / FIFO / Reservations
```

**Critical:** Controllers and Scanner resolvers do **not** overwrite `StockBalance`. Physical mutations use explicit command endpoints that call canonical services.

---

## Company context

- Resolved from authenticated membership + `X-Company-Id`.
- Never trust `companyId` from body.
- Nested IDs (warehouse, location, SKU, receipt, transfer, …) are tenant-validated.

---

## Conventions

| Concern | Convention |
|---|---|
| List APIs | Existing Phase 0/1 pagination / sort / filter / search |
| Commands | Explicit `POST …/post`, `…/complete`, `…/dispatch`, etc. |
| Status | No generic PATCH `{ status }` for operational documents |
| Barcodes | Bounded strings; exact match; leading zeros preserved |
| Cost / valuation | Requires `warehouse.valuation.read` / `warehouse.cost_layer.read` |
| Idempotency | Scan-apply / mutation endpoints use `requestId` where domain defines it |

---

## Namespaces (actual routes)

Base prefix: `/api/v1`

| Area | Routes |
|---|---|
| Warehouses | `GET/POST /warehouses`, `POST /warehouses/:id/{activate,deactivate,set-default}` |
| Locations | `GET/POST /warehouses/:id/locations…`, `POST /warehouse-locations/resolve-barcode` |
| Goods receipts | `/goods-receipts…` (+ eligible POs, progress, scan, post, cancel) |
| Putaways | `/warehouse/putaways…` |
| Stock / inventory | `/warehouse/inventory…` |
| Movements | `/warehouse/inventory/movements…` |
| Transfers | `/warehouse/transfers…` |
| Issues | `/warehouse/issues…` |
| Classification | `POST /warehouse/stock/classification-change` |
| Adjustments | `/warehouse/adjustments…` |
| Counts | `/warehouse/counts…` |
| Supplier returns | `/warehouse/supplier-returns…`, `/warehouse/supplier-return-executions…` |
| Reservations | `/warehouse/reservations…`, `/warehouse/availability` |
| Cost layers / valuation | `/warehouse/cost-layers…`, `/warehouse/valuation…` |
| Dashboard | `GET /warehouse/dashboard` (optional `warehouseId`; valuation section permission-gated) |
| Entity activity | `GET …/:id/activity` on receipts, transfers, adjustments, counts, issues, supplier-return executions |
| Scanner resolvers | `GET /warehouse/scanner/products/resolve?barcode=`, `GET /warehouse/scanner/locations/resolve?barcode=` |

Stable existing routes were **not** renamed for aesthetics.

---

## Scanner resolvers

```text
GET /warehouse/scanner/products/resolve?barcode=
→ Catalog exact barcode resolve (no Product/SKU auto-create)

GET /warehouse/scanner/locations/resolve?barcode=
→ Location exact barcode resolve
```

Mutations remain on domain command endpoints (`scan-apply`, `post`, `complete`, `dispatch`, …). There is no `POST /scanner/do-everything`.

Permission: `warehouse.scanner.use`.

---

## Dashboard

```text
GET /warehouse/dashboard
```

Permission: `warehouse.stock.read`.

Returns bounded operational aggregates (SKUs with stock, units by classification, reserved/available, open queues, recent receipts/movements). Valuation is **not** embedded — use valuation endpoints + `warehouse.valuation.read`.

---

## RBAC (warehouse)

Uses existing keys such as:

- `warehouse.read` / `warehouse.manage`
- `warehouse.receipt.*`, `warehouse.putaway.*`, `warehouse.stock.read`
- `warehouse.transfer.*`, `warehouse.issue.*`, `warehouse.adjustment.*`, `warehouse.count.*`
- `warehouse.supplier_return.*`
- `warehouse.reservation.read` / `warehouse.reservation.manage`
- `warehouse.cost_layer.read` / `warehouse.valuation.read`
- `warehouse.scanner.use`
- `warehouse.classification.change`

Frontend hiding is UX only; every endpoint enforces permissions server-side.

---

## API invariants (Phase 3.16)

| ID | Rule |
|---|---|
| WH-API-001 | Every Warehouse endpoint is Company-scoped |
| WH-API-002 | Nested resource IDs are tenant validated |
| WH-API-003 | Physical stock changes only through canonical domain commands |
| WH-API-004 | No API directly overwrites StockBalance |
| WH-API-005 | Lifecycle transitions use explicit commands |
| WH-API-006 | Large collections are paginated/bounded |
| WH-API-007 | Barcode resolution is exact and string-based |
| WH-API-008 | API retries cannot duplicate physical inventory operations |
| WH-API-009 | Cost/valuation data requires explicit permission |
| WH-API-010 | Backend remains authoritative for inventory-derived quantities |

---

## Related docs

- `docs/warehouse-ui.md`
- `docs/scanner-ux.md`
- `docs/warehouse-architecture.md`
- `docs/warehouse-invariants.md`
- `docs/inventory-ledger.md`
- `docs/inventory-reservations.md`
- `docs/fifo-cost-layers.md`
- `docs/inventory-valuation.md`
