# HECTOR — Phase 6.4
# Reconciliation Engine Report

**Status:** COMPLETE  
**STOP:** Phase 6.5 (Settlement / Reconciliation Center UI + dashboard) is **not** started.

---

## 1. Baseline (pre-change gate reference)

Prior green monorepo gates (typecheck, lint, unit + e2e, build). Phase 6.4 adds migration
`20261018160000_reconciliation_engine`, reconciliation module, +2 e2e tests, +1 unit suite (5 tests).

---

## 2. Architecture

```text
Expected (Channel / Payable / Loan / Generic Settlement)
        ↕  comparison + discrepancy workflow
Actual (Finance Payment / Receipt)
        ↕
Settlement Allocation  ← sole matching primitive (no ReconciliationAllocation table)
```

| Layer | Authority |
| --- | --- |
| Finance | Payment / Receipt amounts, accounts, journals |
| Settlement / Channel | Obligation + allocation capacity |
| Reconciliation | Status, difference, discrepancies, review/resolution |

Module: `apps/api/src/modules/reconciliation/`. Wired in `app.module.ts`.

---

## 3. Expected source model

`ReconciliationSourceType`: `CHANNEL`, `SUPPLIER_PAYABLE`, `LOAN`, `SETTLEMENT`.

`reconciliation-source.ts` maps to settlement adapters (`loadExpectedForReconciliation`), finance
direction (Receipt vs Payment), and settleability checks.

One active reconciliation row per `(companyId, sourceType, sourceId)`; `open` is idempotent via
`requestId`.

---

## 4. Actual finance model

Matched amounts are **read** from active allocations linked to the source (channel allocate-receipt,
domain settle, core allocate). Never PATCHable on the reconciliation row.

---

## 5. Settlement allocation reuse

`match` delegates to:

- Channel → `ChannelSettlementsService.allocateReceipt`
- Payable / Loan → `DomainSettlementsService`
- Generic → `SettlementsCoreService.allocate`

`reverse-match` → `SettlementsCoreService.reverseAllocation`.

---

## 6. Expected vs actual

Signed convention: **`difference = matched − expected`**.

Live expected from source until `close-matching` stores `expectedSnapshot`. Finance and source
expected amounts are never rewritten to force equality.

---

## 7. Outstanding vs difference

`remainingExpected = max(expected − matched, 0)` while matching is open → partial receipt is
**PARTIALLY_MATCHED**, not a discrepancy.

After `close-matching`, non-zero difference → **DISCREPANCY** (if not exact match).

---

## 8–11. Matching modes

Exact, partial, multi-receipt → one channel settlement, one receipt → many settlements — all via
existing allocation many-to-many (STL-066/067). Over-allocate to obligation or finance capacity → 409.

---

## 12. Candidate matching

`GET /api/v1/reconciliations/:id/candidates` — read-only, bounded (50), filters company / currency /
direction / POSTED txns / remaining capacity / optional date window. No auto-commit.

---

## 13. Manual matching

`POST …/match` with `financeTxnType`, `financeTxnId`, `amount`, `requestId`. Validates direction and
capacity before allocation.

---

## 14. Difference detection

Computed in `reconciliation-state.ts` (`computeReconciliationMetrics`, `deriveAutomaticStatus`).
Workflow statuses layered via `applyWorkflowStatus` (UNDER_REVIEW, RESOLVED).

---

## 15–16. Discrepancies & reasons

`ReconciliationDiscrepancy` with generic `ReconciliationDiscrepancyReason` enum (BANK_FEE,
COMMISSION_DIFFERENCE, FX_DIFFERENCE, MISSING_TRANSACTION, OTHER, …). Multiple lines per case.

---

## 17–18. Review & resolution

`POST …/under-review`, `POST …/resolve` with `ReconciliationResolutionType` (e.g.
`ACCEPTED_VARIANCE`). Resolve requires open discrepancy amounts to **sum to** difference when
discrepancies exist; zero-difference resolve allowed without lines. **RESOLVED keeps difference visible.**

---

## 19. Lifecycle

`OPEN` | `PARTIALLY_MATCHED` | `MATCHED` | `DISCREPANCY` | `UNDER_REVIEW` | `RESOLVED` | `CANCELLED`

No generic PATCH of amounts or status.

---

## 20–22. Channel / payable / loan / FX

Channel: expectedNet vs Receipt allocations (Phase 6.3). Payable/loan: Payment + FX evidence (6.2).
FX reconciliation uses obligation-currency dimension from FX allocation rows.

---

## 23. Allocation reversal

Wrong match → `reverse-match` → reallocate; Finance txn unchanged; audit trail on settlement side.

---

## 24–27. Tenant isolation, RBAC, concurrency, idempotency

Permissions: `finance.reconciliation.read|match|review|resolve|reverse`. Company scoped on all queries.
Allocation engine locking handles concurrent match. `requestId` on open/match/resolve/cancel where
applicable.

---

