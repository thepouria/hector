# Purchase Lifecycle (Phase 2.9)

Explicit Purchase Order state machine for Hector Purchasing.

Authority: `docs/purchasing-architecture.md`. PO core: `docs/purchase-orders.md`. Costs: `docs/purchase-costs.md`.

---

## Core questions

Hector must always answer:

```text
What stage is this Purchase Order currently in?
What transitions are legally possible from here?
Who moved it to this stage? When? Why?
What became immutable because of that transition?
```

---

## Status definitions

| Status | Meaning |
|---|---|
| `DRAFT` | Being prepared. Commercial fields editable. **Not** supplier debt, stock, or committed capital. |
| `APPROVED` | **Internal approval** of commercial terms. Supplier has **not** necessarily been ordered. |
| `ORDERED` | **Supplier commitment** — order placed with the supplier. Critical commercial boundary. |
| `PARTIALLY_RECEIVED` | Some ordered quantity physically received. **Phase 3 Goods Receipt only.** |
| `RECEIVED` | All expected receivable quantity received. **Phase 3 Goods Receipt only.** |
| `CANCELLED` | Intentionally terminated. Terminal. History retained. |

### Critical separations

```text
APPROVED  = internal approval
ORDERED   = supplier order commitment

PurchaseOrder.status = ORDERED  ≠  stock increased
PARTIALLY_RECEIVED / RECEIVED   require GoodsReceipt evidence (Phase 3)

CANCELLED ≠ short-close ≠ correction ≠ purchase return
```

See `docs/purchase-returns-corrections.md` for correction / discrepancy / short-close / return boundaries.

```text
CANCELLED  ≠  delete PO / erase costs / erase FX terms
```

---

## State machine

```text
                     ┌─────────────┐
                     │    DRAFT    │
                     └──────┬──────┘
                            │ approve
                            ▼
                     ┌─────────────┐
                     │  APPROVED   │
                     └──────┬──────┘
                            │ order
                            ▼
                     ┌─────────────┐
                     │   ORDERED   │
                     └──────┬──────┘
                            │
                    future Goods Receipt
                            │
                 ┌──────────┴──────────┐
                 ▼                     ▼
       PARTIALLY_RECEIVED           RECEIVED
                 │                     ▲
                 └─────────────────────┘
```

Cancellation (public):

```text
DRAFT → CANCELLED
APPROVED → CANCELLED   (reason required)
ORDERED → CANCELLED    (reason required; no receipt evidence — always true in 2.9)
```

Public API never enters `PARTIALLY_RECEIVED` / `RECEIVED`. Those statuses are **Warehouse-evidence-backed Purchasing summary states** — see `docs/purchase-receiving-contract.md`.

Forward posting uses reserved transitions in `purchase-order-status.ts`. Receipt **reversal** may system-recalculate backward (`RECEIVED → PARTIALLY_RECEIVED → ORDERED`) via `canApplyReceivingSummaryTransition` — not a public lifecycle command.

---

## Transition matrix

| From | To | Phase 2.9 |
|---|---|---|
| DRAFT | APPROVED | YES — `POST /:id/approve` |
| DRAFT | CANCELLED | YES — `POST /:id/cancel` |
| APPROVED | ORDERED | YES — `POST /:id/order` (alias `/mark-ordered`) |
| APPROVED | CANCELLED | YES — reason required |
| ORDERED | PARTIALLY_RECEIVED | RESERVED Phase 3 |
| ORDERED | RECEIVED | RESERVED Phase 3 |
| ORDERED | CANCELLED | CONDITIONAL (no Goods Receipt; always OK until Phase 3; forbidden once posted receipts exist) |
| PARTIALLY_RECEIVED | RECEIVED | RESERVED Phase 3 |
| PARTIALLY_RECEIVED | CANCELLED | NO |
| RECEIVED | anything | NO |
| CANCELLED | anything | NO |

Invalid skips (`DRAFT → ORDERED`, `APPROVED → RECEIVED`, `CANCELLED → DRAFT`, …) → `409 PURCHASE_ORDER_INVALID_STATUS_TRANSITION`.

No generic `PATCH { status }` and no `POST /:id/status`.

---

## Dates: `orderDate` vs `orderedAt`

| Field | Meaning |
|---|---|
| `orderDate` | Business calendar date of the supplier order. Basis for `NET_DAYS` + `ORDER_DATE` due dates (Phase 2.7). Editable in DRAFT; may be set on `order` command. |
| `orderedAt` | Server timestamp when status became `ORDERED`. Never client-authored. |
| `approvedAt` | Server timestamp of internal approval. |

Draft/Approved due-date previews use current `orderDate`. Confirming ORDERED must not silently rewrite a previously frozen due date unless `orderDate` is explicitly updated in the same `order` command (recomputes terms).

---

## Approval validation

Before `DRAFT → APPROVED`, server revalidates:

- supplier assignable (not archived)
- ≥ 1 item; quantities / prices valid
- purchase type + CASH / TERM_CREDIT / FX_CREDIT semantics complete
- credit terms / FX obligation / reference rate as required
- no contradictory fields

Do not trust earlier draft-only validation.

---

## Immutability

