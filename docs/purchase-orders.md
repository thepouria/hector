# Purchase Orders (Phase 2.4)

The Purchase Order (PO) is the Purchasing **commitment document**: which Supplier, which SKUs, what quantity, at what committed unit price and currency.

```text
Quote (Supplier Offer)  ≠  Purchase Order      # a quote is an observation, a PO is a decision
PO ordered quantity     ≠  received quantity   # receiving belongs to Warehouse (Phase 3+)
PO total                ≠  payment             # settlement belongs to Finance
```

Architecture authority: `docs/purchasing-architecture.md`. Lifecycle: `docs/purchase-lifecycle.md`. Supplier: `docs/supplier-master.md`. Quotes: `docs/supplier-offers.md`. Purchase types: `docs/purchase-types.md`. SKU identity: Catalog.

---

## Scope

Implemented:

- Create a DRAFT PO (at least one item) with a server-allocated number
- Edit the DRAFT header; add / update / remove DRAFT items
- `approve`, `order` (alias `mark-ordered`), `cancel` as intentful commands (never `PATCH { status }`)
- Server-computed `lineSubtotal`, `subtotal`, `total`
- Snapshots frozen at `ORDERED`; optional `supplierOrderReference`
- Optimistic concurrency (`version`) + row locking
- Audit + Domain Events (`commitThenPublish`)
- Server-derived `availableActions`; Web UI timeline under `/app/purchasing/orders`

**Phase 2.5–2.8:** purchase types, FX, credit terms, purchase costs — see linked docs.

**Phase 2.9:** final lifecycle state machine — see `docs/purchase-lifecycle.md`.

**Phase 2.10:** Purchasing↔Warehouse receiving contract — see `docs/purchase-receiving-contract.md`.
Conceptually `PurchaseOrder` 1→N GoodsReceipt and `PurchaseOrderItem` 1→N GoodsReceiptItem
(linked by stable IDs). **No GoodsReceipt tables yet.**

Not implemented (later phases): payments, Warehouse Goods Receipt persistence, stock, `CLOSED`/short-close, FX settlement / wallets (Finance), landed-cost allocation, returns (2.11).

---

## Lifecycle

Canonical detail: `docs/purchase-lifecycle.md`.

```text
DRAFT ──approve──▶ APPROVED ──order──▶ ORDERED
  │                   │                   │
  └────cancel─────────┴────cancel─────────┴──▶ CANCELLED (terminal)

ORDERED ──(Phase 3 Goods Receipt)──▶ PARTIALLY_RECEIVED / RECEIVED
```

| From | To | Command | Permission | Notes |
|---|---|---|---|---|
| DRAFT | APPROVED | `POST /:id/approve` | `purchasing.approve` | Revalidates commercial terms |
| APPROVED | ORDERED | `POST /:id/order` (alias `/mark-ordered`) | `purchasing.manage` | Supplier commitment; freezes snapshots |
| DRAFT | CANCELLED | `POST /:id/cancel` | `purchasing.cancel` | Reason optional |
| APPROVED / ORDERED | CANCELLED | `POST /:id/cancel` | `purchasing.cancel` | Reason **required** |

`PARTIALLY_RECEIVED` / `RECEIVED` are filterable enum values but have **no public Purchasing transition**. `ORDERED → CANCELLED` is allowed in 2.9 while no Goods Receipt exists (always true until Phase 3).

Dates: `orderDate` = business calendar date (credit-term basis); `orderedAt` = system timestamp of ORDERED transition.

---

## Editability

| Status | Header commercial fields (supplier, contact, currency, orderDate, purchase type / terms) | Items | `notes`, `expectedAt` |
|---|---|---|---|
| DRAFT | edit (type change clears incompatible terms) | add / update / remove | edit |
| APPROVED | locked (`409 PURCHASE_ORDER_NOT_EDITABLE`) | locked | edit |
| ORDERED | locked | locked | edit |
| CANCELLED | locked | locked | locked |

