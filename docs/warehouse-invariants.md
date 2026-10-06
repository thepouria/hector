# Warehouse Invariants (Phase 3.1)

Canonical rules for Hector Warehouse / Inventory.
**Required reading** before Goods Receipt, Stock Balance, FIFO, Sales, or Profit work.

Related: `warehouse-architecture.md`, `warehouse-purchasing-contract.md`,
`warehouse-sales-contract.md`, `purchase-receiving-contract.md`, `catalog-invariants.md`.

> Status: Phases **3.1–3.16** closed through Warehouse API + UI + Scanner UX. See also phase docs including `docs/inventory-reservations.md`, `docs/fifo-cost-layers.md`, `docs/inventory-valuation.md`, `docs/warehouse-api.md`, `docs/warehouse-ui.md`, `docs/scanner-ux.md`.

---

## Warehouse Master (Phase 3.2)

| ID | Invariant |
|---|---|
| **WH-MASTER-001** | Every Warehouse belongs to exactly one Company. |
| **WH-MASTER-002** | Warehouse code is unique within Company after normalization. |
| **WH-MASTER-003** | Warehouse code is not database identity (relations use `warehouseId`). |
| **WH-MASTER-004** | A Company has at most one default Warehouse (partial unique index). |
| **WH-MASTER-005** | Default Warehouse must be ACTIVE (`CHECK` + application rules). |
| **WH-MASTER-006** | If active warehouses exist, exactly one ACTIVE default (create/set-default/deactivate policies). |
| **WH-MASTER-007** | Warehouse cannot be moved between Companies. |
| **WH-MASTER-008** | Cross-company Warehouse access is forbidden (company-scoped lookups → 404). |
| **WH-MASTER-009** | Warehouse historical identity is not hard-deleted through normal operations (`INACTIVE`). |
| **WH-MASTER-010** | Default switch is atomic (transaction + DB unique). |
| **WH-MASTER-011** | Warehouse Master does not own stock quantity. |
| **WH-MASTER-012** | Warehouse cannot be deactivated while ACTIVE Locations exist (no silent cascade). |

---

## Warehouse Locations (Phase 3.3)

| ID | Invariant |
|---|---|
| **WH-LOC-001** | Every Location belongs to exactly one Warehouse. |
| **WH-LOC-002** | Location `companyId` must match Warehouse `companyId`. |
| **WH-LOC-003** | Parent must belong to the same Company and Warehouse. |
| **WH-LOC-004** | Location cannot parent itself. |
| **WH-LOC-005** | Location hierarchy must remain acyclic. |
| **WH-LOC-006** | Location code is unique within Warehouse after normalization. |
| **WH-LOC-007** | Location code is not database identity (relations use `locationId`). |
| **WH-LOC-008** | Location barcode is stable operational identity (`LOC-*`). |
| **WH-LOC-009** | Location barcode is Warehouse-owned, not Catalog-owned. |
| **WH-LOC-010** | Product barcode and Location barcode are separate namespaces/concepts. |
| **WH-LOC-011** | Location barcode resolution is exact (trim-only; no fuzzy match). |
| **WH-LOC-012** | Location does not own stock quantity. |
| **WH-LOC-013** | Location cannot move between Warehouses through ordinary update. |
| **WH-LOC-014** | Inactive Location remains historical (resolvable; not hard-deleted). |
| **WH-LOC-015** | Hierarchy levels may be skipped (type rank forbids only inversions). |
| **WH-LOC-016** | A small Warehouse can use root-level Shelves/Bins (`parentId = null`). |
| **WH-LOC-017** | Future inventory references Location by stable ID. |
| **WH-LOC-018** | Barcode remains stable across ordinary metadata/hierarchy changes. |

---

## Goods Receipt (Phase 3.4)

| ID | Invariant |
|---|---|
| **WH-GRN-001** | Every purchase GRN belongs to exactly one Company. |
| **WH-GRN-002** | Every purchase GRN references exactly one Purchase Order. |
| **WH-GRN-003** | Every GRN references exactly one receiving Warehouse. |
| **WH-GRN-004** | Warehouse and PO must belong to the same Company. |
| **WH-GRN-005** | Every Receipt Item references exactly one PO Item. |
| **WH-GRN-006** | Receipt Item PO Item must belong to the GRN Purchase Order. |
| **WH-GRN-007** | Receipt Item SKU must equal PO Item SKU. |
| **WH-GRN-008** | Receipt quantity must be positive. |
| **WH-GRN-009** | Only POSTED receipts count as physically received quantity. |
| **WH-GRN-010** | DRAFT receipts do not affect received quantity. |
| **WH-GRN-011** | Finalized received quantity cannot exceed ordered quantity. |
| **WH-GRN-012** | Over-receipt protection must be concurrency-safe (PO `FOR UPDATE`). |
| **WH-GRN-013** | One PO may have many GRNs. |
| **WH-GRN-014** | A GRN may receive only a subset of PO Items. |
| **WH-GRN-015** | POSTED GRN operational quantities are immutable. |
| **WH-GRN-016** | POSTED GRN cannot be directly cancelled in Phase 3.4. |
| **WH-GRN-017** | GRN does not own current stock balance. |
| **WH-GRN-018** | GRN does not create InventoryMovement in Phase 3.4. |
| **WH-GRN-019** | GRN does not own purchase price/liability. |
| **WH-GRN-020** | GRN number is operational identity, not database FK identity. |

## Purchase Receiving (Phase 3.5)

