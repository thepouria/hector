# Supplier Master (Phase 2.2)

Canonical identity for parties Hector buys goods/services from.

```text
Supplier identity → Supplier Master
Supplier Contacts → Supplier Master
Supplier Notes → Supplier Master
Supplier Quotes → future 2.3
Purchase Orders → future 2.4
Supplier debt / payments → future Finance
```

Architecture authority: `docs/purchasing-architecture.md`.

---

## Ownership

Every Supplier belongs to exactly one Company (`supplier.companyId`).

Cross-company access (read/list/update/archive/contacts/notes) returns the same safe **404** as Catalog — no existence leak.

---

## Identity

- Primary key: UUID (`supplier.id`)
- Display `name` is **not** identity (duplicates allowed)
- Optional `code` is company-scoped unique when set (manual; not auto-numbered in 2.2)

---

## Required / optional fields

**Required on create:** `name`

**System-owned:** `companyId`, `status` (defaults `ACTIVE`), timestamps

**Optional:** `legalName`, `code`, `phone`, `email`, `address`

Contacts and notes are optional. A supplier may be only:

```text
حاجی بازار تهران
```

---

## Status lifecycle

```text
ACTIVE ⇄ INACTIVE
ACTIVE / INACTIVE → ARCHIVED
ARCHIVED → ACTIVE (activate)
```

Invalid: `ARCHIVED → INACTIVE` (use activate first).

Archive is **not** deletion. ID, contacts, notes, and future PO references remain.

Default list **excludes** `ARCHIVED`. Pass `status=ARCHIVED` (or other status) to filter explicitly.

---

## Contacts

- Multiple contacts per supplier
- Minimum field: `name`
- Free-text `role` (فروش، حسابداری، …)
- Phone/mobile stored as **strings** (leading zeros preserved, e.g. `09121234567`)
- Email optional with format validation when provided

### Primary contact

- At most **one** active primary contact per supplier
- Enforced by partial unique index: `(supplier_id) WHERE is_primary AND archived_at IS NULL`
- First contact becomes primary by default
- Supplier may temporarily have **no** primary (e.g. after archiving the primary)
- `set-primary` is atomic (unset previous + set new + audit/event)

---

## Notes

Timeline model `SupplierNote` (not a single text field; not Audit).

- Body + `createdBy` + timestamps
- Informal operational knowledge only
- **Not** authoritative debt/payment state
- **Not** a substitute for Audit Log

---

## Explicitly out of scope (2.2)

```text
Supplier offers / prices
Purchase orders
Balances / debt / credit days as authority
Bank accounts / tax profiles
Supplier ratings / lead-time analytics
Supplier SKU mapping
Warehouse / Finance / Sales
```

---

## API

Prefix: `/api/v1/purchasing/suppliers`

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `purchasing.read` |
| POST | `/` | `purchasing.create` |
| GET | `/:id` | `purchasing.read` |
| PATCH | `/:id` | `purchasing.manage` |
| POST | `/:id/activate` | `purchasing.manage` |
| POST | `/:id/deactivate` | `purchasing.manage` |
| POST | `/:id/archive` | `purchasing.manage` |
| GET/POST | `/:id/contacts` | read / manage |
| PATCH | `/:id/contacts/:contactId` | manage |
| POST | `/:id/contacts/:contactId/set-primary` | manage |
| POST | `/:id/contacts/:contactId/archive` | manage |
| GET/POST | `/:id/notes` | read / manage |

List supports pagination, search (name/legalName/code/phone/contact name/phone), status filter, sort (`name|createdAt|updatedAt`).

---

## RBAC

Registered permissions:

- `purchasing.read`
- `purchasing.create`
- `purchasing.manage`

(`purchasing.approve` / `purchasing.cancel` remain planned for PO phases.)

---

## Audit actions

```text
SUPPLIER_CREATED
SUPPLIER_UPDATED
SUPPLIER_ACTIVATED
SUPPLIER_DEACTIVATED
SUPPLIER_ARCHIVED
SUPPLIER_CONTACT_CREATED
SUPPLIER_CONTACT_UPDATED
SUPPLIER_CONTACT_PRIMARY_CHANGED
SUPPLIER_CONTACT_ARCHIVED
SUPPLIER_NOTE_CREATED
```

True no-op updates do not write audit/events.

---

## Domain events

```text
purchasing.supplier.created
purchasing.supplier.updated
purchasing.supplier.status_changed
purchasing.supplier.archived
purchasing.supplier_contact.created
purchasing.supplier_contact.updated
purchasing.supplier_contact.primary_changed
purchasing.supplier_contact.archived
purchasing.supplier_note.created
```

Same Phase 0 bus + `commitThenPublish` transaction guarantees.

---

## Future readiness

Stable `supplierId` is safe for:

```text
SupplierOffer (2.3)
PurchaseOrder (2.4)
PurchaseReturn
Finance settlement references (without storing balances on Supplier)
```

Historical documents will snapshot display names; canonical identity remains Supplier Master.
