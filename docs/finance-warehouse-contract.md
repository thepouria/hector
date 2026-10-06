# Warehouse → Finance Contract (Phase 4.1)

Finance may consume Warehouse facts. Finance never owns physical stock.

Code sketch: `apps/api/src/modules/finance/contracts/warehouse-finance.contract.ts`

---

## What Finance may consume

```text
GoodsReceived (POSTED GRN facts + accepted qty)
SupplierReturnDispatched
Inventory valuation summaries (read)
FIFO layer / consumption provenance (read)
```

---

## What Finance must never mutate

```text
InventoryMovement
StockBalance / InventoryBalance
InventoryCostLayer
InventoryLayerConsumption
Batch physical quantities
Putaway / Transfer / Issue documents
```

---

## Acquisition cost boundary

| Concern | Owner |
|---------|--------|
| Physical stock qty | Warehouse |
| FIFO acquisition layers | Warehouse |
| Known inventory valuation | Warehouse |
| Purchase commercial price / FX reference | Purchasing |
| Financial payable / payment / journal | Finance |
| Capitalize cost into inventory vs expense | Future Finance policy + Warehouse cost sync (not Profit) |
| COGS / Gross Profit | Profit Engine (Phase 7) |

```text
FIFO consumption ≠ automatically COGS
Inventory purchase ≠ automatically Expense
```

Issues for SAMPLE / TESTER / DAMAGE / COMPANY_USE / SUPPLIER_RETURN are not sales COGS.

---

## Physical vs financial

```text
Warehouse: we physically received 100 units
Finance:   we financially owe Supplier amount Y for recognized qty
```

Distinct tables / objects. Linked by IDs (`goodsReceiptId`, `purchaseOrderItemId`, …).

---

## Guards

```text
financeMustNotMutateInventoryMovement = true
financeMustNotMutateStockBalance = true
financeMustNotMutateFifoLayers = true
fifoConsumptionIsNotAutomaticallyCogs = true
```