| ID | Invariant |
|---|---|
| **WH-RECV-001** | Ordered quantity remains Purchasing-owned historical truth. |
| **WH-RECV-002** | Received quantity is derived only from POSTED physical receipts. |
| **WH-RECV-003** | Draft receipts do not affect receiving progress. |
| **WH-RECV-004** | One PO Item may be received across multiple GRNs. |
| **WH-RECV-005** | Partial receipt does not imply shortage. |
| **WH-RECV-006** | Short quantity requires explicit confirmation (`closedUnfulfilled` + SHORT_CLOSED discrepancy). |
| **WH-RECV-007** | Short quantity does not represent physical stock. |
| **WH-RECV-008** | Short delivery does not rewrite ordered quantity. |
| **WH-RECV-009** | Remaining = Ordered − Received − Short. |
| **WH-RECV-010** | Received + Short may never exceed Ordered. |
| **WH-RECV-011** | Remaining may never be negative. |
| **WH-RECV-012** | Posting and shortage closure must be concurrency-safe against each other (PO `FOR UPDATE`). |
| **WH-RECV-013** | Receiving is open while any PO Item has Remaining > 0. |
| **WH-RECV-014** | Receiving is complete only when every PO Item has Remaining = 0. |
| **WH-RECV-015** | Fully received and closed-with-shortage are distinguishable (`receivingOutcome`). |
| **WH-RECV-016** | Confirmed shortage is auditable and immutable. |
| **WH-RECV-017** | Shortage cannot create a Goods Receipt. |
| **WH-RECV-018** | Purchase receiving does not own Inventory stock balance. |

## Barcode Scanner Receiving (Phase 3.6)

| ID | Invariant |
|---|---|
| **WH-SCAN-001** | Barcode scanning is an input method, not inventory source of truth. |
| **WH-SCAN-002** | Barcode identity is owned by Catalog. |
| **WH-SCAN-003** | Scanner barcode values are strings and preserve leading zeros. |
| **WH-SCAN-004** | Scanner resolution uses exact canonical barcode matching. |
| **WH-SCAN-005** | A successful barcode resolves to canonical SKU. |
| **WH-SCAN-006** | Resolved SKU must match a PO Item in the current Purchase Order. |
| **WH-SCAN-007** | Unknown barcode never creates Catalog or Warehouse records automatically. |
| **WH-SCAN-008** | SKU not present in PO cannot be received through scanner workflow. |
| **WH-SCAN-009** | Repeated physical scans of the same barcode may legitimately increase quantity. |
| **WH-SCAN-010** | Repeated scans must not create duplicate GRN Item rows. |
| **WH-SCAN-011** | Same network/request retry must not accidentally double-apply when idempotency is implemented. |
| **WH-SCAN-012** | Rapid concurrent scans must not lose increments. |
| **WH-SCAN-013** | Scanner Draft quantity cannot intentionally exceed currently available Draft capacity. |
| **WH-SCAN-014** | Draft scanner validation never replaces final POST receiving validation. |
| **WH-SCAN-015** | Scanner may mutate only DRAFT GRNs. |
| **WH-SCAN-016** | Client cannot supply trusted SKU/PO Item identity instead of server barcode resolution. |
| **WH-SCAN-017** | Scanner operations are tenant isolated. |
| **WH-SCAN-018** | Scanner receiving does not create InventoryMovement or StockBalance. |

## Batch / Lot (Phase 3.7)

| ID | Invariant |
|---|---|
| **WH-BATCH-001** | Every Batch belongs to exactly one Company. |
| **WH-BATCH-002** | Every Batch references exactly one Catalog SKU (same Company). |
| **WH-BATCH-003** | `batchNumber` (`BAT-*`) is unique per Company. |
| **WH-BATCH-004** | `batchNumber` is immutable after create. |
| **WH-BATCH-005** | Batch `skuId` is immutable after create. |
| **WH-BATCH-006** | `supplierBatchNumber` is optional; normalize trim-only; preserve leading zeros. |
| **WH-BATCH-007** | When `supplierBatchNumber IS NOT NULL`, unique per `(companyId, skuId, supplierBatchNumber)`. |
| **WH-BATCH-008** | Multiple Batches with `NULL` supplier batch number are allowed per SKU. |
| **WH-BATCH-009** | Batch is lot identity only — no mutable inventory quantity field on Batch. |
| **WH-BATCH-010** | `expiresAt` and `manufacturedAt` are optional independently. |
| **WH-BATCH-011** | When both dates are set, `expiresAt >= manufacturedAt`. |
| **WH-BATCH-012** | At most one allocation row per `(goodsReceiptItemId, batchId)`. |
| **WH-BATCH-013** | Allocation quantity is a positive integer. |
| **WH-BATCH-014** | Allocation `skuId` matches GRN item SKU and Batch SKU. |
| **WH-BATCH-015** | Sum of draft allocations on a GRN item cannot exceed item quantity. |
| **WH-BATCH-016** | GRN POST requires full allocation: Σ allocations = item quantity for every line. |
| **WH-BATCH-017** | `GoodsReceiptItem.quantity` remains the canonical received quantity (allocations do not replace it). |
| **WH-BATCH-018** | Draft batch allocations are mutable; POSTED GRN allocations are immutable. |
| **WH-BATCH-019** | The same Batch may receive quantity across multiple GRNs (separate allocation rows). |
| **WH-BATCH-020** | Batch / GRN allocations do not create InventoryMovement or StockBalance in Phase 3.7. |

---

## Putaway (Phase 3.8)