- **Supplier and currency cannot change while the PO has items** (`409 PURCHASE_ORDER_PARTY_LOCKED`). Remove the items first (a DRAFT may be emptied; it just cannot be approved while empty). Changing supplier clears the old supplier's contact.
- Changing `orderDate` on a DRAFT does **not** regenerate the number.
- `cancellationReason` is set only through `cancel`.

---

## Model

`PurchaseOrder` (`purchase_orders`)

| Field | Notes |
|---|---|
| `number` | `PO-YYYY-NNNNNN`, `UNIQUE(companyId, number)` |
| `supplierId`, `supplierContactId?` | composite FK `(id, companyId)` — cross-company references are impossible |
| `status` | `DRAFT \| APPROVED \| ORDERED \| PARTIALLY_RECEIVED \| RECEIVED \| CANCELLED` |
| `currency` | `IRR \| USD`, one currency per PO |
| `purchaseType`, `paymentTermType`, `netDays`, `termBasis`, `dueDate`, `paymentTermsNote` | Commercial terms; see `docs/credit-terms.md` |
| `obligationAmount`, `obligationCurrency` | FX_CREDIT foreign obligation (synced from `total` on approve/order) |
| `referenceFxRate`, `referenceFxBaseCurrency`, `referenceFxQuoteCurrency` | FX_CREDIT reference pair (mandatory before approve/order) |
| `orderDate`, `orderedAt?`, `approvedAt?`, `expectedAt?`, `supplierOrderReference?`, `notes?`, `cancellationReason?` | `orderDate` ≠ `orderedAt` — see lifecycle doc |
| `subtotal`, `total` | `Decimal(24,6)`, server computed, `total = subtotal` in 2.4 |
| `supplierNameSnapshot`, `supplierCodeSnapshot` | filled at `ORDERED` |
| `createdById`, `approvedById?`, `orderedById?`, `cancelledById?` + `*At` | |
| `version` | starts at 1, incremented on every successful mutation |

`PurchaseOrderCost` (`purchase_order_costs`) — 1→N acquisition costs on the PO (Phase 2.8). See `docs/purchase-costs.md`.

`PurchaseOrderItem` (`purchase_order_items`)

| Field | Notes |
|---|---|
| `skuId` | composite FK `(skuId, companyId)`; `UNIQUE(purchaseOrderId, skuId)` |
| `quantity` | `Int`, `CHECK > 0`, API max 10,000,000 |
| `unitPrice` | `Decimal(24,6)`, `CHECK > 0` |
| `lineSubtotal` | `quantity × unitPrice`, server computed |
| `supplierOfferId?` | optional reference to a quote (see below) |
| `notes?` | |
| `skuCodeSnapshot`, `productNameSnapshot`, `variantLabelSnapshot`, `productIdSnapshot` | filled at `ORDERED` |

`PurchaseOrderSequence` (`purchase_order_sequences`): `companyId` PK, `nextValue`.

Max 500 items per PO. Items return in insertion order (`createdAt`, `id`).

---

## Money

Same rules as Supplier Offers (`parsePositiveMoney` is reused):

- API money is a **decimal string**; JSON numbers are rejected.
- `IRR` = whole **rials** (Toman is UI display only). Fractional IRR is rejected.
- `USD` allows up to 6 decimals.
- Unit price must be > 0 and < 10,000,000,000; the PO total must stay inside `Decimal(24,6)`.
- Totals are computed with `Decimal` math only. Any client-sent `subtotal`, `total`, `lineSubtotal`, `status`, `number`, `version`, snapshot or ownership field is rejected with `400` (global `forbidNonWhitelisted`), so it can never be trusted or silently ignored.

---

## Numbering strategy

Format: `PO-<UTC year of orderDate>-<company sequence padded to 6>` → `PO-2026-000001`.

