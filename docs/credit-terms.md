# Credit Terms + Due Dates (Phase 2.7)

Purchasing models the **commercial settlement agreement**: when a purchase is contractually due.
This phase does **not** implement payments, Accounts Payable, paid/partially paid state, remaining
balance, bank/cash movements, or supplier settlements. Those belong to Finance.

```text
Payment Terms  ≠  Due Date  ≠  Payment
```

```text
DUE      ≠  UNPAID
OVERDUE  ≠  SUPPLIER BALANCE
```

Purchasing only knows: according to the commercial agreement, the PO has reached/passed its due date.
Only future Finance knows whether money is still owed.

Architecture authority: `docs/purchasing-architecture.md`. Purchase types: `docs/purchase-types.md`.
FX: `docs/fx-purchases.md`. PO lifecycle: `docs/purchase-orders.md`.

---

## PaymentTermType

| Type | Meaning | Authoritative inputs | `dueDate` |
|---|---|---|---|
| `IMMEDIATE` | No deferred credit | — | `null` |
| `NET_DAYS` | N calendar days from an explicit basis | `netDays`, `termBasis`, reference date | **Server-calculated** |
| `FIXED_DATE` | Explicit negotiated calendar due date | client `dueDate` | **Client-agreed**, server-validated |

Do **not** model CASH as `netDays = 0`. Use `IMMEDIATE` with null term fields.

Field name note: schema uses `netDays` for the architecture concept “term days”.

---

## Term basis (`PurchaseTermBasis`)

| Basis | Phase 2.7 |
|---|---|
| `ORDER_DATE` | Supported — due = UTC calendar day of `orderDate` + `netDays` |
| `INVOICE_DATE` | Not implemented (no trustworthy supplier invoice date yet) |
| `GOODS_RECEIPT_DATE` | Not implemented (Warehouse does not exist) |

Enum is extensible later without redesigning POs. Unresolved bases must not be selectable now.

---

## Calendar-day policy

NET_DAYS uses **UTC calendar days**, not business days.

```text
orderDate = 2026-10-03
netDays   = 10
termBasis = ORDER_DATE
→ dueDate = 2026-10-13
```

Not implemented: weekend exclusion, Iran holidays, bank holidays, business-day calendars.

---

## Date / timezone strategy

- Due dates are **business calendar dates**.
- Stored as `Timestamptz` normalized to **UTC noon** for that calendar day (`YYYY-MM-DDT12:00:00.000Z`).
- API exposes ISO strings; the calendar day key (`YYYY-MM-DD` via UTC components) must not shift across serialization.
- DB/API authority is Gregorian/ISO. UI may display Jalali; Jalali strings are never stored as authority.

Application “today” for derived due status is the UTC calendar day of `new Date()` at query time
(no company timezone service yet). Policy is deterministic across servers.

---

## Due-date calculation

Centralized in `purchase-order-terms.ts` / `purchase-order-due.ts`:

```text
NET_DAYS  → calculateDueDateFromOrderDate(orderDate, netDays)
FIXED_DATE → parseUtcBusinessDate(client dueDate); reject if < orderDate calendar day
IMMEDIATE → dueDate = null
```

Backend recalculates/validates independently. Clients must not override NET_DAYS `dueDate`.
UI may preview; server remains authority.

---

## Due status (derived)

```text
NO_DUE_DATE | UPCOMING | DUE_SOON | DUE_TODAY | OVERDUE
```

- Computed at query/response time from `dueDate` + current UTC business date.
- **Not persisted.** Do not audit status transitions caused only by time.
- Default soon threshold: `PURCHASE_ORDER_DUE_SOON_DAYS = 3` (central constant).

| Relation of due day to today | Status |
|---|---|
| no due date | `NO_DUE_DATE` |
| > 3 days ahead | `UPCOMING` |
| 1–3 days ahead | `DUE_SOON` |
| same day | `DUE_TODAY` |
| past | `OVERDUE` |

Persian list badges: آینده / نزدیک سررسید / امروز / گذشته از سررسید — never «پرداخت نشده».

