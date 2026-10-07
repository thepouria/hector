# Settlement Invariants (Phase 6.1 + 6.2 + 6.3)

| ID | Invariant |
| --- | --- |
| STL-001 | Finance owns actual money movement. |
| STL-002 | Settlement owns matching/allocation truth. |
| STL-003 | Settlement never changes Payment amount. |
| STL-004 | Settlement never changes Receipt amount. |
| STL-005 | One Finance transaction may settle multiple obligations. |
| STL-006 | One obligation may be settled by multiple Finance transactions. |
| STL-007 | Total active allocation cannot exceed Finance transaction capacity (shared across SettlementAllocation + SupplierPaymentAllocation + ExpensePaymentAllocation + PurchaseCostPaymentAllocation). Capacity uses payment-currency amounts. |
| STL-008 | Total active allocation cannot exceed obligation remaining capacity (obligation currency). |
| STL-009 | Allocation amount must be positive. |
| STL-010 | Economic allocations are never hard-deleted. |
| STL-011 | Allocation correction occurs through reversal. |
| STL-012 | Allocation reversal does not automatically reverse Finance transaction. |
| STL-013 | Settlement status must agree with allocation truth. |
| STL-014 | SETTLED requires zero remaining amount. |
| STL-015 | PARTIALLY_SETTLED requires positive allocation and positive remaining amount. |
| STL-016 | Settlement links cannot cross Company boundaries. |
| STL-017 | Settlement Party cannot contradict source counterparty. |
| STL-018 | Currency must be explicit. |
| STL-019 | Cross-currency allocation requires explicit FX settlement evidence. |
| STL-020 | Cross-currency settlement is implemented in Phase 6.2 via SettlementAllocationFxDetail (supersedes 6.1 deferral). |
| STL-021 | Money calculations never use floating point. |
| STL-022 | Allocation operations are concurrency-safe. |
| STL-023 | Allocation operations are idempotent where externally retryable. |
| STL-024 | Settlement history must remain reconstructable. |
| STL-025 | Integrity tooling is read-only. |
| STL-026 | Settlement does not calculate profit. |
| STL-027 | Settlement does not own Party identity. |
| STL-028 | Settlement does not own source obligation amount (domain remains authoritative; MANUAL_OBLIGATION is scaffold). |
| STL-029 | Professional Wholesale settlement is not implemented in Phase 6. |
| STL-030 | Future Wholesale settlement must be able to reuse the same Allocation foundation. |
| STL-031 | Supplier Payable settlement uses Finance Payment truth. |
| STL-032 | Loan repayment uses Finance Payment truth. |
| STL-033 | Loan and Capital are economically distinct. |
| STL-034 | Liability is primarily denominated in its obligation currency. |
| STL-035 | Reference IRR valuation does not replace FX obligation currency. |
| STL-036 | USD liability remains USD until settled/corrected. |
| STL-037 | Outstanding balance is expressed primarily in obligation currency. |
| STL-038 | Cross-currency settlement requires explicit FX evidence. |
| STL-039 | Each FX allocation preserves its own historical rate. |
| STL-040 | Purchase reference rate and settlement rate are distinct. |
| STL-041 | Historical FX settlement rate is immutable except through reversal/correction. |
| STL-042 | Cross-currency allocation records both payment and obligation dimensions. |
| STL-043 | FX settlement never silently uses today's rate. |
| STL-044 | Different repayments may use different FX rates. |
| STL-045 | Same FX liability may be settled using mixed payment currencies. |
| STL-046 | Multi-currency balances are not blindly summed. |
| STL-047 | Settlement does not automatically recognize FX profit/loss. |
| STL-048 | Settlement does not create fake expenses for FX differences. |
| STL-049 | Supplier/Loan status must reconcile with outstanding balance. |
| STL-050 | Reversal restores obligation in original obligation currency. |
| STL-051 | Channel Settlement references canonical SalesChannel. |
| STL-052 | Channel Settlement engine is channel-agnostic. |
| STL-053 | External marketplace APIs are not required for settlement truth. |
| STL-054 | Gross Sales and Expected Net are distinct. |
| STL-055 | Commission remains separately traceable. |
| STL-056 | Returns remain separately traceable. |
| STL-057 | Fees remain separately traceable. |
| STL-058 | Adjustments require explicit economic direction. |
| STL-059 | Expected Net is derived from settlement components. |
| STL-060 | Expected Net is never arbitrary client-controlled truth. |
| STL-061 | Finance owns actual Receipt truth. |
| STL-062 | Actual Received is derived from active Receipt allocations. |
| STL-063 | Outstanding equals Expected Net minus valid Receipt allocations. |
| STL-064 | Channel Settlement cannot over-receive under normal allocation. |
| STL-065 | Excess Finance Receipt remains unallocated until explained. |
| STL-066 | One Channel Settlement may have multiple Finance Receipts. |
| STL-067 | One Finance Receipt may allocate to multiple Settlements. |
| STL-068 | Settlement period and Receipt date are distinct. |
| STL-069 | Channel financial Return does not automatically mutate Warehouse stock. |
| STL-070 | Commission/Fee deductions do not create fake cash Payments. |
| STL-071 | Finalized economic components cannot be silently rewritten. |
| STL-072 | Settlement cancellation cannot orphan active Receipt allocations. |
| STL-073 | Channel Settlement links cannot cross tenant boundaries. |
| STL-074 | Channel Settlement does not calculate profit. |
| STL-075 | Professional Wholesale settlement remains out of scope. |
| STL-076 | Future marketplace integrations must populate the same canonical settlement model. |
| STL-077 | Marketplace-specific APIs must not become settlement source-of-truth. |
| STL-078 | Historical manual settlement evidence remains auditable. |

