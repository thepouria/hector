# Warehouse UI (Phase 3.16–3.17)

Operational Next.js UI for Hector Warehouse. Presentation and orchestration only — inventory truth stays on the API/domain.

---

## Navigation (عملیات)

```text
داشبورد انبار          /app/warehouse/dashboard
مرکز اسکنر             /app/warehouse/scanner
موجودی فیزیکی          /app/warehouse/inventory
رسید کالا              /app/warehouse/goods-receipts
جایگذاری               /app/warehouse/putaways
انتقال داخلی           /app/warehouse/transfers
خروج غیرفروشی          /app/warehouse/issues
تعدیل موجودی           /app/warehouse/adjustments
شمارش موجودی           /app/warehouse/counts
برگشت به تأمین‌کننده   /app/warehouse/supplier-returns
رزرو موجودی            /app/warehouse/reservations
حرکات انبار            /app/warehouse/inventory/movements
انبارها                /app/warehouse
بچ / سری ساخت          /app/warehouse/batches
لایه‌های بهای تمام‌شده  /app/warehouse/cost-layers
ارزش‌گذاری موجودی      /app/warehouse/valuation
```

Setup (warehouses/locations) remains under warehouse master + location pages. Cost & valuation items are permission-gated.

---

## Dashboard

- Operational cards: SKUs with stock, units, sellable / reserved / available, tester / damaged / quarantine.
- Open queues: draft receipts, putaways, transfers, counts, issues, supplier return executions.
- Optional valuation summary when `warehouse.valuation.read`.
- Cards link to filtered list pages where applicable.
- No reorder intelligence / forecasting.

---

## Stock UX

- List + SKU drilldown show **On Hand**, **Sellable**, **Reserved**, **Available**, and non-sellable classes distinctly.
- Available = Sellable On Hand − Active Reserved (server authoritative).
- No “Edit On Hand” / overwrite control. Corrections via Adjustment or Stock Count.
- Movements linked from positions (pre-filtered).

---

## Document UX

Operational documents use:

- Explicit lifecycle actions (`Post Receipt`, `Complete Transfer`, `Issue Stock`, `Approve Count`, `Dispatch Return`, …).
- Confirm dialogs for physical mutations.
- Read-only rendering when posted/completed/immutable.
- Deep links: `/app/warehouse/{receipts|transfers|counts|issues|…}/:id`.

Partial PO receiving uses backend progress projection (ordered / previously received / current / remaining).

---

## Query / cache

- All warehouse React Query keys include `companyId` via `warehouseKeys.*`.
- Company switch clears scanner context and invalidates company-scoped caches (session provider + page effects).
- Optimistic updates for physical inventory mutations are avoided; server confirmation wins.
- After mutations, invalidate related keys only (document + stock + movements + queues as needed).

---

## UI invariants

| ID | Rule |
|---|---|
| WH-UI-001 | Company switch cannot leave stale Warehouse data/context |
| WH-UI-002 | All Warehouse query keys are Company-aware |
| WH-UI-003 | Posted/completed immutable documents are read-only |
| WH-UI-004 | UI never exposes direct On Hand editing |
| WH-UI-005 | SELLABLE / TESTER / DAMAGED / QUARANTINE remain visually distinct |
| WH-UI-006 | On Hand / Reserved / Available remain distinct |
| WH-UI-007 | Sensitive valuation data is permission-gated |
| WH-UI-008 | Physical mutations require server confirmation before success |
| WH-UI-009 | Domain errors are actionable operational messages |
| WH-UI-010 | Source documents remain traceable through UI |

---

## RTL / responsive

- App shell is Persian/RTL.
- Technical codes (SKU, barcode, location) use `dir="ltr"` / mono.
- Scanner workspace prioritizes tablet / mobile-width devices.
- Quantities use tabular nums; barcodes never get monetary formatting.

---

## Related

- `docs/scanner-ux.md`
- `docs/warehouse-api.md`
