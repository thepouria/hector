# Purchasing UI (Phase 2.13–2.14)

Operational Purchasing workspace in `apps/web` for Hector.

Backend authority: Phase 2.12 API + Phase 2.14 dashboard + Phase 2.15 audit/events (`docs/purchasing-api.md`, `docs/purchase-dashboard.md`, `docs/purchasing-audit.md`, `docs/purchasing-events.md`). The UI never invents lifecycle, stock, or payment truth.

---

## Navigation

Under **خرید**:

| Item | Route |
|---|---|
| داشبورد خرید (default) | `/app/purchasing` |
| تأمین‌کنندگان | `/app/purchasing/suppliers` |
| استعلام قیمت | `/app/purchasing/offers` |
| سفارش‌های خرید | `/app/purchasing/orders` |
| برگشت به تأمین‌کننده | `/app/purchasing/returns` |

Visible when the member has `purchasing.read`. Mutations use finer permissions (`purchasing.create`, `purchasing.approve`, `purchasing.po.correct`, …).

---

## Purchase Dashboard (default `/app/purchasing`)

Loads `GET /purchasing/dashboard` (not a client-side aggregation of all POs).

- URL filters: `range` (default `30d`), `from`/`to`, `supplierId`, `purchaseType`, `status`, `currency`
- KPI cards: open / local IRR commercial value / FX obligation by currency / due soon / active suppliers
- **نیازمند توجه**, open purchases, due buckets, unfulfilled (Phase 2 status-based), trend, supplier mix, type/currency mix, recent activity
- Draft counted separately; cancelled excluded from committed totals
- Drilldowns to PO list / supplier / return detail
- Query key includes `companyId` + filters; staleTime ~30s

Charts are lightweight CSS/SVG (no heavy chart dependency). RTL-safe labels.

No company profit, cash, inventory value, Buy Box, or settlement KPIs.

---

## Suppliers

List + search + status filter + create/edit + contacts on detail.

Related offers/purchases are linked from supplier detail; no fake performance scores.

---

## Supplier Offers

Fast price capture for Ahmad:

- List / filter / compare by SKU
- Create offer with **ثبت و افزودن قیمت بعدی**
- Validity states: current / expired / archived (backend-derived)
- Objective label for lowest recorded price — never “best supplier”
- Optional drill into PO create with supplier/SKU context where links exist

---

## Purchase Orders

### List

`/app/purchasing/orders` — server filters/sort/pagination.

URL query state (shareable):

```text
?status=ORDERED&dueStatus=DUE_SOON&purchaseType=FX_CREDIT&currency=USD
```

### Creation

`/app/purchasing/orders/new` — full page (not modal):

1. Supplier (searchable; inactive blocked by API)
2. Purchase type (`CASH` / `TERM_CREDIT` / `FX_CREDIT`)
3. Items (Catalog SKU search, offer assist, no silent price overwrite)
4. Commercial terms (type-gated fields)
5. Save **DRAFT**

Purchase costs are added on PO detail via dedicated cost endpoints (create DTO has no costs array).

### Detail

Lifecycle actions from `availableActions` + permissions:

- Edit draft / limited post-commit notes
- Approve / Order / Cancel (confirmations)
- Costs
- **اصلاح خرید** (committed) — before/after + reason
- **مغایرت‌ها** / short-close
- **فعالیت‌ها** — business timeline from `GET …/activity` (Audit projection; Persian summaries). Raw technical audit remains Settings Audit (`audit.read`).
- Link to create purchase return
- Warehouse placeholder on ORDERED — no receive UI

---

## Purchase Types

| Type | UI |
|---|---|
| `CASH` | نقدی — no FX/term fields |
| `FX_CREDIT` | اعتباری ارزی — obligation currency + reference rate; reference IRR is **not** final settlement |
| `TERM_CREDIT` | اعتباری مدت‌دار — net days / fixed due + due preview |

