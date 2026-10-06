# Purchase Dashboard (Phase 2.14)

Operational purchasing dashboard at `/app/purchasing` (same route as Purchasing overview — not a duplicate `/dashboard` path).

Server read model: `GET /api/v1/purchasing/dashboard`  
Lightweight counts remain on `GET /api/v1/purchasing/summary`.

---

## Metric dictionary

| Metric | Definition |
|---|---|
| **Open Purchase** | Status ∈ `APPROVED`, `ORDERED`, `PARTIALLY_RECEIVED`. Draft counted separately. `RECEIVED` / `CANCELLED` excluded. |
| **Committed Purchase** | Status ∈ `APPROVED`, `ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`. Used for period analytics. Excludes `DRAFT` and `CANCELLED`. |
| **Local Purchase Value** | For period (`orderDate`): IRR merchandise `subtotal` of `CASH` + `TERM_CREDIT` **plus** ACTIVE IRR costs on those same CASH/TERM POs. IRR courier costs on `FX_CREDIT` stay in `localPurchaseCostsByCurrency` only — never added into USD obligation or into local commercial value when viewing FX-only. Returns do **not** reduce this. |
| **Foreign Obligation** | `FX_CREDIT.obligationAmount` grouped by `obligationCurrency`. Currencies never summed. |
| **Reference Local FX Value** | `obligationAmount × referenceFxRate` when quote is IRR. **Reference only** — not settlement, not live FX. |
| **Upcoming Due** | Open POs with contractual `dueDate` in the due-soon window (today … +`PURCHASE_ORDER_DUE_SOON_DAYS`). Not “unpaid”. |
| **Past Due Date** | Open POs with contractual `dueDate` before today. Not “overdue payment”. |
| **Active Supplier (period)** | Distinct `supplierId` among committed POs in the selected `orderDate` range. |
| **Unfulfilled Purchase** | Phase 2 temporary: status ∈ `ORDERED`, `PARTIALLY_RECEIVED`. No received qty / %. Phase 3 Warehouse will replace with evidence-backed remaining qty. |

---

## Date semantics

| Concern | Date field |
|---|---|
| Period analytics (value, trend, supplier/type/currency mix, activity) | `PurchaseOrder.orderDate` |
| Due buckets | `dueDate` (absolute vs today) |
| Open / unfulfilled / attention | Current snapshot (not limited by analytics period) |

Previous equivalent period = same day-count immediately before the selected window (for local value / FX obligation comparison inputs).

Max range: **366 days**.

Default: **30 days**.

---

## Filters (URL)

```text
/app/purchasing?range=30d&supplierId=&purchaseType=&status=&currency=
/app/purchasing?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
```

All analytics sections share these filters. Operational sections respect supplier / type / currency / status and are labeled as current snapshot.

Supplier filter is tenant-checked (404 if supplier not in company).

---

## Purchase costs

Commercial local value = merchandise subtotal + ACTIVE costs **in the same currency** (IRR path).

FX obligation is never mixed with IRR courier/freight costs. Costs by currency are exposed separately in the API payload.

---

## Corrections & returns

- Dashboard uses **current canonical** PO amounts (post-correction). No double-count of pre/post correction.
- Approved Purchase Return does **not** subtract from purchase value (no stock/finance completion yet).

---

## Drilldowns

| Card / segment | Destination |
|---|---|
| Open purchases | PO list |
| Due soon | PO list `dueStatus=DUE_SOON` |
| FX / purchase type | PO list filtered by `purchaseType` |
| Supplier bar | Supplier detail |
| Attention row | PO or Return detail |

---

## Security & cache

- Requires `purchasing.read`
- Every query `companyId`-scoped
- React Query key: `purchasingKeys.dashboard(companyId, filters)`
- staleTime ~30s

---

## Phase 3 / 4 / 7 / 9

| Phase | Future dashboard enrichment |
|---|---|
| 3 Warehouse | Received / remaining qty, fulfillment, physical return execution |
| 4 Finance | Payable, paid, cash need, FX settlement, supplier balance |
| 7 Profit | COGS / margin / landed cost |
| 9 Intelligence | What/when/how much to buy |

Do not invent those facts in Phase 2.14.

---

## Performance notes

- Aggregations use Prisma `groupBy` / `count` / bounded `findMany` (list caps ~12–40).
- Trend buckets computed from period PO rows (bounded by max 366-day window).
- Existing indexes: `companyId+status`, `companyId+orderDate`, `companyId+supplierId+orderDate`, `companyId+dueDate`, `companyId+purchaseType+dueDate`.

Future scale options (not implemented): materialized views, cached aggregates, warehouse analytics DB.
