# Sales Architecture (Phase 5.1–5.4)

Sales owns commercial sale facts. Catalog, Warehouse, and Finance remain authoritative for their domains.

## Ownership boundaries

| Domain | Owns | Does not own |
| --- | --- | --- |
| **Sales** | Channels, Customers, Sales Orders, commercial sale facts, order lifecycle, cancellation trackers, returns (intent + receive orchestration), reservation requests, fulfillment documents | Product/SKU master, stock balances/movements/FIFO (posted via Warehouse services), financial ledger/cash truth (AR foundation via Finance) |
| **Catalog** | Product, SKU, Variant, Barcode, attributes | Orders, pricing engines, marketplace listings |
| **Warehouse** | On Hand / Reserved / Available, locations, batches, FIFO layers, inventory movements | Sales order commercial terms |
| **Finance** | Accounts, payments, receipts, receivables/payables, journal/GL, FX | Channel identity, customer CRM fields |

## Channel model

`SalesChannel` is a company-scoped master:

- `code` — machine-readable identity (`WEBSITE`, `KHANOUMI`, …), unique per company
- `name` — display label
- `type` — `WEBSITE` \| `MARKETPLACE` \| `WHOLESALE` \| `MANUAL` \| `OTHER`
- `status` — `ACTIVE` \| `INACTIVE` (prefer deactivation over delete)

Marketplace names are **codes**, not enum values. Future marketplaces do not require schema redesign.

## Customer model

`Customer` is a reusable company-scoped buyer master (especially wholesale/credit):

- Minimal create: `type` + `displayName` only
- Optional: code, names, mobile/phone/email, nationalId/taxId/registrationNumber, notes
- `CustomerAddress` supports multiple addresses with at most one active `isDefault`

Customer identity is the internal UUID. Contact fields are **not** globally unique unless explicitly constrained later.

Customer Master does **not** store authoritative debt/receivable balance — that is Finance (later).

## Sales Order truth (Phase 5.2)

`SalesOrder` is the canonical commercial sale document:

- Belongs to exactly one Company; references exactly one Sales Channel
- Optional `customerId` (wholesale normally has a customer; some retail/manual flows may omit)
- Server-owned: `orderNumber` (`SO-######`), `status`, all money totals
- Payment terms (`CASH` / `CREDIT` / `PARTIAL`) are **commercial agreements**, not cash movements
- `expectedUpfrontAmount` (PARTIAL) is agreed commercial intent — **not** paidAmount
- Snapshots (`customerNameSnapshot`, address snapshots) preserve sale-time display context
- External identity uniqueness: `(companyId, channelId, externalOrderId)` when present

Wholesale uses this same `SalesOrder` engine — no parallel wholesale sales module.

## Sales Order Item truth

`SalesOrderItem` references canonical Catalog `skuId` (no parallel Sales SKU master).

- `quantity` = original ordered quantity (immutable under cancellation)
- `cancelledQuantity` / `returnedQuantity` are trackers; they never rewrite `quantity`
- Line money (`unitPrice`, `discountAmount`, `lineSubtotal`, `lineNetTotal`) is server-computed
- Optional SKU/product name/code snapshots for historical display

## Commercial amount formulas

```text
lineSubtotal     = quantity × unitPrice
lineNetTotal     = lineSubtotal − lineDiscountAmount
subtotal         = Σ lineSubtotal
itemDiscountTotal= Σ lineDiscountAmount
netItemsTotal    = Σ lineNetTotal
grandTotal       = netItemsTotal − orderDiscountTotal + shippingAmount + otherCharges
```

Client-supplied totals / status / companyId are rejected (`forbidNonWhitelisted`) or ignored; server recomputes.

Unit price must be > 0 in 5.2 (zero-price gifts deferred). Discounts / shipping / other charges are non-negative.

## Payment-term semantics

| Term | Meaning in Sales | Not owned by Sales |
| --- | --- | --- |
| `CASH` | Commercial expectation of immediate settlement | Actual receipt / cash movement |
| `CREDIT` | Commercial credit sale; optional `dueDate` | Receivable balance / aging |
| `PARTIAL` | Agreed upfront + remainder; `expectedUpfrontAmount` | Actual paid / outstanding |

## Lifecycle matrix (Phase 5.3 public)

```text
DRAFT              → CONFIRMED | CANCELLED
CONFIRMED          → PROCESSING | PARTIALLY_FULFILLED | FULFILLED | CANCELLED
PROCESSING         → PARTIALLY_FULFILLED | FULFILLED | CANCELLED
PARTIALLY_FULFILLED → FULFILLED | CANCELLED
FULFILLED          → (none)
CANCELLED          → (none)
```

