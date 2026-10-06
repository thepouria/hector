# FX Purchases (Phase 2.6)

Purchasing-side semantics for **foreign-currency credit purchases** (`purchaseType = FX_CREDIT`).
This phase does **not** implement payments, AP ledger, bank/cash, FX wallets, settlement,
gain/loss, Warehouse, or Inventory.

Related docs: `docs/purchase-types.md`, `docs/purchase-orders.md`, `docs/purchasing-architecture.md`.

---

## Core invariant

```text
FX LIABILITY  ≠  LOCAL CURRENCY LIABILITY
```

Example (mandatory scenario):

```text
Purchase:
  liability            = 1,000 USD
  reference            = 205,000 Toman / USD
  reference valuation  = 205,000,000 Toman

Later market:
  USD = 235,000 Toman

Hector Purchasing still reports:
  Original foreign liability = 1,000 USD
  Reference purchase rate    = 205,000 Toman / USD
```

Future settlement valuation (`235,000,000 Toman`) belongs to Finance — never mutates the PO.

---

## Three separate concepts

| Concept | Phase | Authority |
|---|---|---|
| **A. Foreign obligation** (`obligationAmount` + `obligationCurrency`) | 2.6 | Purchase Order (authoritative) |
| **B. Purchase reference valuation** (`obligation × referenceFxRate`) | 2.6 | Derived server-side from PO |
| **C. Future settlement valuation** | Finance | Not stored on PO |

Never collapse A and B into one amount. Never store C on the PO.

---

## Pricing model (MODEL A)

```text
PO currency = obligation currency
Line unit prices are in the foreign currency
obligationAmount = PO.total (synced on approve / item mutations)
```

Example:

```text
SKU A  500 × 0.40 USD
SKU B 1000 × 0.80 USD
→ PO total = 1,000 USD = foreign obligation
```

Do **not** reverse-derive liability from `referenceLocalValuation / referenceFxRate`
(rounding, fees, negotiated amounts make that unsafe).

---

## FX terms on PurchaseOrder

| Field | Meaning |
|---|---|
| `obligationAmount` | Foreign principal (Decimal string in API) |
| `obligationCurrency` | Currency of that principal (equals PO `currency`) |
| `referenceFxRate` | Historical rate at purchase agreement |
| `referenceFxBaseCurrency` | Usually = obligation currency (USD) |
| `referenceFxQuoteCurrency` | Local quote (IRR in Hector) |
| `referenceFxRateAt` | Optional timestamp when the rate was agreed |
| `netDays` / `dueDate` / `termBasis` | Same credit-term model as Phase 2.7 (`docs/credit-terms.md`) |
| `settlementBasis` | API constant `FOREIGN_OBLIGATION` (not a payment status) |
| `referenceLocalValuation` | **Derived** (not persisted, not client-authored) |

Conceptual settlement basis:

```text
settlementBasis = FOREIGN_OBLIGATION
```

Finance must settle remaining **foreign** obligation. Do not treat reference local valuation as the payable.

---

## FX pair convention

Never store a naked rate. Always store:

```text
baseCurrency / quoteCurrency / rate
```

Hector example (canonical storage is **IRR**):

```text
UI:   205,000 Toman / USD
DB:   referenceFxRate = 2,050,000   (IRR per 1 USD)
      base = USD
      quote = IRR
```

`10×` errors between Toman and IRR are a product bug — UI converts via existing money helpers;
API/DB use IRR.

---

## Reference local valuation

```text
referenceLocalValuation = obligationAmount × referenceFxRate
```

- Computed with Prisma `Decimal` (never JS `Number` for authority).
- IRR quote amounts round **HALF_UP** to whole rials (scale 0).
- FX rate max **8** decimal places (`Decimal(24,8)`).
- Obligation amounts use currency-aware money parsing (`Decimal(24,6)`).
- **Decision:** valuation is **derived**, not persisted. After confirmation, obligation + rate are immutable, so the snapshot is reproducible.

---

## Immutability after confirm

Lifecycle: `approve` ≈ submit, `mark-ordered` ≈ confirm (commercial freeze from APPROVED).

Once commercially locked:

```text
obligationAmount / obligationCurrency
referenceFxRate / FX pair / referenceFxRateAt
purchaseType / netDays / dueDate
```

cannot change via normal PATCH. Market FX movement must never rewrite purchase-time rate.

---

## Draft vs submit

| Stage | Policy |
|---|---|
| DRAFT | Incomplete FX fields allowed (e.g. type selected, rate not yet entered) |
| APPROVED / ORDERED | Revalidated: positive total, complete FX pair, base = obligation currency, terms valid |

Type change `FX_CREDIT → CASH` (Draft) clears stale FX fields via `clearedTermsForType`.

CASH / TERM_CREDIT reject FX-only fields.

---

## Future Finance compatibility (not implemented)

Without changing PO principal, Finance may later record:

```text
Settlement 1: 400 USD @ 225k
Settlement 2: 300 USD @ 230k
Settlement 3: 300 USD @ 235k
```

or pay `1,000 USD` directly from a USD account (no local conversion).

Remaining liability is **derived** by Finance:

```text
remaining = original obligation − settled foreign amounts ± adjustments
```

Do **not** store mutable `remainingUsd` / `currentSettlementAmount` / `UNPAID|PAID` on the PO.

FX gain/loss compares reference valuation vs actual settlement valuations — Finance only.

---

## Source-of-truth matrix

| Fact | Authority |
|---|---|
| Purchase type | Purchase Order |
| Original foreign liability | Purchase Order |
| Foreign liability currency | Purchase Order |
| Reference FX at purchase | Purchase Order |
| Reference local valuation | Derived from PO |
| Supplier quoted FX | Supplier Offer |
| Current market FX | Future FX / Finance |
| Settlement FX rate | Future Finance |
| Actual payment | Future Finance |
| Remaining FX liability | Future Finance (derived) |
| FX gain/loss | Future Finance |
| Inventory received | Future Warehouse |

---

## API / UI notes

- Extend existing `/purchasing/purchase-orders` (no separate `/fx-purchases` aggregate).
- Decimals serialize as **strings**.
- List filter: `?purchaseType=FX_CREDIT`.
- UI section **خرید ارزی** emphasizes foreign liability over reference Toman valuation.
- Label valuation as «ارزش ریالی بر اساس نرخ مرجع خرید» — never «بدهی ریالی».
- Manual Toman rate entry is supported; no live FX API.

---

## Seed

- `SEED-PO-FX-01` — canonical 1,000 USD @ 205,000 Toman/USD (ORDERED)
- `SEED-PO-FX-DECIMAL` — 842.75 USD decimal liability
