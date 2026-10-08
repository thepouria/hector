# HECTOR — P.1.1 Inventory / FIFO Integrity Stabilization

**Baseline commit:** `6368cc6` (`feat:finance and other stuff`)  
**Production readiness parent:** `docs/production-readiness-audit.md` (P.1 = **NO-GO**)  
**Blocker addressed:** PR-004 Inventory / Warehouse / FIFO integrity risk

---

## 1. Initial evidence (from P.1)

| State | Result |
|---|---|
| Clean DB (`compose down -v` → migrate → seed) | warehouse / inventory / valuation / finance / settlement / phase6 **OK** |
| Shared DB after full E2E | warehouse / inventory / valuation / settlement / phase6 **FAILED**; examples: `received_po_with_remaining`, orphan TESTER, `QTY_RECON`, `LAYER_EQ`, settlement orphans |
| `stock-transfer.e2e-spec.ts` | conservation **MISMATCH** on dirty shared DB (not on clean isolated run) |

**Conclusion before fixes:** the inventory architecture is not fundamentally broken on clean state. Dirty-DB failures were primarily **E2E pollution** plus secondary test-expectation / purchasing-lifecycle noise.

---

## 2. Inventory truth map (repository)

```text
Business command (GRN post / putaway / transfer / issue / reclass / adjustment / count / return)
      ↓
Domain service (single DB transaction + row locks)
      ↓
InventoryMovement          ← canonical quantity truth (signed quantityDelta)
      ↓
FIFO InventoryCostLayer + InventoryLayerConsumption  ← valuation truth
      ↓
InventoryBalance           ← projection / cache of SUM(movements) per dimension
      ↓
Integrity CLIs (read-only) + optional rebuild-from-ledger (operator-only)
```

### Authoritative objects

| Concern | Source of truth |
|---|---|
| Physical quantity | `InventoryMovement` ledger |
| Classification / location / batch quantity | Same ledger dimensions |
| On-hand projection | `InventoryBalance` (= Σ movements; rebuildable) |
| FIFO remaining / cost basis | `InventoryCostLayer` + consumptions |
| Consumed quantity | `InventoryLayerConsumption` |
| Business identity | Movement `sourceType` / `sourceId` / `sourceLineId` (e.g. transfer id) |

**Zero-balance policy:** retain `onHandQuantity = 0` rows when movement history exists; delete only true orphans (no movements). Integrity and production code agree.

**Events:** inventory services use `commitThenPublish` — events after commit.

---

## 3. Root-cause classification

| ID | Classification | Finding |
|---|---|---|
| RC-1 | **TEST ISOLATION BUG** | E2E `deleteInventoryMovements` deleted movements / consumptions **without reversing FIFO** and without syncing SYS-TRANSIT / destination balances → post-suite `LAYER_EQ`, `QTY_RECON`, orphan TESTER-looking drift |
| RC-2 | **TEST FIXTURE / EXPECTATION BUG** | Stock-transfer validation test required **409** for cross-warehouse location; API correctly returns **400** (validation) |
| RC-3 | **INTEGRITY CHECKER / DOMAIN BOUNDARY** | Warehouse integrity treated purchasing lifecycle `received_po_with_remaining` as **hard fail**; moved to **warning** in warehouse check; remains **hard** in purchasing integrity |
| RC-4 | **PRODUCTION BUG** (batch concurrency) | `createBatchInTx` caught `P2002` then queried in the **aborted** Postgres transaction → `25P02` / 500 under race. Fixed with **SAVEPOINT** so concurrent supplier-batch identity resolves in-tx (GRN path) |
| RC-5 | **TEST INFRA** | Shared single DB, per-suite cleanup; no schema isolation. Cleanup now FIFO-aware + `finalizeInventoryE2eCleanup` (rebuild) **only in test afterAll**, never as silent production repair |
| RC-6 | **OUT OF SCOPE residual** | Settlement / some purchasing E2E flakes after green inventory; track under P.1.2 / domain isolation — not inventory FIFO architecture failure |

**Overall answer to A–G:** primarily **B + C** (fixture cleanup / shared-state), with **G** including a real batch-race production fix (**D**-adjacent) and a checker scope correction (**F**). Not A as a wholesale architecture break.

---

## 4. Code changes

### Production

- `apps/api/src/modules/warehouse/batches.service.ts` — SAVEPOINT around batch create; on `P2002` + supplier batch number, `ROLLBACK TO SAVEPOINT` and reuse existing row.

### Integrity tooling (read-only)

