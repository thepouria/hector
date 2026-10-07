# HECTOR — Phase 5.3
## Inventory Execution + Reservation + Fulfillment + FIFO + Finance Integration Report

**PHASE 5.3 STATUS: COMPLETE**  
**SALES RESERVATION: READY** · **SALES FULFILLMENT: READY** · **WAREHOUSE OUTBOUND INTEGRATION: READY**  
**FIFO INTEGRATION: READY** · **CUSTOMER RETURN EXECUTION: READY** · **SALES ↔ FINANCE INTEGRATION: READY**  
**READY FOR PHASE 5.4**

**STOP — do not start Phase 5.4 in this change set.**

---

### 1. Baseline

Phase 5.2 commercial Sales Orders / Returns closed. Pre-5.3 gates: unit **309**, security **32**, finance/warehouse integrity OK. Phase 5.3 adds reservation orchestration, `SalesFulfillment` ISSUE+FIFO, physical return receive, and fulfillment-scoped AR recognition.

### 2. Existing Infrastructure Reused

| Domain | Reused |
| --- | --- |
| Warehouse | `InventoryReservation` (+ `createInTx`/`releaseInTx`/`consumeInTx`), availability locks, `InventoryLedgerService.postMovementsInTx`, FIFO `InventoryCostLayersService`, `SALES_FULFILLMENT` / `CUSTOMER_RETURN` source types |
| Finance | `JournalPostingService.postInTx`, CoA seed, source/effect uniqueness |
| Sales 5.2 | Orders/items/returns, lifecycle asserts, money helpers, numbering |

### 3. Sales → Warehouse Contract

Sales owns ordered/cancelled/fulfilled commercial qty and lifecycle. Warehouse owns On Hand / Reserved / Available, movements, FIFO. Sales never `UPDATE` balances; every physical change goes through Warehouse services.

### 4. Reservation Model

Warehouse `InventoryReservation` with `sourceType=SALES_ORDER`, `sourceId=orderId`, `sourceLineId=orderItemId`. Orchestrated by `SalesReservationsService`.

### 5. Reservation / Available Stock Semantics

```text
Available = SELLABLE On Hand − ACTIVE remainingQuantity
Reserve ⇒ Available ↓, On Hand unchanged, no InventoryMovement
```

Partial reservation supported. Confirm best-effort reserves after commercial confirm.

### 6. Allocation

Commercial reservation grain: company + warehouse + SKU. Physical pick/allocation (location + batch + SELLABLE) is owned by fulfillment lines / Warehouse — not Sales commercial master.

### 7. Stock Classification Rules

Normal sales reserve/fulfill **SELLABLE only**. TESTER / DAMAGED / QUARANTINE excluded from availability and fulfillment create.

### 8. Cancellation / Reservation Release

Full/partial cancel releases ACTIVE reservation remaining (same TX as cancel). Ordered qty never rewritten.

### 9. Fulfillment Model

`SalesFulfillment` / `SalesFulfillmentItem` (`FUL-######`). Status: `DRAFT → COMPLETED | CANCELLED` (cancel DRAFT only).

### 10. Partial / Multiple Fulfillment

Multiple COMPLETED fulfillments per order/item. `fulfillable = ordered − cancelled − fulfilled`.

### 11. Warehouse ISSUE Integration

Complete posts `ISSUE` via ledger `sourceType=SALES_FULFILLMENT`, `sourceId=fulfillmentId`, `sourceLineId=fulfillmentItemId`.

### 12. FIFO Consumption

Canonical Warehouse FIFO engine consumes layers on ISSUE. Prefer physical movement `batchId` layers first (then FIFO) so balance↔layer recon stays consistent.

### 13. FIFO Traceability

`InventoryLayerConsumption` ↔ `InventoryMovement` ↔ Sales fulfillment source ids. No Sales profit calculation.

### 14. Customer Return Execution

`APPROVED → RECEIVED` via `POST /sales/returns/:id/receive` posts `RETURN_IN` (`CUSTOMER_RETURN`). Approved alone does not mutate stock.

### 15. Return Classification

Receive requires explicit classification (`SELLABLE` / `DAMAGED` / `QUARANTINE`; commercial `UNKNOWN` maps to `QUARANTINE`).

### 16. Finance Recognition Policy

**Boundary = Fulfillment COMPLETE** (not DRAFT, not CONFIRM). Journal: DR AR · CR `REVENUE_FOUNDATION`. See `docs/sales-recognition.md`.

### 17. CASH Sales

CASH still creates `CustomerReceivable` at fulfillment — does **not** invent bank/cash movement. Actual receipt is Finance.

### 18. CREDIT Sales

Creates customer AR with order due date when present. Debt truth is Finance, not Customer Master.

### 19. PARTIAL Sales

Commercial `expectedUpfrontAmount` remains Sales agreement. AR recognition is still fulfillment-scoped net commercial; actual receipts/settlement are Finance (later).

### 20. Marketplace Receivables

`SalesChannelType.MARKETPLACE` → `CHANNEL_RECEIVABLE` counterparty (clearing foundation). No bank increase. Settlement = Phase 6.

### 21. Return Financial Effects

Physical receive creates credit `CustomerReceivable` (negative amount, `CREDITED`) + `SALES_AR_CREDIT` journal. No automatic cash refund.

