# Purchase Costs (Phase 2.8)

Purchasing records **additional commercial acquisition costs** tied to a Purchase Order
(courier, freight, purchase fee, etc.).

```text
Merchandise negotiated price  ≠  Purchase Cost
Purchase Cost recorded        ≠  Purchase Cost paid
Purchase Cost                 ≠  Inventory / FIFO / COGS
```

Do **not** rewrite `PurchaseOrderItem.unitPrice` to hide courier/fee amounts.

Authority: `docs/purchasing-architecture.md`. PO lifecycle: `docs/purchase-orders.md`.

---

## Model

`PurchaseOrderCost` (`purchase_order_costs`) — normalized child of `PurchaseOrder`.

| Field | Role |
|---|---|
| `type` | `COURIER \| FREIGHT \| PURCHASE_FEE \| TRANSFER_FEE \| PACKAGING \| CUSTOMS \| OTHER` |
| `status` | `ACTIVE \| VOIDED` |
| `amount` / `currency` | Original commercial amount (Decimal-safe). May differ from PO currency |
| `description` | Optional; **required for OTHER** |
| `costDate` | Business calendar date incurred (UTC noon Timestamptz) |
| `payeeName` | Lightweight counterparty label (not Finance Party) |
| `reference` | Receipt / tracking / invoice ref |
| `notes` | Free text |
| `allocationMethod` | Default `UNALLOCATED` (no allocation performed in 2.8) |
| `supplierId?` | Optional when PO supplier charged the cost |
| void fields | `voidReason`, `voidedById`, `voidedAt` |

No fixed columns on `PurchaseOrder` for courier/freight/fee.

---

## Cost types (Persian UI)

| Type | Label |
|---|---|
| `COURIER` | پیک |
| `FREIGHT` | حمل / باربری |
| `PURCHASE_FEE` | کارمزد خرید |
| `TRANSFER_FEE` | کارمزد انتقال |
| `PACKAGING` | بسته‌بندی خرید |
| `CUSTOMS` | گمرک / ترخیص |
| `OTHER` | سایر (شرح الزامی) |

Inbound/acquisition only — not customer delivery packaging.

---

## Money / currency

- Amounts use Prisma `Decimal(24,6)` and API decimal **strings**.
- IRR is canonical whole **rials**. UI Toman inputs convert ×10 via existing helpers.
- Cost currency may be `IRR` or `USD` independently of PO currency.
- **No automatic FX conversion** using `referenceFxRate`.
- Mixed currencies are aggregated **per currency** only.

Same-currency Purchasing reference (not COGS):

```text
referenceAcquisitionTotal = merchandiseTotal + ACTIVE costs (same currency)
```

If any ACTIVE cost currency differs from merchandise currency → no combined total.

---

## Lifecycle

```text
ACTIVE  →  VOIDED
```

| PO status | Create cost | Edit / hard-delete | Void |
|---|---|---|---|
| `DRAFT` | yes | yes (ACTIVE) | yes |
| `APPROVED` / `ORDERED` | yes (append later discoveries) | **no** silent edit | yes + reason |
| `CANCELLED` | no | no | no |

**Append-oriented history:** after confirm, incorrect amounts are voided and a corrected row is created — not silently rewritten.

Voided rows remain for Audit/history and are excluded from ACTIVE totals.

```text
Purchase Cost recorded ≠ paid
```

No `isPaid` field.

---

## Future allocation (not implemented)

`allocationMethod` may later be `BY_QUANTITY | BY_VALUE | MANUAL`. Phase 2.8 stores `UNALLOCATED`.

Warehouse/FIFO/landed-cost allocation and Profit COGS are out of scope.

---

## API

```text
GET    /purchasing/purchase-orders/:poId/costs
POST   /purchasing/purchase-orders/:poId/costs
PATCH  /purchasing/purchase-orders/:poId/costs/:costId   (DRAFT only)
DELETE /purchasing/purchase-orders/:poId/costs/:costId   (DRAFT only)
POST   /purchasing/purchase-orders/:poId/costs/:costId/void
```

PO detail includes `purchaseCosts`, `purchaseCostTotalsByCurrency`, `referenceAcquisitionTotal`.
PO **list** does not N+1 load costs.

Permissions: `purchasing.read` / `purchasing.manage`.

---

## Audit / Events

| Action | Event |
|---|---|
| `PURCHASE_COST_CREATED` | `purchasing.purchase_cost.added` |
| `PURCHASE_COST_UPDATED` | `purchasing.purchase_cost.updated` |
| `PURCHASE_COST_VOIDED` | `purchasing.purchase_cost.voided` |
| `PURCHASE_COST_REMOVED` | `purchasing.purchase_cost.removed` |

Payload: `companyId`, `purchaseOrderId`, `purchaseCostId`, `type`, `currency`, `amount`, `status` (+ `voidReason` when voided).

`commitThenPublish` transactional guarantees apply.

---

## Source of truth

| Concept | Authority |
|---|---|
| Merchandise negotiated price | PurchaseOrderItem |
| Merchandise total | PurchaseOrder |
| Purchase-related cost | PurchaseOrderCost |
| Cost original amount/currency | PurchaseOrderCost |
| Purchase reference total | Derived Purchasing view |
| Actual cost payment / payable | Future Finance |
| Inventory landed cost / FIFO | Future Warehouse/valuation |
| COGS | Future Profit Engine |

---

## Critical invariants

1. Purchase Cost **must not** rewrite negotiated SKU purchase price.
2. Recorded ≠ paid.
3. `1,000 USD + 2M Toman` is not one monetary total without an explicit valuation basis.
4. Adding costs must not change FX liability, payment terms, or item unit prices.
5. No Finance ledger / Warehouse stock side effects.
