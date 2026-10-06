# Catalog Invariants

This document is the Phase 1 contract for future Hector domains
(Warehouse, Inventory, Purchasing, Sales, Marketplace).

Future modules **MUST** reference Catalog identities:

```text
productId
skuId
barcode → SKU resolution (company-scoped)
```

They must **NOT** invent a parallel Product/SKU master catalog.

---

## Domain boundaries

| Domain | Owns | Does not own |
|---|---|---|
| **Catalog** | What is this item? (Brand, Category, Product, SKU, Variant, Barcode, Attributes, lifecycle) | Stock quantity, locations, suppliers, prices, orders, settlements |
| **Inventory / Warehouse** (future) | How many? Where? How did quantity change? | Product/SKU master identity |
| **Purchasing** (future) | Supplier, PO, cost, payable | Catalog identity |
| **Sales / Marketplace** (future) | Order, listing, commission, sale price history | Catalog identity |

---

## Identity

| Entity | Canonical identity | Human-readable |
|---|---|---|
| Product | `product.id` (UUID) | `name`, optional `code` (company-unique when present) |
| SKU | `sku.id` (UUID) — sellable/stockable unit | `code` (company-unique, permanently reserved incl. archived) |
| Barcode | `barcode.id` + company-scoped `normalizedValue` | display `value` (string; leading zeros preserved for OTHER) |
| Brand / Category / Attribute | UUID + company scope | normalized name/code uniqueness within company |

Archive **never** hard-deletes identity. Historical Audit and barcode values remain.

---

## Company ownership

Every Catalog row is company-scoped.

- Same human-readable Brand/SKU/Barcode **may** exist in Company A and Company B where uniqueness is company-scoped.
- Cross-company FK assignment is rejected (safe not-found / conflict — no existence leak).
- Search, filters, bulk, Audit, and Domain Events never cross tenants.

---

## Lifecycle

Statuses: `ACTIVE` | `INACTIVE` | `ARCHIVED` (see `CatalogLifecycleStatus`).

- Archive soft-sets `archivedAt`; does not cascade-delete children.
- Archived Brand cannot be newly assigned to Products (existing references may remain until changed).
- Archived Barcode does not resolve on the normal scanner path.
- SKU/Product codes remain reserved after archive (no reuse).

---

## Variant

- Variant options are **product-scoped** dimensions (e.g. Shade, Size).
- SKU differentiation uses deterministic `variantSignature`.
- Duplicate combination under one Product is forbidden (`productId + variantSignature` unique).
- Simple products use signature `SIMPLE`.

---

## Attributes

- Attributes are **optional**. Zero attributes is a valid Product/SKU.
- Category attribute bindings are **suggestions**, not mandatory requirements.
- BOOLEAN has three states: `true`, `false`, **not provided** (row absent). Remove ≠ false.
- MULTI_SELECT stores option IDs; order is not semantically meaningful for equality/Audit.
- Scope: Product-only vs SKU-only is enforced.
- Changing Product category does **not** delete Product attribute values.

---

## Barcode

- Exact match on company-scoped `normalizedValue`.
- Stored as **string** (OTHER preserves leading zeros; numeric GTIN types normalize digit form).
- At most one **active** primary barcode per SKU (partial unique index).
- Concurrent primary changes are protected by DB constraint + service demotion.
- Resolve returns SKU + Product identity — never invents inventory fields.

---

## Search & filters

- Always company-scoped.
- Product/SKU name/code search may be partial/normalized.
- Barcode lookup/search remains **exact**.
- Filters compose as intersection; empty QUERY bulk selection without explicit `selectAll` is rejected (`BULK_QUERY_UNSAFE`).

---

## Bulk operations

- Selection: `IDS` or `QUERY` (+ exclusions). Backend re-resolves; client counts ignored.
- Best-effort per entity; reports matched/succeeded/failed/skipped.
- Parent Audit (`CATALOG_BULK_EXECUTED`) + entity Audits/Events stamped with `bulkOperationId`.
- Parent Audit does not dump all selected IDs.
- Sync caps apply (see `docs/catalog-bulk-operations.md`). Large fan-out is a known limitation.

---

## Audit guarantees

- Meaningful mutations write Audit in the **same transaction** as the domain write.
- True no-op (equal before/after snapshots) → no Audit row.
- Rollback → no surviving success Audit.
- Append-only; Catalog APIs cannot edit/delete Audit.
- List/detail always company-scoped (`audit.read`).

---

## Domain Event guarantees

- Facts in past tense (`catalog.product.created`, …) via Phase 0 `DomainEventBus`.
- Collected during mutation; published only after commit (`commitThenPublish`).
- Rollback / thrown work → **no ghost event**.
- True no-op → no event.
- Envelope carries `eventId`, `companyId`, correlation/request ids, optional `bulkOperationId`.
- Current delivery: **in-process** (no outbox/broker). Future external delivery should be treated as at-least-once keyed by `eventId`.
- Consumers may fetch current Catalog state after an event — that state may be newer than the event.

---

## Future consumer rule

```text
Warehouse / Inventory / Purchasing / Sales / Marketplace
  → resolve or store skuId / productId from Catalog
  → subscribe to catalog.* events when reacting to changes
  → never duplicate Catalog master data
```

See also:

- `docs/catalog-architecture.md`
- `docs/catalog-audit-events.md`
- `docs/catalog-bulk-operations.md`
- `docs/catalog-search.md`