| Status | Commercial fields | Notes / expectedAt | Purchase Costs |
|---|---|---|---|
| DRAFT | editable | editable | append / draft-edit |
| APPROVED | locked | editable | append / void (2.8) |
| ORDERED | locked (+ snapshots frozen) | editable | append / void (2.8) |
| PARTIALLY_RECEIVED | locked | locked | append/void allowed for late costs |
| RECEIVED | locked | locked | no further cost mutations |
| CANCELLED | locked | locked | no further cost mutations; existing costs kept |

---

## Cancellation rules

- Reason **required** for `APPROVED` / `ORDERED` (`400 PURCHASE_ORDER_CANCELLATION_REASON_REQUIRED`).
- Reason optional for `DRAFT`.
- Store `cancelledAt`, `cancelledBy`, `cancellationReason`. Do **not** clear prior `approvedAt` / `orderedAt`.
- Do not delete items, terms, FX data, costs, audit, or events.
- Do not mutate Supplier Offer.
- Phase 3: if any Goods Receipt exists → forbid normal `ORDERED → CANCELLED`; use short-close / return flows instead.
- No Reopen in 2.9.

---

## Metadata & history

Persisted on PO: `status`, `approvedAt/By`, `orderedAt/By`, `cancelledAt/By`, `cancellationReason`, optional `supplierOrderReference`.

Lifecycle history = **Audit** (no duplicate timeline table). Domain events notify consumers:

| Event | When |
|---|---|
| `purchasing.purchase_order.approved` | DRAFT → APPROVED |
| `purchasing.purchase_order.ordered` | APPROVED → ORDERED |
| `purchasing.purchase_order.cancelled` | → CANCELLED |

No fake `PurchaseOrderReceived` without Warehouse evidence.

Idempotency: retry of already-transitioned command → `409` (row lock + transition guard). Concurrent approve/order/cancel serialize via `FOR UPDATE` + `version`.

---

## RBAC

Existing keys (not `purchasing.po.*` — keep Hector permission catalog):

| Action | Permission |
|---|---|
| approve | `purchasing.approve` |
| order | `purchasing.manage` |
| cancel | `purchasing.cancel` |
| create draft | `purchasing.create` |
| read / list | `purchasing.read` |

Maker ≠ approver is **not** forced in 2.9. Actor and system timestamps are always server-derived.

API responses include server-derived `availableActions` (`EDIT` / `APPROVE` / `ORDER` / `CANCEL` / `ADD_COST`) for the current actor — UI still must not be trusted alone.

---

## Warehouse boundary

`PARTIALLY_RECEIVED` / `RECEIVED` exist in the enum and reserved transition helper so Phase 3 can drive:

```text
record GoodsReceipt
→ compare received vs expected
→ ORDERED → PARTIALLY_RECEIVED | RECEIVED
```

Public Purchasing must **not** expose “Mark Received”. Status alone is never stock truth. `GoodsReceipt` / `GoodsReceiptItem` will be authoritative.

---

## Finance boundary

`ORDERED` may later inform committed purchasing / payable planning. Lifecycle transitions create **no** payments, payables, ledger, bank/cash, or FX settlement entries.

---

## Legacy migration

Hector never shipped `SUBMITTED` / `CONFIRMED` / `PurchaseOrderConfirmed` / `confirmedAt` / `confirmedBy`.

Phase 2.4 already used:

```text
DRAFT → APPROVED → ORDERED (+ CANCELLED)
```

Phase 2.9 mapping (identity + receive enums):

```text
OLD              NEW
DRAFT            DRAFT
APPROVED         APPROVED
ORDERED          ORDERED
CANCELLED        CANCELLED
(n/a)            PARTIALLY_RECEIVED   ← new enum value only
(n/a)            RECEIVED             ← new enum value only
```

Migration: `20261003210000_purchase_lifecycle_receiving_states` adds enum values + optional `supplier_order_reference`. No row remapping required.

Product-language aliases in older docs (“approve ≈ submit”, “mark-ordered ≈ confirm”) remain informal wording only — statuses stay APPROVED / ORDERED.

---

## Source-of-truth matrix

| Fact | Authority |
|---|---|
| Current purchasing lifecycle | `PurchaseOrder.status` |
| Internal approval | approve transition + `approvedAt/By` |
| Supplier order commitment | order transition + `orderedAt/By` |
| Cancellation | cancel transition + cancel metadata |
| Physical goods receipt | Future `GoodsReceipt` |
| Received quantity | Future `GoodsReceiptItem` |
| Stock | Future Warehouse |
| Supplier payment / remaining payable | Future Finance |
| Purchase costs | `PurchaseOrderCost` |
| Commercial item terms | PO + items |
| Lifecycle history | Audit |
| Lifecycle notifications | Domain Events |

---

## Indexing

`(companyId, status)` exists for operational filters (APPROVED awaiting order, ORDERED awaiting warehouse, etc.). Combine with `supplierId`, `purchaseType`, due-date filters as needed.

---

## Future Phase 3 contract (not implemented)

```text
ORDERED + 0 < received < expected  → PARTIALLY_RECEIVED
ORDERED / PARTIAL + received >= expected → RECEIVED
```

Short-close, over-receipt policy, and returns are separate workflows — never `RECEIVED → CANCELLED`.
