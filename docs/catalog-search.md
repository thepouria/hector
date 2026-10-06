# Catalog Search + Filters (Phase 1.9)

Operational Catalog search for Hector. Find identity by the identifier the user knows
(product name, code, SKU, barcode, brand, category, optional attribute filters)
without introducing Elasticsearch / Meilisearch / etc.

Related: [catalog-api.md](./catalog-api.md), [catalog-ui.md](./catalog-ui.md),
[catalog-architecture.md](./catalog-architecture.md).

---

## Architecture

```text
Catalog consumers (Web, future Warehouse/Purchasing)
        │
        ▼
Catalog Admin API  (GET /catalog/lookup, /products, /skus, …)
        │
        ▼
CatalogQueryService + ProductsService + SkusService
        │
        ▼
PostgreSQL (Prisma)  ← current Search Provider
```

Future migration path (not implemented):

```text
CatalogSearchService / CatalogQueryService
        ↓
Search Provider interface
        ↓
PostgreSQL now  |  dedicated engine later
```

Do **not** invent a second `/catalog/search` endpoint while `/catalog/lookup` covers
unified typeahead. List endpoints remain the full-result path.

Warehouse scanners should prefer **`POST /catalog/barcodes/resolve`** (exact indexed
identity) over fuzzy lookup for stock operations.

---

## Normalization

| Kind | Behavior |
| --- | --- |
| Free-text search (`normalizeSearchQuery`) | NFKC, trim, collapse whitespace, Arabic `ي/ك` → Persian `ی/ک` |
| Name keys (`normalizeCatalogNameKey` / `normalizeSearchNameKey`) | Above + Latin case-fold for `normalizedName` matching |
| Identifiers (SKU / product / brand codes) | Trim + uppercase only — no linguistic mutation |
| Barcodes | Type-aware normalize for storage; `normalizeScannedValue` for exact resolve |

Whitespace example: `"  رژ   لب  "` → `"رژ لب"`.

---

## Ranking (unified lookup)

Deterministic operational priority (not “Google relevance”):

1. Exact barcode (`normalizedValue` equality, indexed)
2. Exact SKU / product code
3. Exact product name (normalized)
4. Prefix match
5. Contains match

Barcode **contains** never outranks exact SKU/product identifiers.

Empty `search` → `[]` (never the whole Catalog).

Optional `types=PRODUCT,SKU,BARCODE`.

---

## Searchable fields

### Product list (`GET /catalog/products?search=`)

- Product name / normalizedName / code
- Brand name / normalizedName
- Category name / normalizedName
- Nested SKU code / name
- Nested active barcode value / exact normalizedValue

### SKU list (`GET /catalog/skus?search=`)

- SKU code / name / normalizedCode
- Product name / code / normalizedName
- Variant option values
- Active barcodes (exact + contains)

### Unified lookup (`GET /catalog/lookup`)

Products, SKUs, barcodes with ranking above. SKU sublabel includes variant summary when present.

### Brand / Category / Attribute definition lists

Unchanged: `search` + status (+ type/scope for attributes). Category list returns path.

---

## Product filters

| Param | Semantics |
| --- | --- |
| `search` / UI `q` | AND with filters |
| `brandId` | Exact brand UUID |
| `categoryId` | Category UUID |
| `includeDescendants` | **Default `true`** when `categoryId` set (parent = subtree). Pass `false` for exact node only |
| `status` | ACTIVE / INACTIVE / ARCHIVED |
| `hasSku` | true / false |
| `attrs` | Structured attribute filters (below) |
| `sortBy` / `sortOrder` | Whitelist only; tie-breaker `id asc` |

Filters combine with **AND**.

### Attribute filters (`attrs`)

Format: comma-separated `code:op:value` (max 20).

Identity is Attribute **code**, never display name.

| Type | Operators |
| --- | --- |
| TEXT | `eq`, `contains`, `hasValue` |
| NUMBER | `eq`, `gte`, `lte`, `hasValue` |
| BOOLEAN | `eq` (`true`/`false`), `hasValue` — unknown ≠ false |
| SINGLE_SELECT | `eq`, `in` (option UUIDs; `in` uses `\|`), `hasValue` |
| MULTI_SELECT | `containsAny`, `containsAll` (option UUIDs), `hasValue` |

Examples:

```text
attrs=spf:gte:30
attrs=oil_free:eq:true
attrs=finish:eq:<optionUuid>
attrs=skin_type:containsAny:<id1>|<id2>
attrs=spf:hasValue:false
```

Filtering **never** makes Attributes required for Product validity (Phase 1.6 invariant).

Invalid operators → `VALIDATION_ERROR` with `INVALID_ATTRIBUTE_FILTER`.

---

## SKU filters

| Param | Semantics |
| --- | --- |
| `search` | As above |
| `productId` | Scope to product |
| `status` | Lifecycle |
| `hasBarcode` | Active barcode presence |
| `variantValueId` | SKUs linked to that VariantOptionValue |
| sort whitelist + `id` tie-breaker | |

---

## Barcode

- Exact resolve: indexed `(companyId, normalizedValue)` — see barcode module.
- Lookup: exact equality first; archived barcodes excluded from operational lookup.
- Scanner UX: focus → characters → Enter (USB keyboard wedge). No hardware SDK.
- Foreign-company barcodes → not found in current company.

---

## Indexes / extensions

Migration `20261001200000_catalog_search_indexes`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- GIN trigram indexes on products/skus/brands/categories normalized_* text
```

Exact identity still uses existing unique B-tree indexes:

- `(company_id, normalized_code)` products / skus
- `(company_id, normalized_value)` barcodes

---

## Frontend

- Products / SKUs: URL state (`q`, filters, sort, page); debounce ~300ms
- Product UI: brand, category (+ descendants scope), status, hasSku, filter chips
- `CatalogLookup` on Catalog landing: keyboard ↑↓ Enter Escape; company-scoped query keys
- LTR for SKU / barcode identifiers inside RTL chrome
- Attribute filter chips when `attrs` present in URL (advanced/API-friendly; UI can add controls later without API change)

---

## RBAC / tenancy

- Search requires `catalog.read`
- Every query scoped by active `companyId`
- Search is not an authorization shortcut

---

## Performance notes

- Bounded lookup (default 15, max 20)
- Paginated lists (max page size per existing convention)
- No application-side full Catalog scans for list filters
- Attribute filters executed in SQL via Prisma relation filters

Temporary large datasets for EXPLAIN may be loaded in local/dev only — do not pollute permanent seed.
