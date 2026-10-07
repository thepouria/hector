# HECTOR — Phase 5.3
## Sales Execution + Fulfillment + Finance AR Report

**PHASE 5.3 STATUS: COMPLETE**  
**RESERVATION: READY** · **FULFILLMENT: READY** · **FIFO ISSUE: READY**  
**CUSTOMER/CHANNEL RECEIVABLE: READY** · **RETURN RECEIVE: READY**  
**STOP — DO NOT START PHASE 5.4**

---

### 1. Baseline

Phase 5.2 commercial Sales Orders + Returns complete. Phase 5.3 adds inventory reservation, physical fulfillment (Warehouse ISSUE + FIFO), fulfillment-scoped revenue recognition, and physical sales-return receive (`RETURN_IN` + AR credit).

### 2. Schema Changes

Migration `20261012100000_sales_execution_finance`:

- Enums: `SalesFulfillmentStatus`, `CustomerReceivableCounterpartyType`, `CustomerReceivableStatus`
- `sales_order_items.fulfilled_quantity`
- `sales_returns` receive fields (`received_at`, `warehouse_id`, `received_by_id`)
- `sales_return_items` receive dimensions (`location_id`, `batch_id`, `classification`)
- Tables: `sales_fulfillment_sequences`, `sales_fulfillments`, `sales_fulfillment_items`,
  `customer_receivable_sequences`, `customer_receivables`, `customer_receivable_lines`
- Nullable uniques on request / fulfillment / return keys (PG multi-NULL OK)

### 3. Quantity model

```text
open        = ordered − cancelled
reservable  = open − fulfilled − reservedRemaining
fulfillable = open − fulfilled
returnable  = fulfilled − returned   (fulfilledReturnableQuantity)
```

Ordered `quantity` is never rewritten.

### 4. Reservation

`SalesReservationsService.reserveOrder(warehouseId?)`:

- Uses `InventoryReservationsService.createInTx` / `releaseInTx`
- Partial reserve when available < needed
- `CONFIRMED → PROCESSING` when any line reserved
- Confirm best-effort calls reserve after TX commit
- Cancel releases all ACTIVE reservations in the same cancel TX

### 5. Fulfillment

`SalesFulfillment` DRAFT → COMPLETED | CANCELLED (DRAFT only).

Complete (single TX):

1. Consume order reservations (then assert unreserved available for remainder)
2. Post Warehouse `ISSUE` via `InventoryLedgerService.postMovementsInTx` (`sourceType=SALES_FULFILLMENT`)
3. Increment `fulfilledQuantity`
4. Derive lifecycle `PROCESSING | PARTIALLY_FULFILLED | FULFILLED`
5. `CustomerReceivablesService.recognizeFromFulfillmentInTx`

Idempotent on `requestId` (create) and COMPLETED status (complete).

### 6. Recognition policy

Documented in `docs/sales-recognition.md`:

- Pro-rata line nets: `(fulfilled/ordered) × lineNet`
- Order discount largest-remainder on the slice
- Shipping + otherCharges on first fulfillment only
- Marketplace → `CHANNEL_RECEIVABLE`; else `CUSTOMER_RECEIVABLE`
- CASH still creates AR (no fake bank)
- Journal: DR AR · CR `REVENUE_FOUNDATION` (`SALES_AR_RECOGNITION`)

### 7. Return receive

`APPROVED → RECEIVED` via `receivePhysical`:

- Posts `RETURN_IN` (`sourceType=CUSTOMER_RETURN`)
- Credits AR (`SALES_AR_CREDIT`, negative receivable amount, status `CREDITED`)

Returnable tightened to `fulfilled − returned`.

### 8. Lifecycle

```text
CONFIRMED → PROCESSING | PARTIALLY_FULFILLED | FULFILLED | CANCELLED
```

### 9. RBAC

| Permission | Use |
| --- | --- |
| `sales.orders.reserve` | Reserve / release |
| `sales.fulfillments.read` | List/get |
| `sales.fulfillments.create` | Create DRAFT |
| `sales.fulfillments.manage` | Cancel DRAFT |
| `sales.fulfillments.complete` | Complete |
| `sales.returns.receive` | Physical receive |
| `finance.receivables.read` | List/get receivables |

### 10. Audit / Events

Entity types: `SALES_FULFILLMENT`, `CUSTOMER_RECEIVABLE` (+ lines).  
Actions: RESERVED, FULFILLMENT_CREATED/COMPLETED/CANCELLED, RECEIVABLE_RECOGNIZED/CREDITED, RETURN_RECEIVED.  
Domain events mirror actions under `sales.*` / `finance.customer_receivable.*`.

### 11. CoA keys

- `CUSTOMER_RECEIVABLE` (1100)
- `CHANNEL_RECEIVABLE` (1110)
- Journal sources: `SALES_FULFILLMENT`, `SALES_RETURN`
- Effects: `SALES_AR_RECOGNITION`, `SALES_AR_CREDIT`

### 12. Module wiring

`SalesModule` imports `WarehouseModule` + `FinanceModule`.  
Finance exports `CustomerReceivablesService` and must **not** import Sales/Warehouse.

### 13. Tests

| Suite | Result |
|-------|--------|
| Unit (`pnpm test`) | **314** passed |
| Sales e2e (`sales-*`) | **42** passed |
| Sales execution e2e | **6** passed |
| Security e2e | **32** passed |
| Integrity (catalog/purchasing/warehouse/inventory/valuation/finance) | OK |
| Typecheck / lint / build / migrate deploy | OK |

Coverage highlights: quantities/recognition/status unit specs; `sales-execution.e2e-spec.ts` (idempotency, ISSUE+FIFO, AR recognition, marketplace channel AR, cancel→release, return receive); existing `sales-*` e2e updated for best-effort reserve (`CONFIRMED`→`PROCESSING`) and fulfilled returnable policy.

### 14. Explicitly NOT in 5.3

- AR cash settlement / receipt allocation
- Marketplace payout reconciliation
- COGS / Profit
- Refunds as money out
- Channel sync / listing

### 15. Status

```text
PHASE 5.3 COMPLETE
READY FOR PHASE 5.4 (settlement / receipts against AR) — not started
```

**STOP — do not start Phase 5.4 in this change set.**
