# Purchase Returns / Corrections (Phase 2.11)

How Hector represents purchasing mistakes, commercial corrections, supplier shortages, discrepancies, and returns **without destroying historical truth**.

Warehouse (Phase 3) and Finance (Phase 4) are **not** implemented here.

Authority: `docs/purchasing-architecture.md`. Lifecycle: `docs/purchase-lifecycle.md`. Receiving: `docs/purchase-receiving-contract.md`.

---

## Core principle

```text
Never rewrite history to make current numbers look correct.
```

Preserve:

```text
what was originally ordered
what changed / why / who / when
what physically happened (Warehouse later)
what financial consequence may exist (Finance later)
```

---

## Four separate concepts

| Concept | Meaning |
|---|---|
| **Cancellation** | PO terminated; no longer proceeds (Phase 2.9). Does not delete history. |
| **Correction** | Controlled fix to committed commercial truth with before/after. |
| **Quantity discrepancy / short shipment** | Ordered qty ≠ what supplier will fulfill / what Warehouse finds. Ordered qty stays. |
| **Supplier return** | Goods previously received are later sent back. Does not cancel the PO. |

Do **not** collapse these into one generic “adjustment”.

---

## Decision table

| Situation | Correct action |
|---|---|
| Wrong quantity while DRAFT | Edit PO |
| Wrong quantity after APPROVED/ORDERED | Explicit correction |
| System said 1000 but agreement was always 900 | Correction |
| Ordered 1000; supplier only supplies 900 | Short shipment / discrepancy |
| Received 980 of 1000 | Receipt discrepancy (Warehouse Phase 3) |
| Remaining 20 will never arrive | Short-close |
| 20 received damaged | Discrepancy |
| 20 sent back to supplier | Purchase Return |
| Entire order abandoned before receipt | Cancellation |
| Wrong supplier after ORDERED | Prefer cancel + new PO |
| Wrong price entered | Correction |
| Supplier renegotiates payment terms | Commercial-term correction |
| Goods physically returned | Warehouse execution (Phase 3) |
| Supplier refunds money | Finance (Phase 4) |

---

## Source-of-truth matrix

| Fact | Authority |
|---|---|
| Original / current commercial PO | Purchasing |
| Correction history | `PurchaseOrderCorrection` + Audit |
| Ordered quantity | Purchasing (`PurchaseOrderItem.quantity`) |
| Short-closed unfulfilled qty | Purchasing (`closedUnfulfilledQuantity` + discrepancy) |
| Physical received quantity | Warehouse evidence |
| Physical returned quantity | Warehouse execution |
| Return commercial intent | Purchasing (`PurchaseReturn`) |
| Stock / batch / FIFO | Warehouse / costing |
| Supplier refund / credit / payable | Finance |
| FX obligation commercial principal | Purchasing (+ Finance settlement later) |

---

## Cancellation

Uses existing Phase 2.9 workflow. Meaning: PO will no longer proceed normally.

Does **not** mean delete PO/items/costs/FX terms/audit.

Eligibility (aligned with 2.9/2.10):

```text
DRAFT / APPROVED → may cancel
ORDERED → may cancel only while no finalized receipt evidence (Phase 3 tightens)
PARTIALLY_RECEIVED / RECEIVED → normal cancellation forbidden
```

Cancellation ≠ short-close ≠ return ≠ correction.

---

## Corrections

### When

- **DRAFT:** normal edit (no correction aggregate required).
- **APPROVED / ORDERED:** explicit `POST .../corrections` only.
- **PARTIALLY_RECEIVED / RECEIVED:** commercial correction blocked by default (receipt history conflict).
- **CANCELLED:** blocked.

### Supported (Phase 2.11)

| Type | Scope |
|---|---|
| `QUANTITY_CORRECTION` | PO item quantity |
| `PRICE_CORRECTION` | PO item unit price |
| `DATA_ENTRY_ERROR` | quantity and/or unit price |
| `COMMERCIAL_TERM_CORRECTION` | credit terms / FX obligation / reference rate |

### Blocked by design

- Supplier change after ORDERED → cancel + new PO
- Purchase type change after APPROVED
- SKU rewrite after ORDERED (and always after receipt evidence)
- Arbitrary JSON field patch engine

### Invariants

```text
Correction changes recorded commercial truth but never erases history.
Reason required. Actor + timestamp server-controlled.
Correction rows are immutable once APPLIED (fix with another correction).
Requires purchasing.po.correct (not ordinary manage/edit).
Optimistic concurrency via PO version.
```

FX corrections must not convert through “today’s” rate. Credit-term corrections recalculate due dates via Phase 2.7 rules.

---

## Quantity discrepancies

Model: `PurchaseDiscrepancy`

Types: `SHORT_SHIPMENT` | `OVER_SHIPMENT` | `DAMAGED` | `WRONG_ITEM` | `MISSING` | `OTHER`

Source: `BEFORE_RECEIPT` | `AT_RECEIPT` | `AFTER_RECEIPT`

```text
Short shipment does NOT rewrite ordered quantity.
```

Physical AT_RECEIPT / AFTER_RECEIPT evidence is owned by Warehouse; Purchasing may still store a commercial discrepancy note.

---

## Short close

Closes remaining **expected** quantity intentionally.

```text
orderedQuantity = acceptedReceived + closedUnfulfilled + remainingExpected
```

Example:

```text
ordered = 1000
received = 900   (Warehouse later)
shortClosed = 100
remainingExpected = 0
```

Implementation:

- `PurchaseOrderItem.closedUnfulfilledQuantity` (Purchasing projection)
- Discrepancy row `SHORT_SHIPMENT` / `SHORT_CLOSED` for reason/history
- API: `POST .../items/:itemId/short-close`
- Permission: `purchasing.po.short_close`

Eligible statuses today: `ORDERED`, `PARTIALLY_RECEIVED`.

**Does not** invent received quantity. **Does not** cancel the PO.

### Completion semantics

Receiving derivation treats a line complete when:

```text
acceptedReceived + closedUnfulfilled >= ordered
```

Phase 2.11 keeps summary status `RECEIVED` as “receiving process complete” even with short-close. Long-term recommendation: distinguish fulfillment state from lifecycle (future `CLOSED` optional). Documented for Phase 3.

---

## Purchase returns

Models: `PurchaseReturn` + `PurchaseReturnItem`  
Numbering: `PR-YYYY-######` (company sequence)

Lifecycle (Purchasing-side):

```text
DRAFT → APPROVED
DRAFT / APPROVED → CANCELLED
```

```text
APPROVED Purchase Return
≠ stock decreased
≠ supplier received goods
≠ supplier refunded money
≠ payable decreased
```

Critical invariants:

```text
Purchase Return does NOT cancel the original PO.
Approved Purchase Return does NOT change stock by itself.
Warehouse **SupplierReturnExecution** DISPATCHED posts `RETURN_OUT` (Phase 3.14).
Supplier refund is NOT Purchase Return execution.
Physical return requires Warehouse evidence (`SupplierReturnExecution` + ledger).
Financial resolution requires Finance evidence.
```

One PO → many returns. One return → many items. Prefer `purchaseOrderItemId` + Catalog `skuId`.

Future extensions (not built):

- `goodsReceiptItemId` on return item
- ~~ReturnShipment~~ → use `SupplierReturnExecution` (Phase 3.14; multiple executions per return)
- batch on Warehouse shipment
- stock availability validation

---

## Correction policy matrix

| Field | DRAFT | APPROVED | ORDERED (no receipt) | Receipt exists |
|---|---|---|---|---|
| Notes | Edit | Edit | Edit | Edit |
| Quantity | Edit | Correction | Correction | Restricted |
| Unit price | Edit | Correction | Correction | Restricted |
| Supplier | Edit | Restricted | Prefer cancel/new | No |
| SKU | Edit | Restricted | Data-error only (blocked) | No |
| Purchase type | Edit | Restricted | No | No |
| FX obligation | Edit | Correction | Correction | Finance-sensitive |
| Credit terms | Edit | Correction | Correction | Finance-sensitive |

---

## Module APIs

```text
POST /purchasing/purchase-orders/:id/corrections
GET  /purchasing/purchase-orders/:id/corrections

POST /purchasing/purchase-orders/:id/discrepancies
GET  /purchasing/purchase-orders/:id/discrepancies

POST /purchasing/purchase-orders/:id/items/:itemId/short-close

POST /purchasing/purchase-returns
GET  /purchasing/purchase-returns
GET  /purchasing/purchase-returns/:id
PATCH /purchasing/purchase-returns/:id
POST /purchasing/purchase-returns/:id/approve
POST /purchasing/purchase-returns/:id/cancel
```

---

## RBAC

| Permission | Capability |
|---|---|
| `purchasing.po.correct` | Apply committed corrections |
| `purchasing.po.short_close` | Short-close remaining qty |
| `purchasing.discrepancy.manage` | Record discrepancies |
| `purchasing.return.create` | Create/update DRAFT returns |
| `purchasing.return.approve` | Approve return intent |
| `purchasing.return.cancel` | Cancel return plans |
| `purchasing.read` | List/read |

---

## Domain events

```text
purchasing.purchase_order.corrected
purchasing.purchase_discrepancy.recorded
purchasing.purchase_order.short_closed
purchasing.purchase_return.created
purchasing.purchase_return.approved
purchasing.purchase_return.cancelled
```

No Warehouse (`GoodsReturned…`) or Finance (`SupplierRefund…`) events without evidence.

---

## Concurrency

- Corrections require PO `version`.
- Return approve/cancel use return `version` when supplied.
- Future Phase 3: short-close vs receipt post must be transactional.
- Approved return does not reserve stock; Warehouse validates availability at execution.

---

## Warehouse boundary (Phase 3)

- Attach receipt discrepancies to PO items without rewriting PO.
- Execute approved Purchase Return → ReturnShipment / Inventory OUT.
- Link physical returned units to `PurchaseReturnItem`.
- Support multiple return shipments + batch.
- Prevent returning more than physically eligible stock.
- Receipt evidence restricts cancel/corrections.

## Finance boundary (Phase 4)

- Consume corrected commercial truth safely.
- Process refunds / credits / payable adjustments separately from Purchasing return intent.

---

## Persian labels

| EN | FA |
|---|---|
| Purchase Return | برگشت به تأمین‌کننده |
| Correction | اصلاح خرید |
| Discrepancy | مغایرت خرید |
| Short Shipment | کسری تأمین |
| Over Shipment | اضافه تحویل |
| Damaged | آسیب‌دیده |
| Wrong Item | کالای اشتباه |
| Short Close | بستن کسری |