`OVERDUE` means the contractual due calendar day has passed. It does **not** mean confirmed unpaid debt.

No cron job mutates due status. No `PurchaseOrderOverdue` domain event in 2.7.

---

## Integration by purchase type

### CASH

```text
paymentTermType = IMMEDIATE
netDays / termBasis / dueDate = null
```

UI: شرایط پرداخت = نقدی / فوری. No due date required.

### TERM_CREDIT

```text
NET_DAYS  → netDays > 0, termBasis = ORDER_DATE, dueDate calculated
FIXED_DATE → dueDate set, netDays / termBasis = null
```

### FX_CREDIT

Same credit-term model. Payment terms do **not** alter foreign `obligationAmount` / currency.
Reference FX rate remains independent of due date.

---

## Draft editing vs confirmed freeze

While `DRAFT`:

- Change `netDays`, `orderDate`, `paymentTermType`, `dueDate` (FIXED_DATE), `paymentTermsNote`.
- NET_DAYS due date recalculates when `netDays` or `orderDate` changes.
- Type switches clear incompatible fields (`TERM_CREDIT → CASH` clears deferred terms).

After `APPROVED` / `ORDERED` (commercial freeze via mark-ordered snapshots):

- Generic PATCH cannot change `paymentTermType`, `netDays`, `termBasis`, `dueDate`.
- Future renegotiation = PO amendment (not in 2.7).

---

## Validation (approve / mark-ordered = complete)

| Shape | Rule |
|---|---|
| CASH + IMMEDIATE | no netDays / dueDate |
| CASH + NET_DAYS | reject |
| NET_DAYS | integer `netDays` in `1…3650`, basis resolvable, dueDate server-set |
| FIXED_DATE | `dueDate` required; no netDays/termBasis; dueDate ≥ orderDate calendar day |
| NET_DAYS client dueDate | reject |
| Fractional / zero / negative days | reject |

`paymentTermsNote` is optional descriptive text only — never structured authority for day counts.

---

## Supplier Offer → PO

Offer may suggest terms (`paymentTermType`, `netDays`). Creating a PO from an offer copies initial values;
the PO then owns its commercial snapshot. Changing the offer later must not mutate PO terms/due date.

---

## API

List filters (company-scoped):

```text
dueFrom, dueTo, dueStatus, paymentTermType
```

Responses include flat fields plus derived `dueStatus`. Index: `(companyId, dueDate)` (and purchase-type composite) for due-window queries.

Do not sum mixed currencies for “total due” dashboards in Purchasing.

---

## Source of truth

| Concept | Authority |
|---|---|
| Payment term agreement | Purchase Order |
| Term type / days / basis | Purchase Order |
| Contractual due date | Purchase Order |
| Due status | Derived (`dueDate` + current date) |
| Supplier default / offer terms | Supplier / Offer (hints only) |
| Final negotiated terms | Purchase Order |
| Actual payment / amount paid / remaining payable | Future Finance |
| True unpaid overdue balance | Future Finance |
| FX liability | Purchase Order |
| Settlement FX | Future Finance |

---

## Finance boundary (future)

Later Finance may combine Purchasing due status with payment allocations to derive:

```text
OPEN | PARTIALLY_PAID | PAID | OVERDUE_PAYABLE
```

Example: PO due Oct 13, paid Oct 10 → Purchasing may still show OVERDUE after Oct 13 by calendar,
while Finance shows remaining payable = 0. Do not couple those concepts in Phase 2.7.

Partial payment and FX settlement must not mutate original PO total, payment terms, or due date.

Reminders (3 days before / due today / overdue) are future Notifications — not built here.

---

## Seed examples

- CASH / IMMEDIATE / no due date
- TERM_CREDIT 10-day and 30-day NET_DAYS + ORDER_DATE
- TERM_CREDIT FIXED_DATE (2026-11-15)
- FX_CREDIT 1,000 USD + 30-day NET_DAYS

Seed is idempotent on re-run.
