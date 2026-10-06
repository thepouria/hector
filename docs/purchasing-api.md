# Purchasing API (Phase 2.12)

Production HTTP surface for Hector Purchasing (Phases 2.1–2.11).

Authority for domain rules: `docs/purchasing-architecture.md` and phase docs. This document is the **API boundary** contract for UI and external clients.

---

## Overview

```text
Next.js UI
    │
    ▼
Purchasing HTTP API  (/api/v1/purchasing/*)
    │
    ▼
Controllers (auth / RBAC / DTO only)
    │
    ▼
Application Services
    │
    ▼
Purchasing Domain Rules
    │
    ├── Supplier / Contacts / Notes
    ├── Offers
    ├── Purchase Orders / Items / Costs
    ├── Lifecycle commands
    ├── Corrections / Discrepancies / Short-close
    └── Purchase Returns
    │
    ▼
Prisma / PostgreSQL
```

**Critical:** Controllers do not contain business rules and do not call Prisma for business operations. Internal modules (Warehouse later) should use typed Nest providers / application contracts — **not** call Hector’s own HTTP endpoints.

---

## Authentication

All Purchasing endpoints require an authenticated session (Bearer access token).

There are **no** public Purchasing endpoints.

---

## Company Context

Company is resolved from authenticated company context (`X-Company-Id` + membership), never from request body `companyId`.

Every query is tenant-scoped. Cross-company IDs return not-found (or forbidden) per Hector security convention — no existence leaks.

---

## RBAC

| Permission | Purpose |
|---|---|
| `purchasing.read` | List/read suppliers, offers, POs, costs, corrections, discrepancies, returns, summary |
| `purchasing.create` | Create suppliers, offers, draft POs |
| `purchasing.manage` | Update draft commercial data, items, costs, order command, supplier/offer lifecycle |
| `purchasing.approve` | Approve PO |
| `purchasing.cancel` | Cancel PO |
| `purchasing.po.correct` | Apply committed corrections |
| `purchasing.po.short_close` | Short-close remaining quantity |
| `purchasing.discrepancy.manage` | Record discrepancies |
| `purchasing.return.create` | Create/update DRAFT returns |
| `purchasing.return.approve` | Approve return intent |
| `purchasing.return.cancel` | Cancel return plan |

Permissions are AND-scoped per route (one primary key per endpoint).

---

## Endpoint matrix

Base prefix: `/api/v1`

