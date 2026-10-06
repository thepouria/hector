# Supplier Offers / Price Quotes (Phase 2.3)

Historical commercial observations collected from suppliers before a purchase decision.

```text
Quoted Price  ≠  Purchase Price (future PO)
Quote Terms   ≠  Actual Payment (Finance)
Supplier availableQuantity ≠ Company stock (Warehouse)
```

Architecture authority: `docs/purchasing-architecture.md`. Supplier identity: `docs/supplier-master.md`. SKU identity: Catalog.

---

## Purpose

Answer:

> Who quoted which SKU, at what unit price/currency/terms, and when?

Not a Purchase Order, payment, debt, or inventory fact.

---

## Ownership / source of truth

| Concept | Authority |
|---|---|
| Supplier | Supplier Master |
| Supplier Contact | Supplier Master |
| Product / SKU / Barcode | Catalog |
| Supplier quoted price & terms | **Supplier Offer** |
| Actual purchase price | Future Purchase Order |
| Ordered / received qty | Future PO / Warehouse |
| Payment | Future Finance |
| Current stock | Future Warehouse |

---

## Model

`SupplierOffer` is append-oriented: a new price ⇒ a new row. No `UNIQUE(supplierId, skuId)`.

### Core required

```text
companyId, supplierId, skuId
unitPrice (Decimal string in API)
currency (IRR | USD)
quotedAt
createdById
```

### Optional commercial context

```text
purchaseType: CASH | TERM_CREDIT | FX_CREDIT
paymentTermType: IMMEDIATE | NET_DAYS | FIXED_DATE
netDays
quotedQuantity / minimumQuantity / availableQuantity
referenceFxRate + base/quote currency pair
validUntil
supplierContactId
notes
```

---

## Money / IRR / Toman

| Concern | Rule |
|---|---|
| Storage | Prisma `Decimal(24,6)` |
| API | **string** (never JS `number` authority) |
| IRR | Whole **rials** (scale 0) |
| Toman | UI display only: 1 Toman = 10 IRR |
| USD | Fractional digits allowed |

Example: UI `585,000 تومان` → API `unitPrice: "5850000"` with `currency: "IRR"`.

---

## Quote time vs createdAt

`quotedAt` is when the supplier gave the price (may be entered later).
`createdAt` is when Hector recorded it.

**Latest quote** = max(`quotedAt`), then `createdAt`, then `id`.

---

## Validity / expiry

- `validUntil` optional
- `null` means “no explicit expiry recorded” — not “valid forever”
- Derived `expiryState`: `CURRENT` | `EXPIRED` | `NO_EXPIRY` | `ARCHIVED`
- List filter `validity` supports these modes

---

## Commercial terms

- `CASH` ⇒ no `netDays`; defaults `paymentTermType=IMMEDIATE` when omitted
- `TERM_CREDIT` ⇒ `NET_DAYS` + `netDays > 0` when capturing day terms
- `FX_CREDIT` ⇒ foreign `unitPrice`/`currency`; optional reference FX pair for valuation only

Quote terms are a snapshot. They do not create Finance liabilities.

---

## Quantity conditions

| Field | Meaning |
|---|---|
| `quotedQuantity` | Quantity Ahmad asked about |
| `minimumQuantity` | Stated MOQ |
| `availableQuantity` | Supplier-reported availability at quote time (≥0) |

None are company inventory.

---

## Correction / archive

- **Correction:** `PATCH` allowed on non-archived offers; commercial field changes are audited
- **Archive:** soft archive; no hard delete in normal flows
- Prefer archive+recreate for mistaken duplicates when clearer than editing history

Archived Supplier/SKU: historical offers remain readable; **new** offers rejected for archived Supplier or archived SKU.

---

## API

Prefix: `/api/v1/purchasing/offers`

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `purchasing.read` |
| GET | `/compare?skuId=` | `purchasing.read` |
| GET | `/latest?supplierId=&skuId=` | `purchasing.read` |
| GET | `/:id` | `purchasing.read` |
| POST | `/` | `purchasing.create` |
| PATCH | `/:id` | `purchasing.manage` |
| POST | `/:id/archive` | `purchasing.manage` |

---

## Comparison view

`GET /compare` returns **latest non-archived offer per supplier** for a SKU.
Does **not** declare a best supplier across differing terms/currencies.

---

## Future PO conversion

When Phase 2.4 creates a PO from an offer:

```text
copy commercial terms into PO snapshot
```

PO must not dynamically depend on the Offer row afterward.

---

## Audit / Events

Audit: `SUPPLIER_OFFER_CREATED` / `UPDATED` / `ARCHIVED`

Events:

```text
purchasing.supplier_offer.created
purchasing.supplier_offer.updated
purchasing.supplier_offer.archived
```

Payload includes `companyId`, `supplierOfferId`, `supplierId`, `skuId` (+ currency/quotedAt on create).

---

## UI

```text
Purchasing → استعلام قیمت
```

List, quick create, SKU comparison, detail/correct/archive.
IRR forms use Toman with explicit labeling.
