# Purchasing Invariants (Phase 2)

Canonical rules discovered from the Phase 2 implementation.
**Required reading** before Warehouse (Phase 3) or Finance work.

Related docs: `purchasing-architecture.md`, `purchase-lifecycle.md`, `fx-purchases.md`,
`credit-terms.md`, `purchase-receiving-contract.md`, `purchase-returns-corrections.md`,
`purchasing-events.md`, `purchasing-audit.md`.

---

## 1. Supplier

- Supplier is company-scoped. Identity = `(companyId, supplierId)`.
- Company A must never read/update/archive/reference Company B suppliers.
- Contacts and notes inherit company scope through the parent Supplier.
- Archived / inactive suppliers remain readable on historical POs; new assignability follows service rules.
- Seed may create suppliers without operational Audit (not user actions).

---

## 2. Purchase Order

- PO is company-scoped. Stable IDs: `purchaseOrderId`, `purchaseOrderItemId`.
- Supplier + SKU must belong to the same `companyId` as the PO (composite FKs).
- Same SKU appears at most once per PO (`@@unique([purchaseOrderId, skuId])`).
- Ordered commercial quantity lives on `PurchaseOrderItem.quantity`.
- Warehouse must never silently rewrite ordered quantity.
- Optimistic concurrency: `version` increments on every successful mutation.
- Draft may exist with commercial fields incomplete; **APPROVED / ORDERED** require type-complete commercial truth + ≥1 item.

---

## 3. CASH

- Local merchandise obligation = `total` / line currency (typically IRR).
- Must **not** carry FX obligation fields (`obligationAmount`, `obligationCurrency`, `referenceFxRate`).
- Payment term is immediate commercial metadata — not a Finance “paid” flag.

---

## 4. FX_CREDIT

```text
Foreign currency obligation is canonical.
Reference FX rate is historical / reference commercial information.
Purchasing does not perform settlement, FX gain/loss, or mark FX paid.
```

- Example (seed/dev): `1,000 USD` obligation + `2,050,000 IRR/USD` reference ≠ a fixed `2,050,000,000 IRR` payable.
  Spec narrative sometimes uses `205,000` IRR/USD; seed uses `2,050,000` — both are reference-only.
- Reference local value = `obligationAmount × referenceFxRate` (quote IRR) for dashboards only.
- Currencies never summed (`1000 USD + 500 EUR ≠ 1500`).

---

## 5. TERM_CREDIT

- Due date is **contractual commercial metadata**, not proof of payment.
- `NET_DAYS`: server computes `dueDate` from `termBasis` + `netDays` (ORDER_DATE in Phase 2).
- `FIXED_DATE`: explicit agreed calendar day (stored UTC noon Timestamptz).
- Dashboard wording: **سررسید گذشته** — never **پرداخت عقب افتاده**.

---

## 6. Purchase Costs

- PO-level commercial acquisition costs (courier / shipping / fee / other).
- Currency-explicit; never silently mix USD obligation with IRR courier into one total.
- Void / remove where allowed; ACTIVE costs contribute to commercial local value with matching currency.

---

## 7. Lifecycle

Public transitions only:

```text
DRAFT → APPROVED → ORDERED
DRAFT | APPROVED | ORDERED → CANCELLED
```

- `PARTIALLY_RECEIVED` / `RECEIVED` exist for Phase 3 receiving evidence — **no public Purchasing command** may enter them.
- Generic `PATCH` cannot set `status` / `receivedQuantity` / forge actors.
- Concurrent approve/order: exactly one business transition wins via `expectedVersion`.

---

## 8. Corrections

- Committed commercial history is corrected through **explicit correction** actions.
- Corrections are immutable applied records (`beforeSnapshot` / `afterSnapshot`, reason, actor, time, PO version).
- Canonical PO state reflects each accepted correction exactly once (no double count).
- Missing / empty reason is rejected when required.

---

## 9. Discrepancies & short-close

- Discrepancy records commercial mismatch intent; **does not mutate stock**.
- Short-close increments `closedUnfulfilledQuantity` only; never rewrites ordered `quantity`.
- Invariant: `0 ≤ closedUnfulfilledQuantity ≤ quantity`.

---

## 10. Purchase Returns

```text
Purchase Return intent / approval
  ≠ physical warehouse return
  ≠ supplier financial refund
```

- Lifecycle: DRAFT → APPROVED | CANCELLED (per implementation).
- Approved return must not decrease inventory, create stock movement, create supplier refund, or reduce payable.

---

## 11. Receiving (Phase 2 contract)

```text
Purchasing owns ordered commercial quantity.
Warehouse will own physically received quantity.
```

- Contract surface: stable `purchaseOrderId`, `purchaseOrderItemId`, `skuId`, ordered qty, company, supplier, cancellable status.
- Warehouse attaches receipt evidence without rewriting Purchasing master data.
- Over-receipt policy is a **Phase 3 design question** (not decided here).

---

## 12. Finance boundary

```text
Purchasing owns commercial obligation / terms.
Finance will own actual payment / payable / cash / FX settlement.
```

- No AccountsPayable, Payment, CashLedger, BankTransaction, PartnerCapital, FXSettlement from Purchasing.

---

## 13. Audit

- Important mutations write company-scoped Audit with server-derived actor + timestamp.
- Clients cannot edit/delete Audit or forge actor/timestamp.
- Seed intentionally bypasses operational Audit for fixture rows — document, don’t pretend they were user actions.

---

## 14. Domain Events

| Concern | Current truth |
|---|---|
| Durable | **NO** |
| In-process | **YES** |
| Crash-safe after commit | **NO** |
| Transactional Outbox | **NO** |

- Critical for Phase 3: `purchasing.purchase_order.ordered`.
- Failed / duplicate lifecycle commands emit **0** additional success events.
- Envelope: unique `eventId`, type, version, `occurredAt`, `companyId`, aggregate identity, actor, payload — all server-authored.

---

## 15. Integrity gate

Read-only check (never repairs):

```bash
pnpm db:check:purchasing
```

Expect: `Purchasing integrity check: OK (0 known violations)`.