| Method | Path | Purpose | Permission | Lifecycle notes |
|---|---|---|---|---|
| GET | `/purchasing/summary` | Operational counts | `purchasing.read` | Purchasing facts only |
| GET | `/purchasing/dashboard` | Operational dashboard aggregates (2.14) | `purchasing.read` | Query: `range`, `from`, `to`, `supplierId`, `purchaseType`, `status`, `currency`. Period basis `orderDate`. No Finance/Warehouse KPIs. See `docs/purchase-dashboard.md`. |
| GET | `/purchasing/purchase-orders/:id/activity` | Business activity timeline (2.15) | `purchasing.read` | Paginated projection of Audit for PO + related child entities. Raw audit remains `GET /audit-logs` (`audit.read`). See `docs/purchasing-audit.md`. |
| GET | `/purchasing/suppliers` | List/search suppliers | `purchasing.read` | Default excludes ARCHIVED |
| POST | `/purchasing/suppliers` | Create supplier | `purchasing.create` | |
| GET | `/purchasing/suppliers/:id` | Supplier detail | `purchasing.read` | Contacts summary; not full PO history |
| PATCH | `/purchasing/suppliers/:id` | Update supplier | `purchasing.manage` | |
| POST | `/purchasing/suppliers/:id/activate` | Activate | `purchasing.manage` | |
| POST | `/purchasing/suppliers/:id/deactivate` | Deactivate | `purchasing.manage` | |
| POST | `/purchasing/suppliers/:id/archive` | Archive | `purchasing.manage` | Soft archive |
| GET | `/purchasing/suppliers/:id/contacts` | List contacts | `purchasing.read` | |
| POST | `/purchasing/suppliers/:id/contacts` | Create contact | `purchasing.manage` | |
| PATCH | `/purchasing/suppliers/:id/contacts/:contactId` | Update contact | `purchasing.manage` | |
| POST | `/purchasing/suppliers/:id/contacts/:contactId/set-primary` | Set primary | `purchasing.manage` | |
| POST | `/purchasing/suppliers/:id/contacts/:contactId/archive` | Archive contact | `purchasing.manage` | |
| GET | `/purchasing/suppliers/:id/notes` | List notes | `purchasing.read` | |
| POST | `/purchasing/suppliers/:id/notes` | Add note | `purchasing.manage` | |
| GET | `/purchasing/offers` | List offers | `purchasing.read` | Filters: supplierId, skuId, currency, validity, validAt |
| GET | `/purchasing/offers/compare` | Compare offers for SKU | `purchasing.read` | |
| GET | `/purchasing/offers/latest` | Latest offer helpers | `purchasing.read` | |
| GET | `/purchasing/offers/:id` | Offer detail | `purchasing.read` | |
| POST | `/purchasing/offers` | Create offer | `purchasing.create` | |
| PATCH | `/purchasing/offers/:id` | Update offer | `purchasing.manage` | |
| POST | `/purchasing/offers/:id/archive` | Archive offer | `purchasing.manage` | |
| GET | `/purchasing/purchase-orders` | List POs | `purchasing.read` | Compact list rows |
| POST | `/purchasing/purchase-orders` | Create DRAFT PO | `purchasing.create` | Totals server-owned |
| GET | `/purchasing/purchase-orders/:id` | PO detail + cost summary | `purchasing.read` | |
| PATCH | `/purchasing/purchase-orders/:id` | Update header | `purchasing.manage` | DRAFT full; committed notes/expectedAt |
| POST | `/purchasing/purchase-orders/:id/items` | Add item | `purchasing.manage` | DRAFT only |
| PATCH | `/purchasing/purchase-orders/:id/items/:itemId` | Update item | `purchasing.manage` | DRAFT only |
| DELETE | `/purchasing/purchase-orders/:id/items/:itemId` | Remove item | `purchasing.manage` | DRAFT only |
| POST | `/purchasing/purchase-orders/:id/approve` | DRAFT→APPROVED | `purchasing.approve` | Command |
| POST | `/purchasing/purchase-orders/:id/order` | APPROVED→ORDERED | `purchasing.manage` | Command |
| POST | `/purchasing/purchase-orders/:id/mark-ordered` | Alias of `/order` | `purchasing.manage` | Compat |
| POST | `/purchasing/purchase-orders/:id/cancel` | →CANCELLED | `purchasing.cancel` | Command |
| GET | `/purchasing/purchase-orders/:id/costs` | List costs | `purchasing.read` | |
| POST | `/purchasing/purchase-orders/:id/costs` | Add cost | `purchasing.manage` | |
| PATCH | `/purchasing/purchase-orders/:id/costs/:costId` | Update DRAFT cost | `purchasing.manage` | |
| DELETE | `/purchasing/purchase-orders/:id/costs/:costId` | Remove DRAFT cost | `purchasing.manage` | |
| POST | `/purchasing/purchase-orders/:id/costs/:costId/void` | Void cost | `purchasing.manage` | |
| GET | `/purchasing/purchase-orders/:id/corrections` | Correction history | `purchasing.read` | Immutable APPLIED |
| POST | `/purchasing/purchase-orders/:id/corrections` | Apply correction | `purchasing.po.correct` | Typed DTO |
| GET | `/purchasing/purchase-orders/:id/discrepancies` | List discrepancies | `purchasing.read` | |
| POST | `/purchasing/purchase-orders/:id/discrepancies` | Record discrepancy | `purchasing.discrepancy.manage` | No stock |
| POST | `/purchasing/purchase-orders/:id/items/:itemId/short-close` | Short-close remainder | `purchasing.po.short_close` | Keeps ordered qty |
| GET | `/purchasing/purchase-returns` | List returns | `purchasing.read` | |
| POST | `/purchasing/purchase-returns` | Create DRAFT return | `purchasing.return.create` | |
| GET | `/purchasing/purchase-returns/:id` | Return detail | `purchasing.read` | |
| PATCH | `/purchasing/purchase-returns/:id` | Update DRAFT | `purchasing.return.create` | |
| POST | `/purchasing/purchase-returns/:id/approve` | Approve intent | `purchasing.return.approve` | ≠ stock out |
| POST | `/purchasing/purchase-returns/:id/cancel` | Cancel plan | `purchasing.return.cancel` | |