- One counter per company in `purchase_order_sequences`, **not reset per year** (the year segment is informational; the sequence is monotonic per company).
- Allocation happens **inside the create transaction** with one atomic statement:

  ```sql
  INSERT INTO purchase_order_sequences (company_id, next_value) VALUES ($1, 2)
  ON CONFLICT (company_id) DO UPDATE SET next_value = purchase_order_sequences.next_value + 1
  RETURNING next_value - 1 AS allocated;
  ```

- The conflicting update takes a row lock, so concurrent creates for a company serialize and receive distinct values; a failed create rolls the counter back (gapless per company).
- `UNIQUE(companyId, number)` is the last line of defense.
- Seed fixtures use `SEED-PO-…` numbers outside the sequence namespace.
- Past 999,999 the number simply widens (`PO-2026-1000000`).

---

## Supplier Offer link

`supplierOfferId` is optional on an item. When present it must:

- exist in the same company (otherwise `404 SUPPLIER_OFFER_NOT_FOUND` — no existence leak),
- belong to the PO's supplier and to the item's SKU,
- use the PO currency,
- not be archived (`400 PURCHASE_ORDER_OFFER_INVALID`).

The **PO price may differ** from the quoted price; the quote is traceability, not a price lock. Responses include the linked offer's current quote for comparison. `null` clears the link on item update.

---

## Concurrency

- Every mutating command runs in a transaction that first takes `SELECT … FOR UPDATE` on the PO row, then re-reads it. Concurrent commands on the same PO serialize; the loser re-evaluates against the new state (e.g. a second `mark-ordered` sees `ORDERED` → `409`). Exactly one concurrent transition wins.
- Optional `expectedVersion` (body of `PATCH /:id`, `approve`, `mark-ordered`, `cancel`): mismatch → `409 PURCHASE_ORDER_VERSION_CONFLICT`.
- `version` is incremented on every successful mutation (header, items, transitions). No-op header updates do not bump it or emit audit/events.

---

## Archived Suppliers / SKUs

- Archived supplier or archived SKU/product cannot be used when **creating** a PO, **adding** an item, or **switching** supplier (`409 PURCHASE_ORDER_SUPPLIER_NOT_ASSIGNABLE` / `PURCHASE_ORDER_SKU_NOT_ASSIGNABLE`).
- A DRAFT/APPROVED PO whose supplier or SKU was archived meanwhile cannot be approved / marked ordered; it can still be cancelled.
- Historical POs (any status) stay readable; ORDERED/CANCELLED POs keep their snapshots. Reads always return both live (`supplier`, `item.sku`) and frozen (`*Snapshot`) values.

---

## API

Base: `/api/v1/purchasing/purchase-orders` (company header required).

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `purchasing.read` | List (search, filters, sort, pagination) |
| POST | `/` | `purchasing.create` | Create DRAFT with ≥ 1 item |
| GET | `/:id` | `purchasing.read` | Detail with items |
| PATCH | `/:id` | `purchasing.manage` | Header edit (see Editability) |
| POST | `/:id/items` | `purchasing.manage` | Add item (DRAFT) |
| PATCH | `/:id/items/:itemId` | `purchasing.manage` | Update `quantity`, `unitPrice`, `supplierOfferId`, `notes` (DRAFT) |
| DELETE | `/:id/items/:itemId` | `purchasing.manage` | Remove item (DRAFT) |
| POST | `/:id/approve` | `purchasing.approve` | DRAFT → APPROVED |
| POST | `/:id/order` | `purchasing.manage` | APPROVED → ORDERED (canonical) |
| POST | `/:id/mark-ordered` | `purchasing.manage` | Alias of `/order` |
| POST | `/:id/cancel` | `purchasing.cancel` | → CANCELLED, body `{ reason? }` |

`RequirePermissions` has **AND** semantics, so each route names a single primary permission instead of "approve OR manage" / "create OR manage". OWNER holds every permission. A custom role that should draft *and* edit needs both `purchasing.create` and `purchasing.manage`. Wrong role → `403`.