### 22. Discount / Partial Recognition Allocation

Pro-rata line nets by fulfilled/ordered; order discount largest-remainder; shipping + otherCharges on **first** completed fulfillment only. Sum-preserving.

### 23. Idempotency

Fulfillment create by `requestId`; complete is status-idempotent; movement unique `(sourceType, sourceLineId, movementType)`; receivable unique on fulfillment/return; journals unique on source effect.

### 24. Concurrency

Availability locks + reservation FOR UPDATE; order lock on fulfill/cancel; concurrent reserve cannot oversubscribe; concurrent complete cannot over-fulfill (item qty checks + TX).

### 25. Transaction Boundaries

Fulfillment complete and return receive run in a single DB `$transaction`: Sales qty/status + Warehouse movements/FIFO/reservations + Finance AR/journal + audit; then `commitThenPublish`.

### 26. Tenant Isolation / RBAC

All lookups company-scoped. Permissions: `sales.orders.reserve`, `sales.fulfillments.*`, `sales.returns.receive`, `finance.receivables.read`.

### 27. Audit / Events

Material actions for reserve/release, fulfillment create/complete/cancel, return receive, receivable recognized/credited. Warehouse/Finance keep their own canonical events.

### 28. Integrity / Reconciliation

Warehouse / inventory / valuation / finance integrity scripts must pass after clean bootstrap. Sales qty: `ordered = cancelled + fulfilled + remaining`.

### 29. Performance Sanity

Reservation/fulfillment paths use scoped locks and bulk availability; no N+1 list of reservations per order in happy path. Not a production benchmark.

### 30. Tests Added

| Suite | Count |
| --- | --- |
| Unit total | **314** |
| Sales e2e (`sales-*`) | **43** (execution 7 incl. concurrent reserve) |
| Security e2e | **32** |
| Unit helpers | quantities / recognition allocation / status |

`sales-execution.e2e-spec.ts`: confirm reserve, atomic fulfill+ISSUE+AR, idempotent create/complete, marketplace CHANNEL AR, cancel releases, return receive, concurrent reserve cap, receivables list.

### 31. Security Tests

IDOR / RBAC / mass-assignment covered in sales e2e + full `test:security` (32).

### 32. Previous Phase Regression

Catalog / Purchasing / Warehouse / Finance / Sales 5.1–5.2 suites remain green under unit + filtered e2e.

### 33. Clean Bootstrap

`docker compose down -v` → up → migrate deploy → seed ×2 → integrity OK expected.

### 34. Known Limitations

- No AR cash settlement / receipt allocation UI
- No marketplace settlement (Phase 6)
- No COGS / profit (Phase 7)
- PROCESSING/PARTIALLY_FULFILLED driven by reserve/fulfill — no fake fulfillment
- RETURN_IN layers remain UNVALUED (profit engine later)

### 35. Technical Debt

- Soft requestId uniqueness on some Sales creates (fulfillment hardened)
- Prefer-batch FIFO is provenance alignment, not a new batch-scoped FIFO pool
- UI deferred to 5.4

### 36. Open Issues

None blocking Phase 5.4.

### 37. Phase 5.3 Completion Gate

```text
Can confirmed Sales Orders reserve stock?                         YES
Does reservation reduce On Hand?                                  NO
Does reservation reduce Available?                                YES
Can normal Sales reserve TESTER stock?                            NO
Can normal Sales reserve DAMAGED stock?                           NO
Can concurrent orders oversubscribe stock?                        NO
Can reservation be released on cancellation?                      YES
Can one Order be partially fulfilled?                             YES
Can one Order have multiple fulfillments?                         YES
Does fulfillment create Warehouse ISSUE?                          YES
Does Sales directly edit Stock Balance?                           NO
Does outbound consume FIFO?                                       YES
Can we trace fulfillment to FIFO layers?                          YES
Can fulfilled quantity exceed eligible quantity?                  NO
Can fulfillment be safely retried?                                YES
Can approved Returns exist before physical receipt?               YES
Does approved Return immediately increase stock?                  NO
Does physical return create RETURN_IN?                            YES
Can returned goods become SELLABLE / DAMAGED / QUARANTINE?        YES
Can returned quantity exceed fulfilled quantity?                  NO
Can wholesale CREDIT sale create Finance receivable at recognition? YES
Does Customer Master store authoritative debt?                    NO
Does CASH order automatically mean cash was actually received?    NO
Does marketplace sale automatically increase Bank?                NO
Can marketplace sale create channel receivable/clearing foundation? YES
Is marketplace settlement implemented?                            NO
Can financial posting be duplicated by retrying fulfillment?      NO
Can Sales calculate authoritative profit?                         NO
Do Warehouse integrity checks still pass?                         YES
Do Finance integrity checks still pass?                           YES
Is Company isolation proven across Sales + Warehouse + Finance?   YES
```

```text
PHASE 5.3 STATUS: COMPLETE

SALES RESERVATION: READY
SALES FULFILLMENT: READY
WAREHOUSE OUTBOUND INTEGRATION: READY
FIFO INTEGRATION: READY
CUSTOMER RETURN EXECUTION: READY
SALES ↔ FINANCE INTEGRATION: READY

READY FOR PHASE 5.4
```
