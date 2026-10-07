# HECTOR — Phase 5.2
## Sales Orders + Wholesale + Lifecycle + Cancellation / Returns Report

**PHASE 5.2 STATUS: COMPLETE**  
**SALES ORDER CORE: READY** · **WHOLESALE SALES FOUNDATION: READY** · **ORDER LIFECYCLE: READY**  
**CANCELLATION: READY** · **SALES RETURNS FOUNDATION: READY**  
**READY FOR PHASE 5.3**

---

### 1. Baseline

Phase 5.1 (Channels + Customer Master) complete. Phase 5.2 adds commercial Sales Orders, wholesale pricing/terms, lifecycle confirm/cancel, and commercial returns — without reservation, fulfillment, FIFO, receivables, or refunds.

### 2. Schema Changes

Migration `20261011190000_sales_orders_returns`:

- Enums: `SalesOrderStatus`, `SalesOrderPaymentTermType`, `SalesOrderSource`, `SalesOrderCancelReason`, `SalesReturnStatus`, `SalesReturnReason`, `SalesReturnCondition`
- Tables: `sales_order_sequences`, `sales_orders`, `sales_order_items`, `sales_return_sequences`, `sales_returns`, `sales_return_items`
- Partial unique: `(company_id, channel_id, external_order_id)` WHERE `external_order_id IS NOT NULL`

### 3. SalesOrder Model

Company-scoped commercial header: `orderNumber`, `channelId`, optional `customerId`, `status`, `currency`, payment terms + `dueDate` / `expectedUpfrontAmount`, source/external ids, customer/address snapshots, server-computed money totals, lifecycle timestamps, `requestId`, `createdById`.

### 4. SalesOrderItem Model

`skuId`, immutable ordered `quantity`, `unitPrice` / discounts / line totals (server), `cancelledQuantity`, `returnedQuantity` (commercial trackers), optional SKU/product snapshots.

### 5. Commercial Amount Model

```text
lineSubtotal = qty × unitPrice
lineNetTotal = lineSubtotal − lineDiscount
grandTotal   = Σ lineNet − orderDiscount + shipping + otherCharges
```

`Decimal(24,6)`; client totals never trusted.

### 6. Customer / Channel Integration

Every order requires an active Channel. Customer optional by design (wholesale seed uses `CUS-DEMO`). Restrict composite FKs `(id, companyId)`. Historical orders survive channel/customer inactivation.

### 7. Wholesale

Same `SalesOrder` engine on `WHOLESALE` channel — negotiated `unitPrice`, line/order discounts, CREDIT/PARTIAL + due dates. No parallel wholesale module.

### 8. Payment Terms

`CASH` | `CREDIT` | `PARTIAL` are commercial terms only. `expectedUpfrontAmount` ≠ paidAmount. No Sales-owned debt/balance fields.

### 9. Order Lifecycle

Public 5.2: `DRAFT → CONFIRMED | CANCELLED`; `CONFIRMED → CANCELLED` (and transition map for PROCESSING/FULFILLED reserved for 5.3). Asserted via `sales-order-status.ts`.

### 10. Confirmed Order Immutability

Commercial PATCH only while `DRAFT`. Confirm locks facts (`SALES_ORDER_NOT_EDITABLE` 409).

### 11. Cancellation

Full order cancel or partial item cancel. `quantity` never rewritten; `cancelledQuantity` updated. History and money totals preserved.

### 12. SalesReturn

`SalesReturn` + items reference original order items. Numbering `SR-######`. Status: DRAFT / APPROVED / CANCELLED (RECEIVED reserved).

### 13. Return Lifecycle

Create DRAFT → Approve (increments `returnedQuantity`) or Cancel. Approve is commercial intent only.

### 14. Return Quantity Rules

Transitional: `returnable = ordered − cancelled − returned` (− pending DRAFT qty on create). Over-return rejected. Unrelated order-item IDs rejected. 5.3 will use fulfilled − returned.

### 15. Tenant Isolation

All queries scoped by `@CurrentCompany()`. Cross-company IDOR → 404. Body `companyId` rejected.

### 16. RBAC

| Permission | Use |
| --- | --- |
| `sales.orders.read` | List/get |
| `sales.orders.create` | Create DRAFT |
| `sales.orders.manage` | Update DRAFT |
| `sales.orders.confirm` | Confirm |
| `sales.orders.cancel` | Cancel order/item |
| `sales.returns.read` | List/get |
| `sales.returns.create` | Create DRAFT return |
| `sales.returns.manage` | Cancel return |
| `sales.returns.approve` | Approve return |

### 17. Audit

Entity types: `SALES_ORDER`, `SALES_ORDER_ITEM`, `SALES_RETURN`, `SALES_RETURN_ITEM`.  
Actions: CREATED, UPDATED, CONFIRMED, CANCELLED, ITEM_CANCELLED, RETURN_CREATED/APPROVED/CANCELLED.

### 18. Domain Events

- `sales.order.created|updated|confirmed|cancelled|item_cancelled`
- `sales.return.created|approved|cancelled`

Published via `commitThenPublish`.

### 19. Idempotency

Optional `requestId` (UUID) on create order/return — replay returns existing row within company.