---

## PO Lifecycle (UI)

```text
Supplier → Offer (optional) → PO Draft → Approved → Ordered → Phase 3 Warehouse
```

Create does not auto-approve. Approve does not auto-order.

---

## Corrections

```text
Committed PO → اصلاح خرید → before/after + reason → server validates → updated PO + history
```

Draft uses normal edit. Committed commercial fields use correction commands only.

---

## Discrepancies

Recorded on PO as purchasing facts (`BEFORE_RECEIPT` supported in UI). Not Warehouse receipt. Not Purchase Return. Not Correction.

Short-close: ordered quantity unchanged; unfulfilled remainder closed.

---

## Purchase Returns

```text
Return Draft → Approved → STOP in Purchasing
→ Phase 3 Warehouse physical return
→ Phase 4 Finance money resolution
```

UI warning on list/create/detail: approve ≠ stock out / refund / payable change.

Routes:

- `/app/purchasing/returns`
- `/app/purchasing/returns/new`
- `/app/purchasing/returns/:id`

---

## Permissions

Permission keys only — never `user.role === 'ADMIN'`.

| Capability | Permission |
|---|---|
| View | `purchasing.read` |
| Create draft PO/offer/supplier | `purchasing.create` / manage variants |
| Approve / order | `purchasing.approve` / `purchasing.manage` |
| Correct | `purchasing.po.correct` |
| Short-close | `purchasing.po.short_close` |
| Discrepancy | `purchasing.discrepancy.manage` |
| Return create/approve/cancel | `purchasing.return.*` |

---

## Company Switching

All React Query keys include `companyId` (`purchasingKeys`, `purchaseOrderKeys`, `purchaseReturnKeys`, …).

Company switch replaces active company context; previous company lists/details must not reuse the same key.

---

## Query Keys

```ts
purchasingKeys.summary(companyId)
purchaseOrderKeys.list(companyId, filters)
purchaseOrderKeys.detail(companyId, id)
purchaseOrderKeys.corrections(companyId, id)
purchaseOrderKeys.discrepancies(companyId, id)
purchaseReturnKeys.list(companyId, filters)
purchaseReturnKeys.detail(companyId, id)
```

Lifecycle mutations invalidate the affected detail/list + summary — not the entire app cache.

Optimistic updates are avoided for approve/order/cancel/correct/return approve.

---

## Error Handling

Known codes mapped in `mapBusinessError` (Persian), including:

- `PURCHASE_ORDER_NOT_EDITABLE`
- `PURCHASE_ORDER_VERSION_CONFLICT`
- `PURCHASE_CORRECTION_*`
- `PURCHASE_SHORT_CLOSE_*`
- `PURCHASE_RETURN_*`
- `SUPPLIER_INACTIVE`

Version conflicts ask the user to refresh.

---

## RTL / Responsive

Primary UI Persian + `dir=rtl` app shell.

Desktop-first (1280+/1440+); tables scroll horizontally on narrower widths; filters wrap.

---

## Warehouse Boundary

No receive, scan, bin/shelf, stock movement, or mark-as-received controls.

ORDERED shows informational copy that physical receipt is Warehouse.

---

## Finance Boundary

Due date = contractual purchase due date.

No unpaid / paid / supplier balance / payment / refund UI.

---

## Known Limitations

- Costs on create: add after draft on detail (API create has no nested costs).
- Commercial-term correction UI currently focuses on item quantity/price; FX/term field corrections can be extended later via the same API.
- List pages do not prefetch thousands of SKUs/suppliers — remote search only.
- Jalali display follows existing formatters; API timestamps remain ISO/canonical.

---

## UX Workflow Summary

```text
Supplier
↓
Offer (market price log)
↓
Purchase Order Draft
↓
Approved (commercial lock → corrections thereafter)
↓
Ordered
↓
Phase 3 Warehouse receives / executes returns
```