| ID | Invariant |
|---|---|
| **WH-PUT-001** | Putaway maps POSTED received Batch quantity to Warehouse Locations. |
| **WH-PUT-002** | Putaway does not create a parallel receiving truth. |
| **WH-PUT-003** | Putaway preserves SKU and Batch provenance. |
| **WH-PUT-004** | Only POSTED Goods Receipts may be put away. |
| **WH-PUT-005** | Putaway quantity must be positive. |
| **WH-PUT-006** | Completed Putaway quantity may never exceed received Batch Allocation quantity. |
| **WH-PUT-007** | One received Batch Allocation may be split across multiple Locations. |
| **WH-PUT-008** | Multiple Putaways may consume one Receipt Batch Allocation. |
| **WH-PUT-009** | Putaway Location must belong to the correct Warehouse and Company. |
| **WH-PUT-010** | Inactive Locations cannot receive Putaway. |
| **WH-PUT-011** | Location barcode resolution is exact and warehouse-scoped. |
| **WH-PUT-012** | Draft Putaway is not canonical current inventory. |
| **WH-PUT-013** | Completed Putaway is immutable historical placement truth. |
| **WH-PUT-014** | Concurrent completion cannot cause over-putaway. |
| **WH-PUT-015** | Putaway does not expose fake Current Stock. |
| **WH-PUT-016** | Putaway operations are tenant isolated. |
| **WH-PUT-017** | Client cannot override server-derived SKU/Batch identity. |
| **WH-PUT-018** | Completed Putaway posts RECEIVE InventoryMovements exactly once (Phase 3.9). |

---

## Inventory Movement Ledger (Phase 3.9)

| ID | Invariant |
|---|---|
| **WH-LEDGER-001** | Every inventory quantity change is an Inventory Movement. |
| **WH-LEDGER-002** | Inventory Movement Ledger is canonical On Hand truth. |
| **WH-LEDGER-003** | Inventory is never manually overwritten. |
| **WH-LEDGER-004** | Posted Inventory Movements are immutable. |
| **WH-LEDGER-005** | Corrections use compensating movements, never edits/deletes. |
| **WH-LEDGER-006** | Every Movement belongs to exactly one Company and SKU. |
| **WH-LEDGER-007** | Movement Batch must belong to Movement SKU. |
| **WH-LEDGER-008** | Movement Location must belong to Movement Warehouse. |
| **WH-LEDGER-009** | `quantityDelta` must never be zero. |
| **WH-LEDGER-010** | Movement type and quantity sign must agree. |
| **WH-LEDGER-011** | Operational On Hand may not become negative. |
| **WH-LEDGER-012** | Current On Hand is derived from Ledger movements. |
| **WH-LEDGER-013** | InventoryBalance is a rebuildable projection only. |
| **WH-LEDGER-014** | InventoryBalance changes only through canonical Ledger posting. |
| **WH-LEDGER-015** | InventoryBalance must equal Ledger SUM for each position. |
| **WH-LEDGER-016** | Completed Putaway creates RECEIVE exactly once per PutawayItem. |
| **WH-LEDGER-017** | Putaway RECEIVE preserves SKU, Batch, Warehouse, Location. |
| **WH-LEDGER-018** | Internal Transfer = equal TRANSFER_OUT + TRANSFER_IN. |
| **WH-LEDGER-019** | Transfer conserves company-level total quantity. |
| **WH-LEDGER-020** | Outbound movements require sufficient On Hand. |
| **WH-LEDGER-021** | Concurrent outbound ops cannot create negative stock. |
| **WH-LEDGER-022** | Source-generated movements are idempotent. |
| **WH-LEDGER-023** | Movement provenance remains traceable to its source. |
| **WH-LEDGER-024** | Cross-company inventory relationships are forbidden. |
| **WH-LEDGER-025** | No generic client Movement CRUD bypasses domain validation. |
| **WH-LEDGER-026** | Stock Count corrections are delta movements, not overwrite. |
| **WH-LEDGER-027** | Opening inventory enters through a movement. |
| **WH-LEDGER-028** | Quantity Ledger and Financial Ledger remain separate. |

---

## Stock Balance (Phase 3.10)

| ID | Invariant |
|---|---|
| **WH-BAL-001** | StockBalance (`InventoryBalance`) is a derived projection of InventoryMovement. |
| **WH-BAL-002** | InventoryMovement remains canonical inventory truth. |
| **WH-BAL-003** | StockBalance cannot be manually overwritten through business APIs. |
| **WH-BAL-004** | Each logical inventory position has at most one StockBalance row. |
| **WH-BAL-005** | Inventory position identity is Company + Warehouse + Location + SKU + Batch (`batchId` required). |
| **WH-BAL-006** | `onHandQuantity` equals `SUM(quantityDelta)` for its position. |
| **WH-BAL-007** | Movement posting and Balance update occur atomically. |
| **WH-BAL-008** | Operational StockBalance cannot become negative. |
| **WH-BAL-009** | Concurrent stock operations cannot create duplicate Balance positions. |
| **WH-BAL-010** | Concurrent outbound operations cannot bypass available On Hand. |
| **WH-BAL-011** | Balance can be rebuilt entirely from Movement Ledger. |
| **WH-BAL-012** | Balance rebuild never modifies Movement Ledger. |
| **WH-BAL-013** | Reconciliation detects mismatches, missing balances and orphan balances. |
| **WH-BAL-014** | SKU total equals sum of its inventory positions. |
| **WH-BAL-015** | Warehouse total for a SKU equals sum of its positions within that Warehouse. |
| **WH-BAL-016** | Location stock equals sum of its SKU/Batch positions. |
| **WH-BAL-017** | Batch stock equals sum of its Warehouse/Location positions. |
| **WH-BAL-018** | Archived SKU / inactive Location / inactive Warehouse with On Hand remains visible. |
| **WH-BAL-019** | StockBalance represents On Hand only. |
| **WH-BAL-020** | On Hand must not be presented as Available-to-Sell. |
| **WH-BAL-021** | Cross-company Balance access is forbidden. |
| **WH-BAL-022** | No client-facing CRUD may directly mutate StockBalance. |
| **WH-BAL-023** | Zero-balance handling must not destroy Ledger history. |
| **WH-BAL-024** | Inventory queries use Balance for current state and Ledger for history/reconciliation. |
| **WH-BAL-025** | Quantity Balance remains separate from inventory valuation/financial accounting. |