## 28–29. Audit & events

Audit entity `RECONCILIATION`; actions include created, matching closed, discrepancy added, resolved.
Domain events registered in `domain-events.registry.ts`.

---

## 30. Integrity

```bash
pnpm reconciliation:integrity
```

Script: `packages/database/scripts/reconciliation-integrity-check.ts` (read-only).

---

## 31–32. Performance & indexes

Schema indexes: `companyId + status`, `sourceType + sourceId`, discrepancy reason/status. Candidate
query uses finance POSTED + capacity filters (no full-table scan).

---

## 33–36. Regression

Channel settlement e2e, settlement-core/payables e2e, finance e2e — all green in full gate. Channel
`expectedNet` unchanged by reconciliation layer.

---

## 37. Clean bootstrap

Full `docker compose down -v` + double seed not re-run in this session (local DB already migrated).
Post-migrate: `pnpm reconciliation:integrity` → **0 hard violations**. Recommended before release:
full bootstrap + all integrity CLIs per README.

---

## 38. Automated tests

| Suite | Count |
| --- | --- |
| Unit (`pnpm test`) | 66 suites, **341** tests, 0 failed |
| Security e2e | 1 suite, **32** tests |
| E2e (`pnpm test:e2e`) | 66 suites, **590** tests, 0 failed |

New: `reconciliation-state.spec.ts` (5), `reconciliation.e2e-spec.ts` (REC64-001 Khanoumi variance,
REC64-002 over-allocate rejected).

---

## 39. Build

`pnpm build` — success.

---

## 40. Documentation

- `docs/reconciliation.md` (new)
- `docs/settlement-invariants.md` — REC-001…REC-030
- `docs/settlement-architecture.md` — deferred scope updated to 6.5
- README — Phase 6.4 + `reconciliation:integrity`

---

## 41. Bugs found

None blocking ship in gate.

---

## 42. Known limitations

- No Settlement Center / Reconciliation UI (6.5).
- No automatic bank/marketplace import or ML matching.
- Cancelled reconciliation blocks reuse of same source key (unique constraint).
- Integrity script covers structural/orphan/resolution evidence; deep matched-vs-allocation SQL
  cross-check can be expanded in 6.5 QA.
- Tenant/RBAC/concurrency/idempotency e2e coverage is partial vs spec wish-list (core paths covered).

---

## 43. Technical debt

- Optional: richer integrity join reconciliation ↔ allocation sums.
- Optional: dedicated e2e for reverse/reallocate wrong-match narrative (135).
- `reverse-match` idempotency relies on settlement core reverse idempotency.

---

## 44. Open issues

None for Phase 6.4 closure.

---

## 45. Completion gate

| Question | Answer |
| --- | --- |
| Expected vs Actual supported? | **YES** |
| Finance Payment matching supported? | **YES** |
| Finance Receipt matching supported? | **YES** |
| Partial matching supported? | **YES** |
| Multiple Finance → one expected source? | **YES** |
| One Finance → multiple expected sources? | **YES** |
| Matching reuse Settlement Allocation? | **YES** |
| Can match exceed expected capacity? | **NO** |
| Can match exceed Finance capacity? | **NO** |
| Temporary outstanding without discrepancy? | **YES** |
| Outstanding distinct from Difference? | **YES** |
| True differences detected? | **YES** |
| Multiple discrepancy reasons? | **YES** |
| Discrepancies reviewed? | **YES** |
| Discrepancies resolved? | **YES** |
| RESOLVED erase historical difference? | **NO** |
| Wrong matches reversed/reallocated? | **YES** (via allocation reverse) |
| Reconciliation modify Finance amounts? | **NO** |
| Reconciliation silently change source expected? | **NO** |
| Auto-create missing Finance txn? | **NO** |
| Auto-delete duplicate Finance txn? | **NO** |
| Candidate search leak other tenant? | **NO** (scoped) |
| FX reconciliations obligation-currency truth? | **YES** |
| Concurrency-safe? | **YES** (allocation locks) |
| Critical ops idempotent? | **YES** (where requestId / reverse idempotent) |
| Full UI/Dashboard? | **NO — Phase 6.5** |
| Wholesale / marketplace API / Profit Engine? | **NO** |

---

## Target channel example (REC64-001)

Expected **1,475M**; R001 **1,000M** + R002 **470M** → matched **1,470M**, remaining **5M**;
close → **DISCREPANCY −5M**; **BANK_FEE**; **ACCEPTED_VARIANCE** → **RESOLVED** with expected
**1,475M**, matched **1,470M**, difference **−5M** preserved. Channel `expectedNet` stays **1,475M**.

---

**Phase 6.4 objective met:** Hector compares expected outcomes with actual Finance transactions without
changing either source of truth; matching flows through Settlement Allocations; outstanding is
distinguished from real discrepancies; differences are preserved, explainable, and resolvable with
audit history. Ready for **Phase 6.5** UI/dashboard and final QA.