### 20. Concurrency

Sequence allocation via upsert + `RETURNING` in transaction. Confirm/cancel/approve run in transactions with transition asserts. Partial unique on external order id.

### 21. API

| Method | Path |
| --- | --- |
| GET/POST | `/api/v1/sales/orders` |
| GET/PATCH | `/api/v1/sales/orders/:id` |
| POST | `/api/v1/sales/orders/:id/confirm` |
| POST | `/api/v1/sales/orders/:id/cancel` |
| POST | `/api/v1/sales/orders/:id/items/:itemId/cancel` |
| GET/POST | `/api/v1/sales/returns` |
| GET | `/api/v1/sales/returns/:id` |
| POST | `/api/v1/sales/returns/:id/approve` |
| POST | `/api/v1/sales/returns/:id/cancel` |

### 22. Database Constraints / Indexes

- Unique `(companyId, orderNumber)` / `(companyId, returnNumber)`
- Composite Restrict FKs to channel/customer/sku/order
- Partial unique external order id
- Indexes on status, channel, customer, dates, requestId
- Check-style service validation for qty/money

### 23. Tests Added

| Suite | File | Cases |
| --- | --- | --- |
| Unit | `sales-order-money.spec.ts` | 8 |
| Unit | `sales-order-status.spec.ts` | 6 |
| Unit | `sales.normalization.spec.ts` | 3 |
| E2E | `sales-orders.e2e-spec.ts` | **11** |
| E2E | `sales-returns.e2e-spec.ts` | **6** |
| E2E (regression) | `sales-channels` + `sales-customers` | 9 + 10 |

Sales-focused unit: **17**. New Phase 5.2 order/return e2e: **17**. Combined sales e2e filter (`orders|returns|channels|customers`): **36**. Full api unit suite: **309**. Security e2e: **32**.

### 24. Security Tests

Covered in sales e2e: IDOR 404, RBAC deny confirm/approve, mass-assignment reject (`companyId`/`grandTotal`/`status`), unauthenticated 401. Full `test:security`: **32 passed**.

### 25. Previous Phase Regression

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS (57 suites / 309 tests) |
| `test:security` | PASS (32) |
| Sales e2e filter | PASS (36) |
| `pnpm finance:integrity` | OK (0 violations) |
| `pnpm db:check:catalog` | OK |
| `pnpm db:check:purchasing` | OK |
| `pnpm db:check:warehouse` | OK |
| `pnpm build` | PASS |

### 26. Clean Bootstrap

COMPLETE — `docker compose down -v` → up → migrate deploy → seed → integrity OK on first seed (payables re-sync after putaway fixtures).

### 27. Known Limitations

- No reservation / fulfillment / FIFO (5.3)
- Returnable uses commercial upper bound, not fulfilled qty
- Approve return does not receive stock or refund
- Confirm does not create receivables / journals / AccountMovement
- PROCESSING/FULFILLED statuses exist in enum but are not driven by 5.2 APIs

### 28. Technical Debt

- Optional unique on `requestId` is soft (findFirst), not DB unique
- Zero-price / gift orders deferred
- UI for orders/returns deferred to 5.4

### 29. Open Issues

None blocking Phase 5.3.

Domain gaps fixed during close-out (typecheck/lint only; no behavior rewrite):
- Typed `lineInputs` in `sales-orders.service.ts`
- Replaced nonexistent `AppError.unauthorized` with `ERROR_CODES.UNAUTHORIZED`
- `prefer-const` on `customerId`
- Seed: re-run supplier payables after putaway so clean bootstrap finance integrity is green on first seed

### 30. Phase 5.2 Completion Gate

```text
Can we create a Sales Order?                              YES
Can an Order contain multiple SKUs?                       YES
Can Order reference Customer?                             YES
Can appropriate orders exist without registered Customer? YES
Can every Order identify its Sales Channel?               YES
Can we record negotiated Wholesale pricing?               YES
Can we record discounts?                                  YES
Can we use CASH terms?                                    YES
Can we use CREDIT terms?                                  YES
Can we use PARTIAL terms?                                 YES
Can we record Due Date?                                   YES
Does Sales know actual payment balance?                   NO
Can we confirm an Order?                                  YES
Can confirmed commercial facts be arbitrarily edited?     NO
Can we partially cancel quantity?                         YES
Can we fully cancel an Order?                             YES
Does cancellation delete the original sale history?       NO
Can we create partial Returns?                            YES
Can one Order have multiple Returns?                      YES
Does Return automatically increase stock?                 NO
Does Return automatically refund cash?                    NO
Does Sales directly modify inventory?                     NO
Does Sales directly modify bank/cash balance?             NO
Does Sales calculate Profit?                              NO
Is Wholesale implemented using the same Sales Order engine? YES
Is Company isolation proven?                              YES
```

**Browser: NOT TESTED**

```text
PHASE 5.2 STATUS: COMPLETE

SALES ORDER CORE: READY
WHOLESALE SALES FOUNDATION: READY
ORDER LIFECYCLE: READY
CANCELLATION: READY
SALES RETURNS FOUNDATION: READY

READY FOR PHASE 5.3
```

**STOP — do not start Phase 5.3 in this change set.**