---

## Internal Stock Transfer (Phase 3.11)

| ID | Invariant |
|---|---|
| **WH-TRF-001** | Internal Transfer never changes Company-owned total inventory. |
| **WH-TRF-002** | Transfer stock changes occur only through Inventory Movement Ledger. |
| **WH-TRF-003** | DRAFT Transfer creates no inventory movements. |
| **WH-TRF-004** | Dispatch removes stock from source and places equal quantity into Transit. |
| **WH-TRF-005** | Completion removes stock from Transit and places equal quantity into destination. |
| **WH-TRF-006** | Source and destination preserve the same SKU. |
| **WH-TRF-007** | Source and destination preserve the same Batch. |
| **WH-TRF-008** | Transfer quantity must be positive. |
| **WH-TRF-009** | Source and destination Location cannot be identical. |
| **WH-TRF-010** | Source Location belongs to Source Warehouse. |
| **WH-TRF-011** | Destination Location belongs to Destination Warehouse. |
| **WH-TRF-012** | Cross-company Transfer is forbidden. |
| **WH-TRF-013** | Dispatch requires sufficient source On Hand. |
| **WH-TRF-014** | Dispatch is atomic across Transfer Items. |
| **WH-TRF-015** | Completion is atomic across Transfer Items. |
| **WH-TRF-016** | Dispatch is idempotent. |
| **WH-TRF-017** | Completion is idempotent. |
| **WH-TRF-018** | Inventory-critical fields become immutable after dispatch. |
| **WH-TRF-019** | Completed Transfer cannot be cancelled. |
| **WH-TRF-020** | Cancelling an IN_TRANSIT Transfer returns inventory to source through compensating movements. |
| **WH-TRF-021** | Transfer cancellation never deletes or edits posted movements. |
| **WH-TRF-022** | Transit inventory remains part of Company-owned inventory. |
| **WH-TRF-023** | Transit inventory is not treated as physical stock at destination. |
| **WH-TRF-024** | StockBalance must reconcile with Ledger at every Transfer lifecycle stage. |
| **WH-TRF-025** | Concurrent Transfers cannot create negative inventory. |
| **WH-TRF-026** | Transfer movements remain traceable to Transfer and Transfer Item. |
| **WH-TRF-027** | Transfer does not reserve stock while DRAFT. |
| **WH-TRF-028** | StockTransfer lifecycle transitions use explicit commands, not arbitrary status mutation. |
| **WH-TRF-029** | Transfer preserves line `classification` on all TRANSFER_OUT/IN movements. |

---

## Stock Classification (Phase 3.12)

| ID | Invariant |
|---|---|
| **WH-CLS-001** | Classification is a position dimension, not a SKU attribute. |
| **WH-CLS-002** | Balance uniqueness includes `classification`. |
| **WH-CLS-003** | Reclassification never changes company physical SKU total. |
| **WH-CLS-004** | Reclassification posts RECLASSIFY_OUT + RECLASSIFY_IN atomically (shared `operationId`). |
| **WH-CLS-005** | Reclassification has no DRAFT state — document is posted immediately. |
| **WH-CLS-006** | `fromClassification` and `toClassification` must differ. |
| **WH-CLS-007** | Reclassification quantity must be positive. |
| **WH-CLS-008** | RECLASSIFY_OUT debits `fromClassification`; RECLASSIFY_IN credits `toClassification`. |
| **WH-CLS-009** | Reclassification requires sufficient On Hand on source classification. |
| **WH-CLS-010** | Warehouse/location/sku/batch on movements match the change document. |
| **WH-CLS-011** | Ledger `sourceType=CLASSIFICATION_CHANGE` movements reference the change document. |
| **WH-CLS-012** | Each change operation nets to zero Σ(`quantityDelta`) at company SKU scope. |
| **WH-CLS-013** | Internal transfer preserves classification end-to-end (see WH-TRF-029). |
| **WH-CLS-014** | Receive/putaway defaults new stock to SELLABLE unless explicitly specified later. |
| **WH-CLS-015** | Cross-company classification access is forbidden (company-scoped → 404). |

---

## Stock Issue (Phase 3.12)

| ID | Invariant |
|---|---|
| **WH-ISS-001** | DRAFT Stock Issue creates no inventory movements. |
| **WH-ISS-002** | POSTED Stock Issue posts exactly one ISSUE movement per line. |
| **WH-ISS-003** | POSTED issue lines are immutable; POSTED issues cannot be cancelled. |
| **WH-ISS-004** | Issue quantity must be positive. |
| **WH-ISS-005** | Issue debits the line's `classification` bucket at location/batch. |
| **WH-ISS-006** | Issue line location must belong to issue header warehouse. |
| **WH-ISS-007** | Issue line batch must match SKU. |
| **WH-ISS-008** | POST requires sufficient On Hand on each line classification. |
| **WH-ISS-009** | Multi-line POST is atomic — all lines or none. |
| **WH-ISS-010** | POST is idempotent when already POSTED. |
| **WH-ISS-011** | ISS movement `quantityDelta = −line.quantity`. |
| **WH-ISS-012** | ISS movement classification equals line classification. |
| **WH-ISS-013** | Ledger `sourceType=STOCK_ISSUE` traceability via `sourceId` + `sourceLineId`. |
| **WH-ISS-014** | Issue number is unique per company (`ISS-NNNNNN`). |
| **WH-ISS-015** | Scanner apply on DRAFT is idempotent by `requestId`. |
| **WH-ISS-016** | Cross-company issue access is forbidden (company-scoped → 404). |
| **WH-ISS-017** | DRAFT cancel has no stock effect. |
| **WH-ISS-018** | Stock Issue is non-sales outbound — does not replace Sales shipment authority. |