List query: `search`, `status`, `supplierId`, `skuId`, `currency`, `orderFrom`, `orderTo`, `sortBy` (`orderDate|createdAt|number|total`), `sortOrder`, `page`, `pageSize`. `search` matches number, notes, supplier name/code (live + snapshot) and item SKU code/name/product name (live + snapshot); Persian text works; input is parameterized (no injection).

Mutations return `{ data: <PurchaseOrder with items> }`.

### Error codes

`PURCHASE_ORDER_NOT_FOUND` / `PURCHASE_ORDER_ITEM_NOT_FOUND` (404), `PURCHASE_ORDER_INVALID_STATUS_TRANSITION`, `PURCHASE_ORDER_NOT_EDITABLE`, `PURCHASE_ORDER_VERSION_CONFLICT`, `PURCHASE_ORDER_DUPLICATE_SKU`, `PURCHASE_ORDER_EMPTY`, `PURCHASE_ORDER_PARTY_LOCKED`, `PURCHASE_ORDER_SUPPLIER_NOT_ASSIGNABLE`, `PURCHASE_ORDER_SKU_NOT_ASSIGNABLE` (409), `PURCHASE_ORDER_CONTACT_INVALID`, `PURCHASE_ORDER_OFFER_INVALID`, `PURCHASE_ORDER_INVALID_QUANTITY`, `PURCHASE_ORDER_INVALID_PRICE`, `PURCHASE_ORDER_INVALID_DATES`, `PURCHASE_ORDER_TOTAL_OUT_OF_RANGE` (400).

Cross-company supplier / SKU / offer / PO / item IDs return `404` (contact: `400`), never revealing existence.

---

## Audit & Events

Audit (same transaction as the mutation; entity `PURCHASE_ORDER` unless noted):

```text
PURCHASE_ORDER_CREATED        PURCHASE_ORDER_UPDATED
PURCHASE_ORDER_ITEM_ADDED     PURCHASE_ORDER_ITEM_UPDATED   PURCHASE_ORDER_ITEM_REMOVED   # entity PURCHASE_ORDER_ITEM
PURCHASE_ORDER_APPROVED       PURCHASE_ORDER_ORDERED        PURCHASE_ORDER_CANCELLED
```

Item audit rows carry `metadata.purchaseOrderId` and `metadata.number`.

Domain events (published only after commit; none on failure or no-op):

```text
purchasing.purchase_order.created | updated | approved | ordered | cancelled
purchasing.purchase_order.item_added | item_updated | item_removed
```

Payloads carry `companyId`, `purchaseOrderId`, `number`, `supplierId`, `status`, `currency`, plus `total` / `itemCount` / `previousStatus` / `version` where meaningful — never full entities.

---

## Seed

`pnpm db:seed` upserts (by `(companyId, number)`) two Pishteh POs for `TEH-BEAUTY` / `ESS-MASCARA-01`:

- `SEED-PO-DRAFT-01` — DRAFT, 1,000 × 5,850,000 IRR, linked to the seeded quote
- `SEED-PO-ORDERED-01` — ORDERED, 500 × 5,800,000 IRR, snapshots filled

Re-running the seed resets only these two documents.

---

## UI

Routes (Persian RTL, company-scoped React Query keys):

| Path | Purpose |
|---|---|
| `/app/purchasing/orders` | List + search/status/currency/sort |
| `/app/purchasing/orders/new` | Create DRAFT (≥1 item); optional “use latest quote” |
| `/app/purchasing/orders/:id` | Detail, draft item edits, approve / mark-ordered / cancel |

Nav: Purchasing → سفارش‌های خرید. Permissions mirror the API. IRR amounts are entered/displayed as Toman; API stores rials. UI never shows fake Paid/Received totals.

Company switch invalidates via `purchaseOrderKeys.*(companyId, …)`.

---

## Tests

- Unit: `purchase-order-money.spec.ts`, `purchase-order-status.spec.ts`, `purchase-order-numbering.spec.ts`
- E2E: `apps/api/test/purchase-orders.e2e-spec.ts`