Reservation moves `CONFIRMED → PROCESSING`. Fulfillment complete derives `PARTIALLY_FULFILLED` / `FULFILLED` (CONFIRMED may jump if reserve was skipped).

**Confirmed-order immutability:** commercial header/lines are editable only while `DRAFT`. Confirm locks commercial facts (PATCH → 409 `SALES_ORDER_NOT_EDITABLE`).

## Cancellation

- Full cancel: remaining open qty on each line → `cancelledQuantity`; status → `CANCELLED`
- Partial item cancel: increments `cancelledQuantity` without changing `quantity`
- Cancelled qty cannot exceed `quantity − cancelledQuantity`
- Original order history and money totals are preserved

## Returns (commercial intent)

`SalesReturn` / `SalesReturnItem` capture commercial return intent (`SR-######`).

**Returnable (5.3):**

```text
returnableQuantity = fulfilledQuantity − returnedQuantity
```

Approve (commercial) increments order-item `returnedQuantity`. Physical receive (`RECEIVED`) posts Warehouse `RETURN_IN` + Finance AR credit.

Return status: `DRAFT` → `APPROVED` | `CANCELLED`; `APPROVED` → `RECEIVED` | `CANCELLED`.

## Sales ↔ Catalog

`SalesOrderItem` / `SalesReturnItem` reference Catalog `skuId`. Sales never creates a parallel Product/SKU master. Historical name/code snapshots may be stored as sale facts.

## Sales ↔ Warehouse (5.3)

Sales never bypasses Warehouse services. Fulfillment complete calls `InventoryLedgerService` / `InventoryReservationsService` inside the outer TX.

```text
Confirm → best-effort reserve (Warehouse reservation; no movement)
Fulfillment complete → ISSUE + FIFO consume + reservation consume
Return receive → RETURN_IN
```

## Sales ↔ Finance (5.3)

```text
SALE ≠ PAYMENT
ORDER VALUE ≠ CASH RECEIVED
MARKETPLACE SALE ≠ MARKETPLACE SETTLEMENT
RECEIVABLE ≠ BANK BALANCE
RETURN ≠ REFUND
```

Fulfillment complete creates `CustomerReceivable` + journal (DR AR · CR REVENUE). CASH terms still create AR — no fake bank. See `docs/sales-recognition.md`.

Return receive creates credit receivable + `SALES_AR_CREDIT` journal.

## Phase 5.4 — Dashboard, UI, Integrity

Phase 5.4 closes the Sales operational surface:

| Area | Ownership |
| --- | --- |
| `GET /sales/dashboard` | Server-side company aggregates; optional channel + range filters |
| Order detail enrichment | Derived qty trackers, reservation/fulfillment/finance summaries |
| Web UI (`/app/sales/*`) | RTL Persian operational screens (dashboard, orders, customers, channels, returns) |
| `pnpm db:check:sales` / `sales:integrity` | Read-only SQL/JS integrity runner — never mutates |

Outstanding receivables on the dashboard are **Finance** `CustomerReceivable` OPEN rows (labeled). They are not a second Sales debt store.

## FUTURE only (not Phase 5)

| Topic | Phase |
| --- | --- |
| AR cash settlement / receipt allocation | **6** |
| Marketplace APIs, credentials, listing sync | **6** |
| Marketplace settlement / reconciliation | **6** |
| Profit / COGS / margin | 7 |
| Buy Box / automatic repricing | 8 |

**Settlement is Phase 6.** Phase 5.4 does not implement marketplace APIs, settlement engine, profit, or AR cash settlement.

## External order identity

Uniqueness scoped as:

```text
(companyId, channelId, externalOrderId)  when externalOrderId is present
```

Do not store API tokens on `SalesChannel`. Prefer a future `ChannelIntegration` / adapter layer.

## Seeded Pishteh channels

| code | name | type |
| --- | --- | --- |
| WEBSITE | Pishteh Website | WEBSITE |
| KHANOUMI | Khanoumi | MARKETPLACE |
| DIGIKALA | Digikala | MARKETPLACE |
| SNAPP_SHOP | Snapp Shop | MARKETPLACE |
| WHOLESALE | Wholesale | WHOLESALE |
| MANUAL | Manual | MANUAL |

See also: `docs/sales-invariants.md`, `docs/warehouse-sales-contract.md`.