---

## Inventory Adjustment (Phase 3.13)

| ID | Invariant |
|---|---|
| **WH-ADJ-001** | DRAFT adjustment creates no inventory movements. |
| **WH-ADJ-002** | POSTED adjustment posts exactly one ADJUSTMENT_IN/OUT movement per line. |
| **WH-ADJ-003** | POSTED adjustments are immutable; POSTED cannot be cancelled. |
| **WH-ADJ-004** | Adjustment line quantity must be positive (`direction` carries sign). |
| **WH-ADJ-005** | Adjustment affects the line's `classification` bucket at location/batch. |
| **WH-ADJ-006** | Adjustment line location must belong to header warehouse. |
| **WH-ADJ-007** | Adjustment line batch must match SKU. |
| **WH-ADJ-008** | OUT adjustments require sufficient On Hand unless policy allows negative (normal ops: no). |
| **WH-ADJ-009** | Multi-line POST is atomic — all lines or none. |
| **WH-ADJ-010** | POST is idempotent when already POSTED. |
| **WH-ADJ-011** | IN movement `quantityDelta = +line.quantity`; OUT movement `quantityDelta = −line.quantity`. |
| **WH-ADJ-012** | Movement classification equals line classification. |
| **WH-ADJ-013** | Ledger `sourceType=MANUAL_ADJUSTMENT` via `sourceId` + `sourceLineId`. |
| **WH-ADJ-014** | Adjustment number is unique per company (`ADJ-NNNNNN`). |
| **WH-ADJ-015** | Cross-company adjustment access is forbidden (company-scoped → 404). |
| **WH-ADJ-016** | Adjustment is not a substitute for Issue, Transfer, or Reclassify. |

---

## Stock Count (Phase 3.13)

| ID | Invariant |
|---|---|
| **WH-CNT-001** | DRAFT / IN_PROGRESS count creates no correction movements. |
| **WH-CNT-002** | POSTED count posts at most one STOCK_COUNT_ADJUSTMENT movement per line with non-zero `difference`. |
| **WH-CNT-003** | POSTED count lines are immutable; POSTED counts cannot be cancelled. |
| **WH-CNT-004** | `countedQuantity` NULL ≠ 0; counted values must be ≥ 0 when set. |
| **WH-CNT-005** | Correction affects the line's `classification` bucket at location/batch. |
| **WH-CNT-006** | Count line warehouse/location must align with count header warehouse. |
| **WH-CNT-007** | Count line batch must match SKU. |
| **WH-CNT-008** | POST applies corrections only for lines with `difference ≠ 0`. |
| **WH-CNT-009** | POST is atomic across all correction movements. |
| **WH-CNT-010** | POST is idempotent when already POSTED. |
| **WH-CNT-011** | Correction movement `quantityDelta = difference` (signed). |
| **WH-CNT-012** | Movement classification equals line classification. |
| **WH-CNT-013** | Ledger `sourceType=STOCK_COUNT` via `sourceId` + `sourceLineId`. |
| **WH-CNT-014** | Count number is unique per company (`COUNT-NNNNNN`). |
| **WH-CNT-015** | Cross-company count access is forbidden (company-scoped → 404). |
| **WH-CNT-016** | `expectedQuantity = snapshotQuantity + movementsDuringCount` at post when both snapshot and movements are set. |
| **WH-CNT-017** | Stock count never overwrites StockBalance — corrections go through Ledger only. |
| **WH-CNT-018** | Scanner apply on IN_PROGRESS is idempotent by `requestId`. |

---

## Reservations (Phase 3.15)

- **WH-RES-001** Reservation never changes physical On Hand.
- **WH-RES-002** Reservation never creates InventoryMovement by itself.
- **WH-RES-003** Available = SELLABLE On Hand − Active Reserved.
- **WH-RES-004** Available cannot become negative under no-oversell policy.
- **WH-RES-005** Reservation quantity must be positive.
- **WH-RES-006** Reservation creation is concurrency-safe (availability lock).
- **WH-RES-007** Reservation operations are idempotent (requestId / source identity).
- **WH-RES-008** Released/Consumed/Expired reservations do not count toward Reserved.
- **WH-RES-009** Normal commercial reservations use SELLABLE stock.
- **WH-RES-010** Reservation is not physical Batch/Location picking allocation.
- **WH-RES-011** Reservation does not affect inventory valuation.
- **WH-RES-012** Unreserved outbound cannot silently consume stock committed to active reservations.

## FIFO Cost Layers (Phase 3.15)

- **WH-FIFO-001** Every acquisition layer has immutable source provenance.
- **WH-FIFO-002** `originalQuantity` is immutable.
- **WH-FIFO-003** `0 <= remainingQuantity <= originalQuantity`.
- **WH-FIFO-004** Layer consumption is immutable and traceable to InventoryMovement.
- **WH-FIFO-005** Normal outbound consumes oldest eligible layers deterministically (warehouse-scoped).
- **WH-FIFO-006** One movement may consume multiple layers.
- **WH-FIFO-007** One layer may be consumed by multiple movements.
- **WH-FIFO-008** Reservation does not consume FIFO layers.
- **WH-FIFO-009** Internal Location Transfer does not reset acquisition cost.
- **WH-FIFO-010** Internal Warehouse Transfer preserves acquisition-cost provenance.
- **WH-FIFO-011** Stock Classification Change preserves acquisition-cost provenance.
- **WH-FIFO-012** Supplier Return uses acquisition provenance where known.
- **WH-FIFO-013** FIFO consumption is concurrency-safe.
- **WH-FIFO-014** Physical movement and layer consumption cannot diverge (same TX).
- **WH-FIFO-015** Unknown acquisition cost must never be silently represented as zero.
- **WH-FIFO-016** Layer quantities remain reconcilable.

