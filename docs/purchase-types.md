# Purchase Types (Phase 2.5)

Hector Purchase Orders record **what kind of commercial obligation** the company agreed to.
This phase does **not** implement payments, Accounts Payable, cash/bank balances, FX wallets,
settlement transactions, Warehouse, or Inventory.

Lifecycle verbs (Phase 2.9 — `docs/purchase-lifecycle.md`):

```text
DRAFT → APPROVED → ORDERED
         ↘ CANCELLED ↙
```

Informal product language only: approve ≈ “submit for internal approval”; order ≈ “confirm with supplier”. Status names remain `APPROVED` / `ORDERED` (Hector never used `SUBMITTED` / `CONFIRMED`).

---

## Purchase types

| Type | Persian UI | Meaning |
|---|---|---|
| `CASH` | نقدی | Priced and intended for immediate/cash settlement in the PO currency |
| `TERM_CREDIT` | اعتباری ریالی | Fixed obligation in PO currency; settlement due later per credit terms |
| `FX_CREDIT` | اعتباری ارزی | Payable obligation denominated in foreign currency |

Ownership:

```text
purchaseType belongs to PurchaseOrder
≠ Supplier Master default
```

One PO = one purchase type. Materially different obligations → separate POs.

---

## Field model (on `PurchaseOrder`)

| Field | Role |
|---|---|
| `purchaseType` | Commercial mode |
| `currency` | PO / line pricing currency |
| `paymentTermType` | `IMMEDIATE` / `NET_DAYS` / `FIXED_DATE` (Phase 2.7) |
| `netDays` | Credit days when `NET_DAYS` (architecture name for “termDays”) |
| `termBasis` | Calendar basis for due date — currently only `ORDER_DATE` |
| `dueDate` | Commercial due date (`NET_DAYS` server-computed; `FIXED_DATE` explicit) |
| `paymentTermsNote` | Optional descriptive note (not structured authority) |
| `obligationAmount` / `obligationCurrency` | Authoritative FX foreign obligation (`FX_CREDIT` only) |
| `referenceFxRate` + base/quote currencies | Historical reference FX pair (not settlement) |
| `referenceFxRateAt` | Optional when the reference rate was agreed (Phase 2.6) |

Null means “not applicable / not recorded for this type”, never “zero days”.

Credit terms detail, due status, calendar/timezone policy: `docs/credit-terms.md` (Phase 2.7).

FX detail (MODEL A, valuation, Toman/IRR, future settlement): see `docs/fx-purchases.md` (Phase 2.6).

---

## CASH

Valid confirmed shape:

```text
purchaseType = CASH
paymentTermType = IMMEDIATE
netDays / dueDate / FX obligation / reference FX = null
```

Critical invariants:

```text
CASH = commercial settlement mode
CASH ≠ proof of payment
CASH confirmation does NOT mutate cash/bank, create payments, or touch stock
```

---

## TERM_CREDIT

- Obligation = PO `total` in PO `currency` (fixed local/commercial amount).
- Requires `netDays > 0` before APPROVED/ORDERED.
- `termBasis = ORDER_DATE`.
- `dueDate = UTC calendar date(orderDate) + netDays` (stored at UTC noon).

Example:

```text
orderDate 2026-10-03
netDays 10
dueDate 2026-10-13
```

Future FX movement does **not** change a TERM_CREDIT IRR/USD-PO-currency obligation.

---

## FX_CREDIT

Authoritative fact:

```text
obligationAmount + obligationCurrency
```

Phase 2.5 derivation:

- Line unit prices are in the foreign PO currency.
- On approve/mark-ordered, `obligationAmount = total` and `obligationCurrency = currency`.
- Never derive obligation as `localTotal / fxRate` unless that becomes an explicit contractual rule later.

Reference FX:

- Required before APPROVED/ORDERED.
- Must include positive `referenceFxRate` + distinct base/quote pair.
- `referenceFxBaseCurrency` must equal the obligation / PO currency.
- Canonical storage: IRR rials (UI Toman × 10). Example: UI `205,000 Toman/USD` → `2,050,000 IRR/USD`.

```text
referenceFxRate ≠ future settlementFxRate
```

No FX gain/loss, wallets, or partial settlements in Purchasing.

Optional credit timing: FX_CREDIT may use `NET_DAYS` + `dueDate` (same ORDER_DATE basis).

---

## Draft vs complete validation

| Status | Completeness |
|---|---|
| `DRAFT` | May omit `netDays` / reference FX while editing |
| `APPROVED` / `ORDERED` | Type-specific terms must be complete (re-validated) |

Changing purchase type in Draft clears incompatible fields (`clearedTermsForType`).

After ORDERED (and commercial lock from APPROVED for type fields), PATCH cannot mutate:

```text
purchaseType, currency, netDays, dueDate, obligation*, referenceFx*
```

Amendments are out of scope.

---

## Quote → PO

Supplier Offer may carry suggested `purchaseType` / `netDays` / reference FX.
Creating or copying into a Draft PO snapshots suggestions only.
PO terms are authoritative; Offer remains unchanged when the Draft is renegotiated.

---

## Source-of-truth matrix

| Concept | Authority |
|---|---|
| Purchase mode | Purchase Order |
| CASH commercial amount | Purchase Order (`total` + `currency`) |
| TERM_CREDIT fixed amount | Purchase Order (`total` + `currency`) |
| TERM_CREDIT terms / due date | Purchase Order |
| FX foreign obligation | Purchase Order (`obligationAmount` + `obligationCurrency`) |
| FX reference rate at purchase | Purchase Order |
| Actual FX settlement rate | Future Finance |
| Amount actually paid | Future Finance |
| Remaining payable | Future Finance (derived; not mutable `remainingAmount` on PO) |
| Cash/bank / USD balance | Future Finance |
| Received stock | Future Warehouse |

---

## API / UI notes

- Money fields serialize as **strings**.
- Status still only via `approve` / `mark-ordered` / `cancel`.
- UI labels: نوع خرید → نقدی / اعتباری ریالی / اعتباری ارزی.
- FX detail prioritizes foreign obligation; reference valuation is labeled as analysis only.

---

## Future Finance compatibility (not implemented)

A confirmed FX_CREDIT PO of `1,000 USD` at reference `205k Toman/USD` must later support payments at other rates without mutating the original obligation. Remaining payable is derived by Finance, not stored as a mutable PO field.

Partner capital (60/40) and budgets are out of Purchasing scope.
