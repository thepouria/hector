/**
 * Catalog Bulk Operations (Phase 1.10)
 *
 * ## Architecture
 *
 * ```text
 * UI selection (IDS | QUERY + excludedIds)
 *   → POST /catalog/bulk/preview  (catalog.read)
 *   → POST /catalog/bulk/execute  (catalog.manage)
 *   → CatalogBulkService
 *   → ProductsService / SkusService / EntityAttributesService
 *   → PostgreSQL + Audit + Domain Events
 * ```
 *
 * No Redis/queue in this phase. Sync best-effort per entity (each domain call keeps
 * its own transaction, entity audit, and entity events). Parent `BulkOperation` row
 * + `CATALOG_BULK_EXECUTED` audit + `catalog.bulk_operation.completed` event summarize the run.
 *
 * While entity mutations run, `runWithCatalogBulkContext(operationId)` stamps
 * `metadata.bulkOperationId` on entity Audits and `bulkOperationId` on Domain Events
 * via AsyncLocalStorage (see `docs/catalog-audit-events.md`).
 *
 * ## Selection
 *
 * - **IDS**: explicit UUID list (max 1000, deduped). Foreign-company IDs never match.
 * - **QUERY**: reuses Phase 1.9 list filters (not raw Prisma). Optional `excludedIds`.
 * - Empty QUERY without `selectAll: true` → `BULK_QUERY_UNSAFE` (never means entire catalog).
 * - Client counts are ignored; backend re-resolves at execute time.
 * - QUERY sync cap: 5000 (`BULK_QUERY_RESOLVE_MAX`).
 *
 * ## Operations
 *
 * Products: CHANGE_BRAND, CHANGE_CATEGORY, ACTIVATE, DEACTIVATE, ARCHIVE,
 * ATTRIBUTE_SET, ATTRIBUTE_REMOVE.
 *
 * SKUs: ACTIVATE, DEACTIVATE, ARCHIVE, ATTRIBUTE_SET, ATTRIBUTE_REMOVE.
 *
 * No bulk barcode rewrite, no SKU code rewrite, no import/export.
 *
 * ## Category change + attributes
 *
 * Changing category does **not** delete Product Attribute values (Phase 1.6 invariant).
 *
 * ## Attribute remove
 *
 * Remove means “not provided”. BOOLEAN remove ≠ false.
 *
 * ## Atomicity
 *
 * BEST_EFFORT per entity. Partial failures are reported (`matched/succeeded/failed/skipped`).
 *
 * ## Future
 *
 * Large ops → BulkOperation + Queue + Worker. CSV import can translate rows into the same
 * command vocabulary; Warehouse/Marketplace bulk must use their own domain services.
 */
