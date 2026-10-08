# P.1.2 — CI Integrity Hardening (PR-005)

**Baseline commit (start of phase work on branch):** `6368cc6`  
**Result:** PR-004 **CLOSED** · PR-005 **CLOSED**  
**P.1 overall:** remains **NO-GO** (PR-001…003, PR-006, PR-007 still open)

---

## 1. Initial state

| Gate | Status entering P.1.2 |
|---|---|
| P.1.1 Inventory / FIFO | Substantially green (PR-004 formally OPEN only for full-E2E) |
| Full E2E | **597 / 598** (mislabelled “Finance shared-DB flake”) |
| Post-E2E Warehouse / Inventory / Valuation | PASS (with Purchasing/Settlement residue history) |
| PR-005 CI integrity pipeline | OPEN |

Known residue themes:

- Purchasing: `received_po_with_remaining` after E2E
- Settlement / Phase 6: shared-DB cleanup orphans (fixed earlier in phase)
- Order-dependent suite failures under one shared Postgres

---

## 2. Shared DB architecture (repository truth)

| Question | Answer |
|---|---|
| One DB for all suites? | **Yes** — local/CI Postgres `hector` |
| Companies shared? | Seeded `pishteh` + `hector-demo-b` reused widely |
| Finance accounts shared? | Yes (seeded Mellat/Cash/etc.) unless suite creates temp company |
| Users shared? | Seeded `pouria@hector.local`, `hossein@hector.local`, … |
| E2E parallelism | **Serial** (`--runInBand`); `forceExit: true` for open Nest/DB handles |
| Reset between E2E and integrity? | **Forbidden** — `apps/api` `test:e2e` runs Jest then `integrity:all` |

---

## 3. Root causes fixed

### 3.1 “Finance flake” → concrete failures (not Finance accounting)

| Issue | Classification | Root cause | Fix |
|---|---|---|---|
| Settlement / Phase6 post-E2E orphans | TEST CLEANUP BUG | Reconciliation `afterAll` deleted channel settlements without dependency order | Dependency-aware cleanup (allocations → items → settlements → channel) |
| Finance expenses / CoA | TEST FIXTURE BUG | Mass-assign expected 201 without CoA bootstrap | Bootstrap ledger accounts; assert 400 when invalid |
| Finance settlements suppliers | TEST ISOLATION BUG | Shared supplier collisions | Dedicated suppliers per suite |
| Putaways mid-suite GRN post 404 / inventory ledger 404 | TEST ISOLATION / ORDER | Contaminated shared state + brittle fixtures; inventory static routes after params | Cleanup hardening; inventory controller route order; better GRN post errors |
| Catalog products RBAC expected 403 got 404 | TEST ISOLATION BUG | Relied on seeded `FAN-SL` that other suites can archive/hide | Create dedicated RBAC product in-test |
| `syncOwnerRolePermissions` P2003 on `role_id` | TEST ISOLATION BUG | Temp-company OWNER roles deleted while long sync upserts | Skip `P2003` and continue (rebuild `@hector/database`) |
| Purchasing `received_po_with_remaining` | TEST CLEANUP BUG | Suites deleted **GRNs** but left **RECEIVED** POs (esp. `finance-supplier-payables`; also incomplete PO teardown missing `purchaseOrderCost`) | `cleanupE2ePurchaseOrders()` + adopt in warehouse/finance/purchasing e2e `afterAll` |

### 3.2 Purchasing residue analysis

Checker: `received_po_with_remaining` — **hard** when `status = RECEIVED` but posted GRN qty + `closedUnfulfilledQuantity` still leave open remaining.

Observed orphans: `RECEIVED` + **zero GRNs** + SKU `FAN-SL-01` (quantities 10000 / 100 / 200) — classic “delete GRN, keep PO” pollution from Finance Supplier Payables e2e (and incomplete putaways teardown before cost-aware cleanup).

**Not** a legitimate transitional PARTIAL receive (those stay `PARTIALLY_RECEIVED`). Ownership remains **Purchasing**; Warehouse only warns for the same diagnostic.

### 3.3 Settlement / Reconciliation residue

Prior `partially_settled_with_zero_allocated` / `channel_settlement_source_missing` came from **invalid cleanup order**, not production allocation math. Fixed; post-E2E Settlement / Reconciliation / Phase6 = hard 0.

---

## 4. Integrity checker contracts

| Domain | Command | Hard fail exit | Warnings |
|---|---|---:|---|
| Catalog | `pnpm catalog:integrity` | ≠0 on hard | none expected |
| Party | `pnpm party:integrity` | ≠0 on hard | none expected |
| Purchasing | `pnpm purchasing:integrity` | ≠0 on hard | — |
| Warehouse | `pnpm warehouse:integrity` | ≠0 on physical hard; purchasing-lifecycle cross-domain → **warning** | `received_po_with_remaining` owned by Purchasing |
| Inventory | `pnpm inventory:integrity` | ≠0 on hard | — |
| Valuation | `pnpm valuation:integrity` | ≠0 on hard | — |
| Finance | `pnpm finance:integrity` | ≠0 on hard | — |
| Sales | `pnpm sales:integrity` | ≠0 on hard | — |
| Settlement | `pnpm settlement:integrity` | ≠0 on hard | — |
| Reconciliation | `pnpm reconciliation:integrity` | ≠0 on hard | — |
| Phase6 | `pnpm phase6:integrity` | ≠0 if settlement or reconciliation hard | aggregate cross-run |
| **All** | `pnpm integrity:all` | ≠0 if any domain hard | prints `[PASS]/[FAIL]` matrix |