## Operational notes

- **DRAFT allocations:** Capacity is consumed only by ACTIVE rows after OPEN.
- **One Payment/Receipt across multiple Settlements:** Allowed; global capacity still applies (STL-007).
- **Cancel:** Requires zero ACTIVE allocations (reverse first).
- **Polymorphic sources:** Application adapter validation; integrity checks cover source presence and unsupported ACTIVE allocations.
- **FX rate direction:** Always `1 rateBaseCurrency = rate × rateQuoteCurrency`.
- **Same-currency:** No FX detail row; payment amount must equal obligation amount.
- **Loan settle via core:** Does not create cash `LoanRepayment`; outstanding includes ACTIVE core allocations.
- **Phase 4.9 coexistence:** Do not dual-write the same settle into SupplierPaymentAllocation and SettlementAllocation.
- **Channel components:** Positive amount + `INCREASE`/`DECREASE`; Expected Net server-derived; Receipt only (not Payment).
- **Channel Return:** Financial statement component only — Sales/Warehouse remain physical return SoT.
- **Future marketplace adapters:** Normalize into ChannelSettlement; never bypass Expected Net or invent parallel engines.

---

## Reconciliation (Phase 6.4) — REC-001…REC-030

| ID | Invariant |
|----|-----------|
| REC-001 | Reconciliation never changes Finance transaction truth. |
| REC-002 | Reconciliation never changes source expected truth merely to force a match. |
| REC-003 | Actual matched amount derives from active Settlement Allocations. |
| REC-004 | Expected amount derives from canonical source truth or explicit immutable snapshot (`expectedSnapshot` after close). |
| REC-005 | Outstanding and discrepancy are distinct concepts. |
| REC-006 | Partial payment/receipt is not automatically a discrepancy. |
| REC-007 | Finance transaction matching must use correct direction (Receipt vs Payment). |
| REC-008 | Normal matching requires compatible currency. |
| REC-009 | FX reconciliation uses canonical FX settlement evidence. |
| REC-010 | A candidate match does not create economic effect. |
| REC-011 | Manual matching creates canonical Settlement Allocation. |
| REC-012 | Matching cannot exceed expected remaining capacity. |
| REC-013 | Matching cannot exceed Finance transaction remaining capacity. |
| REC-014 | MATCHED requires zero unresolved economic difference when matching is closed. |
| REC-015 | RESOLVED requires explicit resolution evidence. |
| REC-016 | Resolved differences remain historically visible. |
| REC-017 | Discrepancy explanation never silently changes expected or actual values. |
| REC-018 | Multiple discrepancy reasons may explain one difference. |
| REC-019 | Wrong matching is corrected through Allocation reversal/reallocation. |
| REC-020 | Missing Finance transaction is never auto-created by Reconciliation. |
| REC-021 | Duplicate Finance transaction is never deleted by Reconciliation. |
| REC-022 | Reconciliation links cannot cross tenant boundaries. |
| REC-023 | Candidate search cannot leak cross-tenant Finance data. |
| REC-024 | Reconciliation operations are concurrency-safe (reuse allocation locking). |
| REC-025 | Retryable reconciliation operations are idempotent where implemented. |
| REC-026 | Reconciliation audit preserves human decision history. |
| REC-027 | Integrity tooling is read-only. |
| REC-028 | Professional Wholesale reconciliation remains outside current scope. |
| REC-029 | Reconciliation does not calculate Profit. |
| REC-030 | Reconciliation does not implement marketplace API integrations. |

See `docs/reconciliation.md` for lifecycle and APIs.

---

## Phase 6.5 operational invariants — SET-001…SET-025

| ID | Invariant |
|----|-----------|
| SET-001 | Settlement never owns actual bank/cash truth. |
| SET-002 | Finance transactions are never rewritten to force settlement. |
| SET-003 | Outstanding is derived from canonical obligation and active allocations. |
| SET-004 | Allocation cannot exceed expected remaining capacity. |
| SET-005 | Allocation cannot exceed Finance transaction remaining capacity. |
| SET-006 | Partial settlement is first-class. |
| SET-007 | Many-to-many settlement is supported. |
| SET-008 | Allocation reversal preserves history. |
| SET-009 | Currency semantics are explicit. |
| SET-010 | FX obligations preserve obligation-currency truth. |
| SET-011 | Channel Expected Net is derived from components. |
| SET-012 | Actual Channel Receipt derives from Finance allocations. |
| SET-013 | Outstanding is not automatically discrepancy. |
| SET-014 | Discrepancy preserves expected and actual truth. |
| SET-015 | Resolved discrepancy may retain non-zero historical difference. |
| SET-016 | Resolution requires evidence. |
| SET-017 | Wrong matching uses reversal/reallocation. |
| SET-018 | Cross-tenant settlement links are impossible. |
| SET-019 | Candidate search cannot leak Finance data across tenants. |
| SET-020 | Financial mutations are audited. |
| SET-021 | Retryable economic commands are idempotent. |
| SET-022 | Allocation operations are concurrency-safe. |
| SET-023 | Integrity tools never auto-repair financial truth. |
| SET-024 | Dashboard totals never combine incompatible currencies. |
| SET-025 | Frontend never becomes financial source-of-truth. |

UI: `docs/settlement-ui.md`.
