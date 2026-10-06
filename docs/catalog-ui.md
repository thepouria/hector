# Catalog UI (Phase 1.8)

Hector’s **Catalog workspace** is the daily operational surface for product identity: brands, categories, products, variant options, SKUs, barcodes, and optional specifications.

It does **not** own inventory quantity, warehouse location, purchasing, sales, pricing, finance, or marketplace listings. Those modules will consume Catalog identity later.

Related docs: [catalog-architecture.md](./catalog-architecture.md), [catalog-api.md](./catalog-api.md).

---

## Navigation

```text
کاتالوگ
├── نمای کلی          /app/catalog
├── محصولات           /app/catalog/products   (primary daily entry)
├── SKUها             /app/catalog/skus
├── دسته‌بندی‌ها       /app/catalog/categories
├── برندها            /app/catalog/brands
└── مشخصات محصولات    /app/catalog/attributes
```

Barcode scan test remains at `/app/catalog/barcodes/scan` (reachable from the Catalog landing) and is **not** a top-level nav item.

Variant options are managed **on the Product detail** (product-scoped). Product attributes (مشخصات) are company definitions under Catalog settings/nav; values stay optional.

---

## Routes

| Route | Purpose |
| --- | --- |
| `/app/catalog` | Lightweight landing: stats + lookup + section links |
| `/app/catalog/products` | Product list (URL state) + create/edit dialogs |
| `/app/catalog/products/:id` | Product workspace: overview, specs, variants, SKUs |
| `/app/catalog/skus` | Global SKU list (URL state) |
| `/app/catalog/skus/:id` | SKU detail: identity, variants, barcodes, SKU specs |
| `/app/catalog/skus/:id/barcodes/print` | Barcode print view |
| `/app/catalog/brands` | Brand CRUD |
| `/app/catalog/categories` | Category tree + suggested attributes |
| `/app/catalog/attributes` | Attribute definition manager |
| `/app/catalog/attributes/:id` | Attribute detail + options |
| `/app/catalog/barcodes/scan` | Scanner/keyboard-wedge resolve test |

---

## Permissions

| Permission | UI behavior |
| --- | --- |
| `catalog.read` | View, search, filter, navigate. Mutation controls hidden. |
| `catalog.manage` | Create, edit, lifecycle, barcodes, attributes, variants. |

Backend remains authoritative. `403` is handled with AccessDenied / toast mapping — never rely on hidden buttons for security.

---

## Product flow

1. **List** — server search (`q`), filters (brand, category, status), sort, pagination in URL.
2. **Create** — core fields only (name, optional code/brand/category). Optional specifications collapsed; **values are never required**.
3. **Success** — redirect to Product detail (next action: add SKU).
4. **Detail** — overview (incl. API `skuCount` / `activeSkuCount`), specifications, variant options, paginated SKUs.
5. **Lifecycle** — activate / deactivate / archive via ConfirmDialog (no `window.confirm`).

---

## SKU flow

1. Create from Product detail (or bulk generator when variant options exist).
2. Global list at `/app/catalog/skus` for operational lookup (code, product, barcode).
3. Detail shows identity, readable variant combination (not raw IDs), barcodes, optional SKU attributes.

---

## Barcode flow

- Managed primarily on **SKU detail**.
- `BarcodeScanInput` accepts manual typing and USB keyboard-wedge scanners (characters + Enter). No hardware SDK.
- Primary barcode badge; archive (soft); duplicate → mapped `BARCODE_ALREADY_EXISTS` message.
- Internal barcode generation when supported by API.

### Scanner behavior (for future Warehouse reuse)

```text
USB scanner
→ OS keyboard input
→ barcode characters into focused input
→ Enter
→ submit / resolve
```

---

## Category flow

- Hierarchical tree: expand / collapse / select / edit / add child.
- Search reveals matching node with path (`آرایشی / لب / رژ لب`).
- **Suggested attributes** are optional: UI copy states they are suggestions, not required fields.

---

## Attribute flow

- Definitions: TEXT, NUMBER, BOOLEAN, SINGLE_SELECT, MULTI_SELECT.
- Scope labels: محصول / SKU / محصول و SKU.
- Options editor for select types.
- Product/SKU values: optional; BOOLEAN three-state (نامشخص / بله / خیر); multi-select allows zero selections.
- Clearing all values is valid.

### Critical optionality invariant

```text
All Product/SKU Attribute values remain optional.
Category suggested Attributes never force completion.
Product/SKU with 0 Attributes is a normal success path.
```

---

## Search & lookup

- List pages: backend `search` / filters only (debounced ~300ms). No client-only page filtering.
- Landing `CatalogLookup`: `GET /catalog/lookup` — products, SKUs, barcodes; keyboard ↑↓ Enter Escape.
- Exact barcode hits surface the matching SKU quickly.

---

## URL state

Product and SKU lists persist in the query string:

```text
q, page, pageSize, status, brand, category, product, hasBarcode, sort, order
```

Benefits: refresh-safe, shareable, browser back/forward restores list context.

Parsers live in `apps/web/src/features/catalog/catalog-list-params.ts` (unit-tested). Invalid values fall back to defaults so hand-edited URLs cannot loop on API 400s.

---

## Query / cache

- All Catalog React Query keys include **companyId** (`productKeys`, `skuKeys`, `catalogKeys`, …).
- Company switch: new company identity in keys → previous tenant data does not render under the new company; late responses for the old key do not overwrite the active query.
- Mutations invalidate relevant Catalog keys (product list/detail, SKU lists, stats) — not the entire app cache.

---

## Domain boundary (UI)

Catalog UI must **not** display:

```text
Inventory quantity · Warehouse location · Purchase cost · Sale price · Sales volume · Profit
```

Placeholder “—” for stock/price is forbidden until those domains exist.

---

## RTL / identifiers

- Chrome and tables are RTL (Persian).
- SKU codes, barcodes, and product codes render LTR (`dir="ltr"`, mono) inside RTL layout.
- Copy actions preserve exact identifier strings.

---

## Architecture (web)

```text
apps/web/src/features/catalog/     feature pages & helpers
apps/web/src/components/catalog/   BarcodeScanInput, glyphs
apps/web/src/app/(app)/app/catalog/  Next.js routes
```

Shared list chrome: `catalog-list-chrome.tsx`, `use-catalog-list-params.ts`.
API client: `fetchProducts` / `fetchSkus` / `fetchCatalogLookup` / `fetchCatalogStats` in `lib/api/hector.ts`.