## Inventory Valuation (Phase 3.15)

- **WH-VAL-001** Inventory valuation is based on remaining acquisition-cost layers.
- **WH-VAL-002** Unknown cost is explicitly UNVALUED/PARTIAL, never fake zero.
- **WH-VAL-003** Reservation does not reduce owned inventory value.
- **WH-VAL-004** Internal Transfer does not change total Company inventory value.
- **WH-VAL-005** Location Transfer does not change total Company inventory value.
- **WH-VAL-006** Classification Change does not change total Company inventory value.
- **WH-VAL-007** Supplier Return decreases remaining Company inventory value.
- **WH-VAL-008** Physical Issue decreases remaining Company inventory value.
- **WH-VAL-009** TESTER/DAMAGED/QUARANTINE may still carry acquisition value.
- **WH-VAL-010** Historical acquisition cost is not automatically revalued using current FX rate.
- **WH-VAL-011** Valuation completeness must be explicit when unvalued quantity exists.
- **WH-VAL-012** Inventory Cost Consumption is not automatically classified as COGS.
- **WH-VAL-013** Profit is not calculated in Phase 3.
- **WH-VAL-014** Monetary calculations use exact Decimal/Numeric semantics.

See also: `docs/inventory-reservations.md`, `docs/fifo-cost-layers.md`, `docs/inventory-valuation.md`.

## Supplier Return Execution (Phase 3.14)

| ID | Invariant |
|---|---|
| **WH-SRET-001** | DRAFT execution creates no inventory movements. |
| **WH-SRET-002** | DISPATCHED execution posts exactly one `RETURN_OUT` movement per line. |
| **WH-SRET-003** | DISPATCHED execution lines are immutable; DISPATCHED executions cannot be cancelled. |
| **WH-SRET-004** | Execution item quantity must be positive. |
| **WH-SRET-005** | Dispatch debits the line's `classification` bucket at location/batch. |
| **WH-SRET-006** | Execution item location must belong to execution header warehouse. |
| **WH-SRET-007** | Execution item batch must match SKU. |
| **WH-SRET-008** | Execution item SKU must match linked `PurchaseReturnItem` SKU. |
| **WH-SRET-009** | Dispatch requires sufficient On Hand on each line classification. |
| **WH-SRET-010** | Multi-line dispatch is atomic — all lines or none. |
| **WH-SRET-011** | Dispatch is idempotent when already DISPATCHED. |
| **WH-SRET-012** | `RETURN_OUT` movement `quantityDelta = −line.quantity`. |
| **WH-SRET-013** | Movement classification equals line classification. |
| **WH-SRET-014** | Ledger `sourceType=SUPPLIER_RETURN` via `sourceId` + `sourceLineId`. |
| **WH-SRET-015** | Execution number is unique per company (`SRE-NNNNNN`). |
| **WH-SRET-016** | Cross-company execution access is forbidden (company-scoped → 404). |
| **WH-SRET-017** | DRAFT cancel has no stock effect. |
| **WH-SRET-018** | Σ DISPATCHED qty per return line ≤ authorized `PurchaseReturnItem.quantity`. |
| **WH-SRET-019** | Only APPROVED purchase returns are eligible for warehouse execution. |
| **WH-SRET-020** | Scanner apply on DRAFT is idempotent by `requestId`. |
| **WH-SRET-021** | Physical supplier return dispatch ≠ Purchasing approval ≠ Finance credit. |

---

## Identity & ownership

| ID | Invariant |
|---|---|
| **WH-INV-001** | Posted Inventory Movements are immutable (no edit/delete in normal ops). |
| **WH-INV-002** | Stock Balance must be reconcilable to the sum of applicable Inventory Movements. |
| **WH-INV-003** | Normal physical stock cannot become negative. |
| **WH-INV-004** | Internal transfer conserves company physical quantity (balanced OUT/IN legs). |
| **WH-INV-005** | Draft Goods Receipts do not affect stock. |
| **WH-INV-006** | Location On Hand enters via COMPLETED Putaway RECEIVE exactly once (idempotent); GRN POST alone does not create location stock. |
| **WH-INV-007** | By default, accepted received quantity cannot exceed ordered quantity per PO line. |
| **WH-INV-008** | Reservation does not change physical On Hand. |
| **WH-INV-009** | `AVAILABLE = SELLABLE_ON_HAND − ACTIVE_RESERVATIONS` (− future safety stock). |
| **WH-INV-010** | TESTER / DAMAGED / QUARANTINE are inventory states of the same SKU — not duplicate SKUs. |
| **WH-INV-011** | Product barcode identity belongs to Catalog; Warehouse must not create a second product-barcode master. |
| **WH-INV-012** | Physically received quantity belongs to Warehouse; ordered quantity belongs to Purchasing. |
| **WH-INV-013** | Warehouse does not own supplier payment, cash, bank, FX settlement, or partner capital. |
| **WH-INV-014** | StockBalance is not directly editable (no `PATCH quantity`). |
| **WH-INV-015** | InventoryMovement is append-only; mistakes use compensating movements. |
| **WH-INV-016** | Every Warehouse-owned entity is company-scoped; Company A never affects Company B inventory. |
| **WH-INV-017** | Location / state transfer preserves total company physical quantity. |
| **WH-INV-018** | Batch (lot identity) is not the same concept as FIFO Layer (cost provenance). |
| **WH-INV-019** | Posted inventory changes require traceable `sourceType` / `sourceId` / reason (as applicable). |
| **WH-INV-020** | FIFO / acquisition provenance must survive internal location moves and inventory-state changes. |

