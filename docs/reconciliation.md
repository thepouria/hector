# Reconciliation Engine (Phase 6.4)

Reconciliation compares **expected** economic outcomes (Settlement / Channel / Payable / Loan sources)
with **actual** Finance truth (Payments / Receipts) **without** mutating either side.

```text
Expected (source domains)     Actual (Finance)
         ↕                           ↕
    Settlement Allocation  ←  matching primitive
         ↕
Reconciliation (comparison, discrepancy, resolution)
```

Finance remains authoritative for money. Settlement remains authoritative for allocations.
Reconciliation owns matching **state interpretation**, **difference**, **discrepancy reasons**,
and **review / resolution** workflow.

---

## Expected vs actual

- **Expected** comes from canonical sources (e.g. Channel Settlement `expectedNet`, supplier payable
  outstanding, loan obligation).
- **Actual matched** is derived only from **active** `SettlementAllocation` rows (never hand-edited).
- **Difference** (signed convention):

```text
difference = actualMatched − expected
```

Example: expected 1,000M, matched 950M → difference **−50M**.

Do not rewrite expected to match receipts or alter Finance amounts to force a match.

---

## Outstanding vs difference

| Concept | Meaning |
|--------|---------|
| **Remaining expected** | Expected minus matched while matching may still continue |
| **Difference / discrepancy** | Assessed after matching is declared complete (`close-matching`) when expected ≠ matched |

Partial receipt before the operator closes matching is **PARTIALLY_MATCHED**, not automatically a discrepancy.

---

## Lifecycle

| Status | Meaning |
|--------|---------|
| OPEN | No meaningful match yet |
| PARTIALLY_MATCHED | Some allocation; expected not fully matched |
| MATCHED | Matched equals expected (before or after close) |
| DISCREPANCY | Matching closed; non-zero difference |
| UNDER_REVIEW | Discrepancy acknowledged for investigation |
| RESOLVED | Explicit resolution with evidence; **difference remains visible** |
| CANCELLED | Reconciliation case invalidated (Finance/Settlement history preserved) |

Workflow statuses (UNDER_REVIEW, RESOLVED) are not arbitrary PATCH targets — they require semantic APIs.

---

## Matching

Manual match **creates Settlement Allocation** via existing services:

- Channel → `ChannelSettlementsService.allocateReceipt`
- Supplier payable / loan → `DomainSettlementsService`
- Generic settlement → `SettlementsCoreService.allocate`

One expected source ↔ many Finance txns and one Finance txn ↔ many sources (STL-066/067) are supported.

Candidates (`GET …/candidates`) are **read-only** suggestions (company, currency, direction, capacity, date window).

---

## Discrepancies

Multiple `ReconciliationDiscrepancy` rows per case. Generic reason codes (e.g. `BANK_FEE`,
`COMMISSION_DIFFERENCE`, `FX_DIFFERENCE`, `MISSING_TRANSACTION`, `OTHER`).

Resolve requires discrepancy line amounts to **sum to** the recorded difference when discrepancies exist.
`ACCEPTED_VARIANCE` preserves the original difference.

---

## FX

Cross-currency matching uses Phase 6.2 FX allocation evidence; reconcile in **obligation currency**, not
by comparing unrelated numeric columns.

---

## API (core)

```text
POST   /api/v1/reconciliations
GET    /api/v1/reconciliations
GET    /api/v1/reconciliations/:id
GET    /api/v1/reconciliations/:id/candidates
POST   /api/v1/reconciliations/:id/match
POST   /api/v1/reconciliations/:id/reverse-match
POST   /api/v1/reconciliations/:id/close-matching
POST   /api/v1/reconciliations/:id/discrepancies
POST   /api/v1/reconciliations/:id/under-review
POST   /api/v1/reconciliations/:id/resolve
POST   /api/v1/reconciliations/:id/cancel
```

RBAC: `finance.reconciliation.read|match|review|resolve|reverse`.

---

## Integrity

```bash
pnpm reconciliation:integrity
pnpm phase6:integrity
```

Read-only. Never auto-repairs.

---

## UI (Phase 6.5)

Reconciliation Center: `/app/settlements/reconciliation` — see `docs/settlement-ui.md`.

---

## Invariants

See `docs/settlement-invariants.md` — **REC-001…REC-030** and **SET-001…SET-025**.