- `packages/database/scripts/warehouse-integrity-check.ts` — `received_po_with_remaining` → warning (warehouse hard = 0 when only that fires).
- `packages/database/scripts/purchasing-integrity-check.ts` — same check remains a **hard** purchasing violation.

### E2E isolation / proofs

- `apps/api/test/helpers/delete-movements.ts` — reverse FIFO consumptions / destination layers before delete; defer balance sync; `finalizeInventoryE2eCleanup` rebuilds company balances after cleanup.
- Inventory-mutating suites call finalize in `afterAll` (ledger, balance, classification, adjustments, putaway, supplier-return, stock-transfer, concurrency, fifo-transfer).
- `apps/api/test/inventory-concurrency.e2e-spec.ts` — concurrent issue, transfer, transfer+issue, reclass.
- `apps/api/test/inventory-fifo-transfer.e2e-spec.ts` — multi-layer FIFO transfer / cost conservation.
- `apps/api/test/helpers/assert-inventory-integrity.ts` + `run-post-e2e-inventory-integrity.cjs`.
- `apps/api/package.json` `test:e2e` → Jest **then** post-e2e warehouse + inventory + valuation integrity (no DB reset).
- Stock-transfer / goods-receipts expectation hardening for validation aliases.

**Forbidden paths not used for green results:** silent read-path auto-repair, weakened integrity assertions, DB reset between E2E and integrity gate, deleting bad rows to hide drift.

---

## 5. Locking / concurrency strategy

- Inventory mutations run inside Prisma `$transaction` with **`SELECT … FOR UPDATE`** on stock positions / PO rows as applicable.
- Scope is dimensional (company + warehouse + location + sku + batch + classification), not a global inventory mutex.
- Concurrent issue / transfer / reclass e2e proves oversubscription is rejected; final quantities never go negative when policy forbids it.
- Batch identity races use savepoints so the outer goods-receipt transaction remains usable.

---

## 6. FIFO / transfer invariants (enforced)

See `docs/warehouse-invariants.md` **WH-INT-*** / **WH-INV-*** (P.1.1 `INV-*` mapped there). Highlights:

- Layer: `originalQuantity = remainingQuantity + Σ(consumptions)` (WH-INT-011).
- Aggregate: valued physical qty reconciles to Σ remaining layers (valuation integrity).
- Internal transfer: company qty and valuation conserved (WH-INT-004/005).
- Balance = ledger projection (WH-INT-002); drift detected read-only (WH-INT-030).

---

## 7. Reproduction notes

1. **Stock-transfer alone on clean DB:** conservation **PASS**; prior “MISMATCH” was dirty shared DB / cleanup residue, not transfer math.
2. **Repetition:** concurrency + fifo-transfer suites run repeatedly in isolation (see final proof section).
3. **Order / binary isolation:** corruption first appeared after inventory suites whose `afterAll` deleted movements without FIFO reverse — fixed at helper root.
4. **Tester orphan:** zero / drifted TESTER balances after incomplete cleanup; policy keep-with-history + FIFO reverse + finalize rebuild in test cleanup.

---

## 8. Final proof (executed)

| Gate | Result | Evidence |
|---|---|---|
| Clean migrate+seed warehouse/inventory/valuation | PASS | after `compose down -v` |
| stock-transfer + concurrency + fifo-transfer | PASS ×3 isolated runs (12 tests) | post-suite inventory integrity OK |
| Concurrent issue / transfer / transfer+issue / reclass | PASS | `inventory-concurrency.e2e-spec.ts` |
| Full E2E Jest | **FAIL 597/598** | unrelated finance flake (different suite each clean run: settlements / expenses) |
| Post-E2E warehouse hard | PASS (1 purchasing-lifecycle warning) | no DB reset |
| Post-E2E inventory | PASS | no DB reset |
| Post-E2E valuation | PASS | no DB reset |
| Purchasing integrity after E2E | FAIL | `received_po_with_remaining` (P.1.2) |
| Settlement / phase6 after E2E | FAIL | settlement fixture pollution (P.1.2) |
| Security e2e | PASS 32/32 | |
| Unit tests | PASS 341/341 | |

No post-E2E balance/FIFO rebuild was used to obtain inventory integrity PASS.

---

## 9. PR-004 decision

**PR-004 = OPEN** — inventory/FIFO production correctness and post-E2E inventory integrity are proven, but §101 still requires a green full E2E run. Remaining blockers are **non-inventory** shared-DB finance flakes + purchasing/settlement integrity residue (track under P.1.2 / CI hardening).

P.1 overall remains **NO-GO**. Do **not** start P.1.2 / P.2 / production deploy from this document alone.