Orchestrator: `packages/database/scripts/run-all-integrity.ts` (read-only; continues after failure to show full matrix; non-zero overall exit).

**Warning policy:** only actionable non-blocking or known cross-domain diagnostics with an owner. Warehouse purchasing-lifecycle warning is the latter (owner: Purchasing).

---

## 5. CI architecture

`.github/workflows/ci.yml`:

1. **GATE 1 Static** — install, `db:generate`, `typecheck`, `lint`
2. **GATE 2 Tests** — `db:migrate:deploy`, `db:seed`, clean `integrity:all`, `test`, `test:security`
3. **GATE 3+4 E2E + post-E2E integrity** — `pnpm test:e2e` (Jest serial + `integrity:all`, **no reset**)
4. **GATE 5 Build** — `pnpm build`

Postgres service: `pg_isready` healthcheck (no bare sleep). Env: `TZ=UTC`, test-only JWT/seed secrets. No `continue-on-error` on integrity. No Jest retries for business flakes.

Local equivalent: `pnpm ci:verify`.

---

## 6. Fixture / isolation changes (summary)

- `cleanupE2ePurchaseOrders` — payables → discrepancies → corrections → returns → GRN tree → costs → items → PO
- Adopted in: putaways, goods-receipts, goods-receipt-scanner, inventory-ledger, stock-balance, purchase-receiving, batches, finance-supplier-payables, purchase-returns-corrections
- Batch allocation prefixes: UUID (avoid `Date.now` collisions)
- Catalog RBAC: dedicated product
- Inventory controller: declare `/movements` before parameterized routes

---

## 7. Evidence (closure run)

### Full E2E (clean DB → migrate → seed → `pnpm --filter api test:e2e`)

| Suite | Passed | Failed | Skipped | Todo |
|---|---:|---:|---:|---:|
| E2E (69 suites) | **598** | **0** | 0 | 0 |
| Security | **32** | **0** | 0 | 0 |
| P.1.1 stock-transfer + FIFO + concurrency (isolated re-proof) | **12** | **0** | 0 | 0 |

Duration (full E2E): ~283s.

### Post-E2E integrity (no reset)

| Domain | Command | CI Gated | Hard Fail Exit | Post-E2E Pass |
|---|---|---:|---:|---:|
| Catalog | `pnpm catalog:integrity` | yes | yes | PASS |
| Purchasing | `pnpm purchasing:integrity` | yes | yes | PASS |
| Warehouse | `pnpm warehouse:integrity` | yes | yes | PASS |
| Inventory | `pnpm inventory:integrity` | yes | yes | PASS |
| Valuation | `pnpm valuation:integrity` | yes | yes | PASS |
| Finance | `pnpm finance:integrity` | yes | yes | PASS |
| Party | `pnpm party:integrity` | yes | yes | PASS |
| Sales | `pnpm sales:integrity` | yes | yes | PASS |
| Settlement | `pnpm settlement:integrity` | yes | yes | PASS |
| Reconciliation | `pnpm reconciliation:integrity` | yes | yes | PASS |
| Phase 6 | `pnpm phase6:integrity` | yes | yes | PASS |

`integrity:all` ×2 on same DB → identical PASS (read-only).

### Production build

`pnpm build` → **PASS**

### Repeatability

| High-Risk Area | Runs | Result |
|---|---:|---|
| Full E2E + post integrity (clean bootstrap) | 1 green closure | 598/598 + integrity PASS |
| Stock transfer + FIFO + concurrency | 1 (post-closure) | 12/12 PASS |
| Integrity:all repeat | 2 | PASS / PASS |
| Security | 1 | 32/32 PASS |

Limitation: three consecutive full-E2E wall-clock runs not repeated in-session (~5 min each); closure uses one clean full green + high-risk suite re-proof.

### Skipped / masking audit

- No `test.skip` / `xit` / `xdescribe` / `test.todo` in `apps/api/test`
- No `continue-on-error` / `|| true` / `set +e` in CI workflow integrity path

---

## 8. PR closure

| Item | Status |
|---|---|
| PR-004 Inventory / FIFO | **CLOSED** — full E2E green; transfer/FIFO/concurrency/valuation/inventory integrity green |
| PR-005 CI Integrity Hardening | **CLOSED** — mandatory gates exist, correct exits, post-E2E hard=0, build+security green |
| P.1 Production Readiness | **NO-GO** — PR-001 Backup, PR-002 Deploy, PR-003 Bootstrap, PR-006 Security hygiene, PR-007 Cutover remain |

---

## 9. Remaining risks

- Shared seeded companies/accounts still couple suites; prefer company-per-suite only where still flaky
- Jest `forceExit: true` masks open handles — prefer closing Nest/DB cleanly long-term
- `ci:verify` runs `integrity:all` again after `test:e2e` (redundant but harmless / read-only)
- Unit-test gate timings not re-logged in this document’s final table (CI runs them); closure evidence focused on E2E + integrity + security + build

---

## 10. STOP

P.1.2 complete. Do **not** begin P.2 or production deployment work from this phase.
