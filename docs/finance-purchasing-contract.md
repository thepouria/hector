# Purchasing → Finance Contract (Phase 4.1)

Finance consumes Purchasing; Finance never owns or mutates commercial PO truth.

Code sketch: `apps/api/src/modules/finance/contracts/purchasing-finance.contract.ts`

---

## What Finance may read

```text
Supplier id
PurchaseOrder / Item ids
Purchase type (CASH | TERM_CREDIT | FX_CREDIT)
Currency / unit prices / totals
FX obligation amount + currency
Reference FX rate (+ base/quote currencies, rateAt)
Payment terms / due date / net days
Purchase costs (commercial records)
Purchase Return authorization
```

---

## Recognition rule (locked) — **LIVE in Phase 4.4**

```text
POSTED Goods Receipt accepted quantity
  → Finance payable recognition (incremental, same TX as GRN post)
    SupplierPayableLine + SupplierLiabilityMovement INCREASE
    NO FinancialAccountMovement
DRAFT PO / DRAFT GRN
  → no payable
PO ORDERED alone
  → no payable
```

Partial example:

```text
PO ordered 100
GRN#1 posted 40 → recognize 40
GRN#2 posted 50 → recognize +50 (total 90)
Remaining 10 unordered/unreceived → no liability yet
```

Short-closed unfulfilled qty never becomes payable.

Implementation: `SupplierPayablesService.recognizeFromPostedGoodsReceiptInTx`  
Hook: `GoodsReceiptsService.post()`.

---

## CASH / TERM / FX purchases

| Type | Obligation currency | Notes |
|------|---------------------|-------|
| CASH | PO currency | Obligation + payment may be separate postings |
| TERM_CREDIT | IRR (typical) | Payable + due date until settled |
| FX_CREDIT | Foreign (e.g. USD) | Original liability stays foreign; reference IRR is measurement |

Purchasing already enforces FX original-currency on PO (`docs/fx-purchases.md`). Finance must not freeze liability as IRR.

---

## Purchase costs

Purchasing owns cost rows (delivery, transport, commission, …).  
Finance later posts capitalization vs period expense **explicitly** — not “all costs = Expense”.

---

## Purchase cancellation / returns

Unreceived cancelled PO → no payable if never recognized.  
Purchase Return: Purchasing authorizes; Warehouse dispatches; Finance **reduces payable / records SupplierCredit** on SRE dispatch (Phase 4.4) — cash refund still deferred to 4.6/4.9.

FX returns preserve original currency provenance.

---

## Guards

```text
financeMustNotMutatePurchaseOrder = true
financeMustNotDuplicateSupplierMaster = true
draftPurchaseOrderCreatesPayable = false
```
