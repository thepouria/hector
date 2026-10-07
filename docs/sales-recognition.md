# Sales Revenue Recognition (Phase 5.3)

Authoritative policy for Sales → Finance AR recognition on fulfillment complete.

Related: `sales-architecture.md`, `sales-invariants.md`, `finance-architecture.md`.

---

## Timing

```text
SalesFulfillment COMPLETED
  → same TX:
      Warehouse ISSUE (FIFO consume)
      reservation consume
      SalesOrderItem.fulfilledQuantity += qty
      order lifecycle update
      CustomerReceivable + Journal (DR AR · CR REVENUE)
```

Recognition is **fulfillment-scoped**, not confirm-scoped. Confirm / reserve create **no** AR and **no** cash movement.

---

## Allocation formula

For a COMPLETED fulfillment:

```text
lineSlice_i = (fulfilledQty_i / orderedQty_i) × lineNetTotal_i

orderDiscountShare = orderDiscountTotal × (Σ lineSlice / netItemsTotal)
  → distributed across lines by largest-remainder (Hamilton) using lineSlice weights

shipping + otherCharges → recognized on the FIRST completed fulfillment of the order only

recognizedTotal = Σ lineSlice − orderDiscountShare + shipping? + otherCharges?
```

All money math uses `Prisma.Decimal` / Finance money helpers — never JS floating point.

---

## Counterparty / CoA

| Channel type | Counterparty | AR CoA system key |
| --- | --- | --- |
| `MARKETPLACE` | `CHANNEL` | `CHANNEL_RECEIVABLE` |
| Other (WHOLESALE / WEBSITE / MANUAL / …) | `CUSTOMER` | `CUSTOMER_RECEIVABLE` |

Journal:

```text
DR  CUSTOMER_RECEIVABLE | CHANNEL_RECEIVABLE
CR  REVENUE_FOUNDATION
```

### CASH payment terms

CASH still creates AR on fulfillment. Hector does **not** invent a bank deposit.

```text
SALE ≠ PAYMENT
RECEIVABLE ≠ BANK BALANCE
```

Actual cash remains Finance Receipt / AccountMovement (later settlement flows).

---

## Idempotency

- `CustomerReceivable` unique on `(companyId, salesFulfillmentId)`
- Journal provenance: `sourceType=SALES_FULFILLMENT`, `effectType=SALES_AR_RECOGNITION`
- Complete replay returns the same COMPLETED fulfillment + existing receivable

---

## Returns credit

Physical `SalesReturn` RECEIVED (Warehouse `RETURN_IN`) creates a credit receivable:

```text
amount stored negative
status = CREDITED
unique (companyId, salesReturnId)

Journal:
  DR REVENUE_FOUNDATION
  CR CUSTOMER_RECEIVABLE | CHANNEL_RECEIVABLE
  sourceType=SALES_RETURN
  effectType=SALES_AR_CREDIT
```

Credit allocation uses the same pro-rata policy on returned qty / ordered qty × lineNet (no shipping/otherCharges on credit).

---

## Out of scope (STOP — Phase 5.4+)

- Customer receipt allocation / settlement of AR
- Marketplace settlement / payout reconciliation
- COGS / Profit Engine
- Refunds as cash out