### Explicitly not exposed

```text
POST .../receive
POST .../mark-received
POST .../partial-receive
PATCH { status: "RECEIVED" }
DELETE /purchase-orders/:id          (committed)
refund / credit-note / reduce-payable
dispatch / ship / stock-out
```

Receiving contract (`PurchaseReceivingContract`) is an **internal** Nest provider for Phase 3 — not a public HTTP API.

---

## Filtering / Searching / Sorting / Pagination

Shared pagination: `page` (≥1), `pageSize` (default 20, max **100**).

### Suppliers

- Filters: `status`, `search` (name/legalName/code/phone/contacts), `view=full|options`
- Sort whitelist: `name`, `createdAt`, `updatedAt`

### Offers

- Filters: `supplierId`, `skuId`, `productId`, `currency`, `purchaseType`, `paymentTermType`, `quotedFrom`/`quotedTo`, `validAt`, `validity`, `search`
- Sort whitelist: `quotedAt`, `unitPrice`, `createdAt`, `validUntil`
- Validity / `expiryState` derived in service (CURRENT / EXPIRED / NO_EXPIRY / ARCHIVED)

### Purchase orders

- Filters: `status`, `purchaseType`, `paymentTermType`, `supplierId`, `skuId`, `currency`, `orderFrom`/`orderTo`, `createdFrom`/`createdTo`, `dueFrom`/`dueTo`, `dueStatus`, `search`
- Sort whitelist: `orderDate`, `dueDate`, `createdAt`, `number`, `total`, `status`
- `dueStatus=OVERDUE` means **contractual dueDate passed** — not “unpaid”

### Returns

- Filters: `status`, `supplierId`, `purchaseOrderId`, `search`
- Sort whitelist: `createdAt`, `number`, `status`

Date ranges reject `from > to`. Search strings are length-capped and passed as parameterized Prisma `contains` (no SQL interpolation). Sort keys are whitelisted — never raw column names from clients.

---

## Money / Decimal serialization

| Rule | Detail |
|---|---|
| Authority | Prisma `Decimal` / domain money helpers |
| API JSON | Decimal amounts as **strings** (e.g. `"490000"`) |
| IRR | Whole rials |
| FX | Foreign obligation remains foreign-currency based; reference local value is valuation only |

Totals:

```text
subtotal     = Σ item line commercial values (PO currency)
costsTotal   = ACTIVE purchase costs (may be multi-currency; see cost summary)
total        = PO commercial total (items); acquisition reference may include costs separately
```

FX_CREDIT responses expose obligation + reference rate fields explicitly. Do not treat `referenceLocalValue` as the amount that must be paid.

---

## Purchase types (API semantics)

| Type | Exposed |
|---|---|
| CASH | Local total; no foreign obligation / term days |
| FX_CREDIT | `obligationAmount` + `obligationCurrency` + reference FX fields |
| TERM_CREDIT | `paymentTermType`, `netDays`, server `dueDate` |

---

## Lifecycle commands

Transitions only via:

```text
POST .../approve
POST .../order   (or /mark-ordered)
POST .../cancel
```

Never via `PATCH { status }`. Illegal transitions return domain conflict/validation errors. Idempotency: repeated approve on already-approved follows Phase 2.9 (no duplicate meaningful side effects).

