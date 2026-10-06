# Catalog Admin API (Phase 1.7)

Hector’s **Catalog Admin API** exposes company-scoped **identity** data only: brands, categories, products, variant options, SKUs, barcodes, and optional attribute specifications.

It does **not** expose inventory, warehouse location, cost, price, purchase/sale history, or marketplace listing IDs. Operational modules (Warehouse, Purchase, Sales) consume **SKU id** and resolve barcodes through these endpoints—they never mutate stock from Catalog.

For domain concepts and invariants, see [catalog-architecture.md](./catalog-architecture.md).

---

## Authentication and company context

All routes live under **`/api/v1/catalog/...`**.

| Requirement | Detail |
| --- | --- |
| Authentication | Bearer access token (`Authorization: Bearer …`) |
| Company | Active membership + `X-Company-Id: <uuid>` header |
| Trust model | **Never trust `companyId` in query/body.** Scope is always the authenticated member’s selected company. |

Cross-company IDs return **404** (not 403) for catalog resources.

---

## Permissions

| Permission | Capability |
| --- | --- |
| `catalog.read` | GET/list/detail, lookup, stats, barcode resolve, attribute reads, bulk preview |
| `catalog.manage` | POST/PATCH/PUT mutations (create, update, lifecycle, bulk SKU, barcodes, attributes, bulk execute) |

Backend enforcement is authoritative; UI hides actions but cannot bypass API checks.

---

## Pagination

List endpoints share query parameters:

| Param | Default | Max | Notes |
| --- | --- | --- | --- |
| `page` | `1` | — | 1-based |
| `pageSize` | `20` | `100` | Values &gt; 100 → **400** validation error |

Response envelope:

```json
{
  "data": [ … ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

`totalPages` is `0` when `total` is `0`, otherwise `ceil(total / pageSize)`.

---

## Search parameter

Use **`search`** consistently across catalog lists (products, SKUs, brands, categories, attributes). Max length **100** characters (normalized server-side).

Phase 1.7 expanded matching:

- **Products:** name, code, related **SKU code/name**, related **barcode value**
- **SKUs:** code, name, **barcode value**

---

## Filters and sorting

### Products `GET /catalog/products`

| Query | Description |
| --- | --- |
| `status` | `ACTIVE` \| `INACTIVE` \| `ARCHIVED` |
| `brandId` | UUID |
| `categoryId` | UUID |
| `includeDescendants` | With `categoryId`, include products in descendant categories. **Default `true`** (parent = subtree). Pass `false` for exact category only |
| `hasSku` | `true` = at least one SKU; `false` = zero SKUs |
| `attrs` | Structured attribute filters: `code:op:value` comma-separated (see [catalog-search.md](./catalog-search.md)) |
| `sortBy` | `name` \| `code` \| `createdAt` \| `updatedAt` \| `status` |
| `sortOrder` | `asc` \| `desc` |

List rows include **`skuCount`** (all SKUs). They do **not** embed a nested `skus` array—fetch SKUs via `GET /catalog/products/:productId/skus` or `GET /catalog/skus?productId=…`.

### SKUs `GET /catalog/skus`

| Query | Description |
| --- | --- |
| `productId` | Filter by product |
| `hasBarcode` | `true` / `false` — active barcode presence |
| `sortBy` | `code` \| `name` \| `createdAt` \| `updatedAt` \| `status` |

List rows may include **`hasBarcode`** and **`primaryBarcode`** (`id`, `value`, `type`) when loaded for admin grids.

### Attributes `GET /catalog/attributes`

| Query | Description |
| --- | --- |
| `view=options` | Each definition includes its `options[]` in the list response |

---

## Resolve vs search vs lookup

| Mechanism | Method | Purpose |
| --- | --- | --- |
| **Search** | `search` on list endpoints | Paginated admin filtering |
| **Lookup** | `GET /catalog/lookup?search=` | Ranked typeahead (exact barcode → exact SKU/code → name; products, SKUs, barcodes; default 15 hits, max 20). Optional `types=PRODUCT,SKU,BARCODE` |
| **Resolve** | `POST /catalog/barcodes/resolve` | Exact barcode → SKU + product **for scanning** |

- **Lookup** is for autocomplete (products + SKUs). It does not perform checksum validation or inventory side-effects.
- **Resolve** is for wedge scanners: exact normalized barcode match; archived → `BARCODE_NOT_ACTIVE`.

Deprecated alias: `GET /catalog/barcodes/lookup?value=` (prefer resolve POST or catalog lookup for admin UI).

---

## Optional attributes (critical)

> **All Product and SKU attribute values are optional.**
>
> Category attribute configuration is **suggestions only**. Missing attributes must never block product/SKU creation, activation, barcode assignment, or future inventory usage.

Example: product **`FAN-PRIMER`** (پرایمر فانوما) may have **zero** attribute rows and still be valid:

```http
GET /api/v1/catalog/products/{id}/attributes
→ { "data": [] }
```

---

## Admin API ≠ Storefront

These routes are **admin/back-office** contracts (Persian UI, RBAC, company header). A future **Storefront API** will expose public catalog views (slugs, SEO, published assortment) with different shapes and auth. Do not assume admin list payloads are safe for public caching.

---

## Stats and identity helpers (Phase 1.7)

### `GET /catalog/stats`

Company-scoped **counts only**:

`brands`, `categories`, `products`, `skus`, `barcodes`, `attributes`

No stock, warehouse, valuation, or sales fields.

### `GET /catalog/skus/:skuId/identity`

Compact payload for scanner panels and integrations: SKU code/name/status, product ref, **primaryBarcode** (or null). No inventory.

---

## Resource map (`/api/v1/catalog/...`)

| Area | Endpoints |
| --- | --- |
| **Catalog** | `GET lookup`, `GET stats` |
| **Bulk** | `POST /bulk/preview`, `POST /bulk/execute`, `GET /bulk/:operationId` — see [catalog-bulk-operations.md](./catalog-bulk-operations.md) |
| **Brands** | `GET/POST`, `GET/PATCH :id`, `POST :id/activate\|deactivate\|archive` |
| **Categories** | `GET/POST`, tree helpers, `PATCH`, move, lifecycle |
| **Products** | `GET/POST`, `GET/PATCH :id`, lifecycle |
| **Product SKUs** | `GET/POST …/products/:productId/skus`, `POST …/bulk` |
| **SKUs** | `GET/POST`, `GET/PATCH :id`, `GET :id/identity`, lifecycle |
| **Variants** | `GET/POST …/variant-options`, values, lifecycle |
| **Barcodes** | `GET/POST …/skus/:skuId/barcodes`, `POST resolve`, lifecycle |
| **Attributes** | definitions, options, category suggestions, `GET/PUT …/products\|skus/:id/attributes` |

---

## Fanoma (فانوما) examples

Seeded company **Pishteh** (`slug: pishteh`) includes Fanoma (`brand` code `FAN`) products:

| Product code | Meaning | SKUs |
| --- | --- | --- |
| `FAN-SL` | رژ لب جامد فانوما (variant `رنگ`) | `FAN-SL-01` … `FAN-SL-18` |
| `FAN-PRIMER` | پرایمر فانوما (simple) | `FAN-PRIMER-01` |
| `FAN-SUN` | Sunscreen (attributes demo) | (see seed) |

**Search product by SKU code:**

```http
GET /api/v1/catalog/products?search=FAN-SL-02
X-Company-Id: {pishtehId}
```

**Search product by barcode** (EAN-13 on `FAN-SL-01`):

```http
GET /api/v1/catalog/products?search=6261000000016
```

**Resolve scan:**

```http
POST /api/v1/catalog/barcodes/resolve
{ "value": "6261000000016" }
→ sku.code FAN-SL-01, product.code FAN-SL
```

**Lookup typeahead:**

```http
GET /api/v1/catalog/lookup?search=FAN&limit=15
→ ranked hits (`type`: PRODUCT | SKU | BARCODE), tenant-scoped
```

**Primer with zero attributes:**

```http
GET /api/v1/catalog/products?search=FAN-PRIMER
GET /api/v1/catalog/products/{primerId}/attributes
→ data: []
```

---

## Errors

Validation (bad `pageSize`, unknown query fields with forbid whitelist) → **400** with structured `error.code`.

Catalog business rules use stable codes (`PRODUCT_NOT_FOUND`, `BARCODE_NOT_FOUND`, `SKU_CODE_ALREADY_EXISTS`, …). See API error catalog in application constants.

---

## Related docs

- [catalog-architecture.md](./catalog-architecture.md) — domain model, SKU vs product, barcode rules, attribute optionality