---

## Additional invariants

| ID | Invariant |
|---|---|
| **WH-INV-021** | Warehouse references Catalog `skuId` only — no WarehouseProduct / WarehouseSku master. |
| **WH-INV-022** | Warehouse operational barcodes (location/batch/receipt) are a separate namespace from Catalog product barcodes. |
| **WH-INV-023** | Quantity sign convention: positive enters a dimensional key; negative leaves it. |
| **WH-INV-024** | Inventory quantities are integers (cosmetics domain; matches Purchasing). Never float. |
| **WH-INV-025** | One PO item may have multiple receipts and multiple batches. |
| **WH-INV-026** | Receipts never rewrite `PurchaseOrderItem.quantity`. |
| **WH-INV-027** | Short receipt is valid; commercial short-close remains Purchasing authority. |
| **WH-INV-028** | Purchase Return intent (Purchasing) ≠ physical supplier-return dispatch (Warehouse). |
| **WH-INV-029** | Domain Events are signals, not master data and not the stock ledger. |
| **WH-INV-030** | Warehouse correctness must not depend exclusively on non-durable `PurchaseOrderOrdered` delivery. |
| **WH-INV-031** | ON_HAND includes physical states SELLABLE + TESTER + DAMAGED + QUARANTINE (initial set). |
| **WH-INV-032** | SELLABLE_ON_HAND is only the SELLABLE state — not confused with AVAILABLE. |
| **WH-INV-033** | Concurrent stock mutations must be transactionally serialized at the relevant stock/reservation key. |
| **WH-INV-034** | Double application of the same posting/completion/reversal must be prevented (status + idempotency). |
| **WH-INV-035** | FIFO remaining quantity never goes negative; layers remain reconcilable to eligible physical stock. |
| **WH-INV-036** | Archived SKU / Warehouse / Location history remains readable; prefer archive over hard-delete when referenced. |
| **WH-INV-037** | InventoryMovement / StockBalance / FifoLayer are not public CRUD resources. |
| **WH-INV-038** | Server time is authoritative for stock posting; client `occurredAt` is not trusted by default. |
| **WH-INV-039** | Multiple warehouses per company are supported; “exactly one warehouse forever” is forbidden. |
| **WH-INV-040** | Channels / Sales must not become independent stock truth — they consume Warehouse availability. |

---

## Definitions (quick)

```text
ON_HAND            = Σ physical presence states
SELLABLE_ON_HAND   = quantity in SELLABLE
RESERVED           = active reservations (non-physical)
AVAILABLE          = SELLABLE_ON_HAND − RESERVED (− future SAFETY_STOCK)

orderedQuantity    = Purchasing PO line quantity
acceptedReceived   = Σ posted (non-reversed) Warehouse receipt qty for that line
remainingExpected  ≈ ordered − accepted − closedUnfulfilled (Purchasing short-close)
```

---

## Warehouse API / UI (Phase 3.16)

| ID | Invariant |
|---|---|
| **WH-API-001** | Every Warehouse endpoint is Company-scoped. |
| **WH-API-002** | Nested resource IDs are tenant validated. |
| **WH-API-003** | Physical stock changes only through canonical domain commands. |
| **WH-API-004** | No API directly overwrites StockBalance. |
| **WH-API-005** | Lifecycle transitions use explicit commands, not arbitrary status PATCH. |
| **WH-API-006** | All large collections are paginated/bounded. |
| **WH-API-007** | Barcode resolution is exact and string-based. |
| **WH-API-008** | API retries cannot duplicate physical inventory operations. |
| **WH-API-009** | Cost/valuation data requires explicit permission. |
| **WH-API-010** | Backend remains authoritative for inventory-derived quantities. |
| **WH-UI-001** | Company switch cannot leave stale Warehouse data/context. |
| **WH-UI-002** | All Warehouse query keys are Company-aware. |
| **WH-UI-003** | Posted/completed immutable documents are read-only. |
| **WH-UI-004** | UI never exposes direct On Hand editing. |
| **WH-UI-005** | SELLABLE / TESTER / DAMAGED / QUARANTINE remain visually distinct. |
| **WH-UI-006** | On Hand / Reserved / Available remain distinct. |
| **WH-UI-007** | Sensitive valuation data is permission-gated. |
| **WH-UI-008** | Physical mutations require server confirmation before success is shown. |
| **WH-UI-009** | Domain errors are rendered as actionable operational messages. |
| **WH-UI-010** | Source documents remain traceable through UI. |

Operational scanner UX invariants: `docs/scanner-ux.md` (`WH-SCANUX-*`). Phase 3.6 receiving scanner invariants remain `WH-SCAN-*` above.

---

## Inventory Dashboard (Phase 3.17)

| ID | Invariant |
|---|---|
| **WH-DASH-001** | Dashboard is a read model, never inventory truth. |
| **WH-DASH-002** | Dashboard never directly mutates Warehouse state. |
| **WH-DASH-003** | Total Units reconciles to canonical StockBalance. |
| **WH-DASH-004** | Classification totals reconcile to On Hand. |
| **WH-DASH-005** | Reserved uses active Reservation truth. |
| **WH-DASH-006** | Available = SELLABLE On Hand − Active Reserved. |
| **WH-DASH-007** | Company data never crosses tenant boundary. |
| **WH-DASH-008** | Internal Transfer cannot change Company total quantity. |
| **WH-DASH-009** | Internal Transfer cannot change Company total valuation. |
| **WH-DASH-010** | Valuation metrics require explicit permission. |
| **WH-DASH-011** | Unvalued inventory is shown explicitly. |
| **WH-DASH-012** | Dashboard does not calculate Profit. |

Details: `docs/inventory-dashboard.md`.

## Warehouse Audit (Phase 3.17)