---

## Corrections / Discrepancies / Short-close / Returns

- Corrections: typed body (`type`, reason, structured fields) — not arbitrary `{ field, value }`.
- Applied corrections are immutable (no PATCH).
- Discrepancy / short-close do **not** rewrite ordered quantity and do **not** mutate stock.
- Purchase Return APPROVED = commercial intent only (`physicalExecution: DEFERRED_TO_WAREHOUSE`).

---

## Errors (selected)

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | DTO / query validation |
| `FORBIDDEN` / `PERMISSION_REQUIRED` | RBAC |
| `SUPPLIER_NOT_FOUND` | Missing / wrong company |
| `SUPPLIER_OFFER_NOT_FOUND` | Missing offer |
| `PURCHASE_ORDER_NOT_FOUND` | Missing PO |
| `PURCHASE_ORDER_NOT_EDITABLE` | Lifecycle freeze |
| `PURCHASE_ORDER_INVALID_STATUS_TRANSITION` | Illegal command |
| `PURCHASE_ORDER_VERSION_CONFLICT` | Optimistic concurrency |
| `PURCHASE_ORDER_ITEM_NOT_FOUND` | Missing item |
| `PURCHASE_CORRECTION_NOT_ALLOWED` | Correction blocked |
| `PURCHASE_CORRECTION_UNSUPPORTED` | Unsupported correction type/field |
| `PURCHASE_SHORT_CLOSE_INVALID` / `NOT_ALLOWED` | Short-close rules |
| `PURCHASE_RETURN_NOT_FOUND` | Missing return |
| `PURCHASE_RETURN_INVALID_STATUS` | Illegal return transition |
| `PURCHASE_RETURN_SUPPLIER_MISMATCH` | Supplier ≠ PO supplier |
| `PURCHASE_RETURN_ITEM_INVALID` / `SKU_MISMATCH` | Item/SKU integrity |

Envelope follows Hector global exception filter (stable `code` + message).

---

## Audit & Domain Events

API commands trigger Audit and Domain Events **inside services** (transaction + `commitThenPublish`). Controllers never write Audit/Events directly.

Events are internal (in-process). There is no public `/events` Purchasing endpoint.

---

## Warehouse boundary

- No receive HTTP endpoints.
- No stock mutation from Purchasing API.
- Phase 3 consumes `PurchaseReceivingContract` and approved `PurchaseReturn` as typed contracts.

## Finance boundary

- No refund / credit-note / payable / cash / FX settlement endpoints.
- Due filters are contractual calendar status only.

---

## Examples

### Create CASH PO

```http
POST /api/v1/purchasing/purchase-orders
X-Company-Id: <uuid>
Authorization: Bearer <token>

{
  "supplierId": "<uuid>",
  "purchaseType": "CASH",
  "currency": "IRR",
  "items": [{ "skuId": "<uuid>", "quantity": 100, "unitPrice": "5000000" }]
}
```

### Approve → Order

```http
POST /api/v1/purchasing/purchase-orders/:id/approve
{ "expectedVersion": 1 }

POST /api/v1/purchasing/purchase-orders/:id/order
{ "expectedVersion": 2, "supplierOrderReference": "SUP-778" }
```

### Correct price (committed)

```http
POST /api/v1/purchasing/purchase-orders/:id/corrections
{
  "type": "PRICE_CORRECTION",
  "purchaseOrderItemId": "<uuid>",
  "unitPrice": "4900000",
  "reason": "Supplier confirmed unit price was entered incorrectly.",
  "expectedVersion": 3
}
```

### Approve purchase return

```http
POST /api/v1/purchasing/purchase-returns/:id/approve
{ "expectedVersion": 1 }
```

Does **not** reduce stock or create supplier credit.

---

## Future module integration

| Consumer | Integration |
|---|---|
| UI | This HTTP API |
| Warehouse | Internal receiving + return execution contracts |
| Finance | Consume commercial truth / due dates; separate settlement APIs later |