| ID | Invariant |
|---|---|
| **WH-AUD-001** | Audit is append-only operational history. |
| **WH-AUD-002** | Audit does not replace InventoryMovement. |
| **WH-AUD-003** | Every Audit record is Company-scoped. |
| **WH-AUD-004** | Actor comes from authenticated/system context. |
| **WH-AUD-005** | Client cannot spoof actor/company. |
| **WH-AUD-006** | Meaningful successful Warehouse state transitions are audited. |
| **WH-AUD-007** | Failed operation does not produce successful-operation Audit. |
| **WH-AUD-008** | Audit does not contain credentials/secrets. |
| **WH-AUD-009** | Idempotent retry does not create duplicate logical success Audit. |
| **WH-AUD-010** | Audit entity references remain tenant-safe. |
| **WH-AUD-011** | Read operations are not unnecessarily audit-spammed. |
| **WH-AUD-012** | Physical changes remain traceable from operational action to InventoryMovement. |

Details: `docs/warehouse-audit.md`.

## Warehouse Domain Events (Phase 3.17)

| ID | Invariant |
|---|---|
| **WH-EVT-001** | Domain Events represent business facts, not raw DB mutations. |
| **WH-EVT-002** | Events use existing Phase 0 event infrastructure. |
| **WH-EVT-003** | Events are emitted only for successful domain transitions. |
| **WH-EVT-004** | Failed/rolled-back operation cannot emit a successful business fact. |
| **WH-EVT-005** | Every Warehouse event carries reliable Company context. |
| **WH-EVT-006** | Event payloads are bounded and do not dump entire entities. |
| **WH-EVT-007** | Events contain no credentials/secrets. |
| **WH-EVT-008** | Event naming uses stable domain semantics. |
| **WH-EVT-009** | Idempotent operation does not create duplicate logical event. |
| **WH-EVT-010** | Scanner and normal UI produce the same domain events. |
| **WH-EVT-011** | Events do not become an alternative Inventory source of truth. |
| **WH-EVT-012** | In-process delivery limitations are documented honestly. |

Details: `docs/warehouse-domain-events.md`.

---

## Integrity + Reconciliation (Phase 3.18)

| ID | Invariant |
|---|---|
| **WH-INT-001** | Every physical stock mutation creates canonical InventoryMovement truth. |
| **WH-INT-002** | StockBalance reconciles exactly to InventoryMovement. |
| **WH-INT-003** | StockBalance is never manually overwritten outside rebuild-from-ledger. |
| **WH-INT-004** | Internal transfer preserves Company quantity. |
| **WH-INT-005** | Internal transfer preserves Company valuation. |
| **WH-INT-006** | Classification transfer preserves Company quantity. |
| **WH-INT-007** | Classification transfer preserves Company valuation. |
| **WH-INT-008** | Active Reserved ≤ SELLABLE On Hand. |
| **WH-INT-009** | Available = SELLABLE On Hand − Active Reserved. |
| **WH-INT-010** | Reservations do not mutate On Hand. |
| **WH-INT-011** | FIFO layer remaining = original − SUM(consumptions). |
| **WH-INT-012** | FIFO layers cannot be over-consumed. |
| **WH-INT-013** | Known valuation = remaining valued FIFO layers × unit cost. |
| **WH-INT-014** | Unvalued inventory is explicit, never silently zero-cost. |
| **WH-INT-015** | Posted Goods Receipts reconcile to RECEIVE movements (via completed putaway). |
| **WH-INT-016** | Completed Transfers reconcile to TRANSFER_OUT/IN movements. |
| **WH-INT-017** | Posted Issues reconcile to ISSUE movements. |
| **WH-INT-018** | Approved Adjustments reconcile to adjustment movements. |
| **WH-INT-019** | Approved Stock Counts reconcile to STOCK_COUNT_ADJUSTMENT movements. |
| **WH-INT-020** | Supplier Return dispatch reconciles to RETURN_OUT. |
| **WH-INT-021** | Posted physical operations are idempotent. |
| **WH-INT-022** | Tenant boundaries hold across every Warehouse relation. |
| **WH-INT-023** | Audit cannot replace InventoryMovement. |
| **WH-INT-024** | Domain Events cannot replace InventoryMovement. |
| **WH-INT-025** | Dashboard reconciles to canonical Warehouse truth. |
| **WH-INT-026** | Scanner and normal UI use identical domain truth. |
| **WH-INT-027** | No Phase 3 operation creates Sales/Finance/Profit truth. |
| **WH-INT-028** | Historical physical ledger records are immutable. |
| **WH-INT-029** | Concurrency cannot violate stock/FIFO/reservation bounds. |
| **WH-INT-030** | Reconciliation detects drift but never silently repairs it. |

CLI: `pnpm inventory:reconcile` — see `docs/inventory-reconciliation.md`.

---

## Critical negative answers (architecture)

All of the following must remain **FALSE**:

```text
Warehouse redefines Product/SKU
Warehouse owns product barcode master
Purchasing owns physical received quantity
StockBalance is directly editable
Posted InventoryMovement is editable
Internal transfer creates net stock
Reservation reduces physical On Hand
TESTER/DAMAGED require duplicate SKUs
One PO Item requires exactly one Receipt or one Batch
Batch equals FIFO Layer
Warehouse owns supplier payment / settles FX / owns Sales Order / calculates final profit
Warehouse depends exclusively on non-durable PurchaseOrderOrdered
Warehouse Master owns stock quantity / Locations / Receipts / Movements / FIFO / scanner UX
UI/Scanner bypass Inventory Ledger or overwrite StockBalance
Scanner auto-creates Product/SKU
Barcode cast to number
Generic PATCH marks Receipt posted / Transfer completed / Supplier Return dispatched
```
