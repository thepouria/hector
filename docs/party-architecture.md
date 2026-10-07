# Party Architecture (Phase 5.5 — COMPLETE)

**Status:** Party Master **PRODUCTION-READY** (5.5.1 architecture + 5.5.2 domain linking + 5.5.3 API/UI/audit/QA).  
**STOP:** Do **not** begin Phase 6 from this lane. No Party merge / CRM / HR in scope.

---

## 1. Core rule

```text
Party = WHO / WHAT the entity is (identity).

Supplier / Customer / Partner / Lender / Borrower / …
= HOW that Party relates to our business (domain relationship).
```

These responsibilities must never be mixed.

After 5.5.2:

```text
IDENTITY
    ↓
Party Master

BUSINESS RELATIONSHIP
    ↓
Domain Entity (Supplier / Customer / Partner / …)

TRANSACTION / BALANCE
    ↓
Owning Domain (Purchasing / Sales / Finance / …)
```

---

## 2. What Party is

A company-scoped identity master for:

- `INDIVIDUAL`
- `ORGANIZATION`

Examples:

| Party | Type |
|---|---|
| احمد رضایی | INDIVIDUAL |
| Essence Distributor | ORGANIZATION |
| ABC Trading LLC | ORGANIZATION |

Party is:

- **Not** an Auth `User`
- **Not** a Hector `Company` / tenant
- **Not** a Supplier / Customer / Partner / Loan balance record

---

## 3. Tables

| Table | Purpose |
|---|---|
| `parties` | Canonical identity |
| `party_contact_points` | Multiple phones/emails/etc. |
| `party_addresses` | Multiple addresses |
| `party_roles` | Capacity flags (SUPPLIER/CUSTOMER/…) |
| `party_sequences` | Concurrent-safe `PTY-######` allocation |
| `partners` | Minimal partner **relationship** (5.5.2) |
| `party_relationships` | Party-to-Party links (`CONTACT_FOR`) |
| `party_migration_maps` | Backfill provenance / idempotency |

Every child / link row carries `company_id` and is FK-bound to `(party_id, company_id)` (composite tenant-safe FK).

---

## 4. Display name semantics (deterministic)

Server owns `displayName`. Clients may supply it; otherwise:

**INDIVIDUAL**

1. explicit `displayName`, else
2. `firstName + lastName`, else
3. `firstName`

Requires at least one of displayName / firstName.

**ORGANIZATION**

1. explicit `displayName`, else
2. `tradeName`, else
3. `legalName`

Requires at least one of displayName / tradeName / legalName.

APIs must not invent alternate display-name logic.

---

## 5. Party code

- Format: `PTY-000001`
- Unique per `companyId`
- Server-allocated via `party_sequences` UPSERT (same pattern as Sales Orders)
- Immutable after creation
- Never client-writable

---

## 6. Status / archive

`ACTIVE | INACTIVE | ARCHIVED`

- No hard delete once operational history may exist
- Archive retains contacts, addresses, roles, and domain references
- Type change (`INDIVIDUAL` ↔ `ORGANIZATION`) is **forbidden** after creation
- Archiving a Party must **not** destroy Supplier / Customer / Loan / Partner history
- Deactivating a domain row (e.g. Supplier INACTIVE) must **not** automatically archive the Party

---

## 7. Contacts

Types: `MOBILE | PHONE | EMAIL | WHATSAPP | TELEGRAM | WEBSITE | OTHER`

- Multiple values allowed
- `value` preserves original text (leading zeros never coerced to numbers)
- `normalizedValue` is lookup-only (phones: strip spaces/hyphens/parentheses; email: lowercase)
- Primary is **per type** (at most one ACTIVE primary MOBILE / PHONE / EMAIL per Party) — DB partial unique index

**Contact method** ≠ **Contact person**. Phones/emails live on Party; a person who represents an organization is a separate Individual Party linked via `CONTACT_FOR` (see §12).

---

## 8. Addresses

Types: `GENERAL | BILLING | SHIPPING | OFFICE | WAREHOUSE | HOME | OTHER`

- Multiple addresses per Party
- One generic primary (non-archived) per Party — DB partial unique index
- Addresses belong to Party (canonical identity location), not to Supplier/Customer as identity masters

Legacy `CustomerAddress` / free-text `Supplier.address` remain operational/compat snapshots until later cleanup; new identity truth is PartyAddress.

---

## 9. Roles

`PartyRole` declares capacity:

`SUPPLIER | CUSTOMER | PARTNER | LENDER | BORROWER | CONTACT | EMPLOYEE | OTHER`

Rules:

- **No** boolean columns on Party (`isSupplier`, …)
- Roles do **not** replace domain entities
- One ACTIVE role per `(party, roleType)` (partial unique index)
- Deactivation sets `INACTIVE` + `endedAt` (history preserved)

Example — one real-world person:

```text
Party PTY-000001 Ahmad
  ├── PartyRole SUPPLIER   → Supplier.partyId
  ├── PartyRole CUSTOMER   → Customer.partyId
  ├── PartyRole PARTNER    → Partner.partyId
  └── PartyRole LENDER     → Loan.lenderPartyId
```

---

## 10. Duplicate detection

`findPotentialDuplicates(...)` / `PartyIdentityLookupService` compares:

- nationalId (hard unique when present)
- registrationNumber (hard unique when present)
- taxId (strong identity signal)
- normalized mobile / phone / email (soft / contact signals)

**Never auto-merge.** Names are not unique identifiers.  
Migration matching tiers: see `docs/party-domain-linking.md` and `docs/party-migration.md`.

---

## 11. Ownership boundaries

| Concern | Owner |
|---|---|
| Name / contacts / addresses / general identity notes | **Party** |
| supplierCode / purchasing terms / supplier status | **Supplier** (Purchasing) |
| customerCode / sales terms / customer relationship status | **Customer** (Sales) |
| ownership % / capital governance | **Partner** / Company Management (**Phase 10** — not owned by Party) |
| loan principal / balances / FX / settlement | **Finance** |
| capital contribution amounts | **Finance** |
| Auth credentials | **User** |

Party never owns purchasing terms, customer debt, partner ownership accounting, or loan balances.

---

## 12. Domain linking model (Phase 5.5.2 — IMPLEMENTED)

```text
Party
 ├── Supplier.partyId              (nullable until backfill; then required in practice)
 ├── Customer.partyId              (nullable until backfill)
 ├── Partner.partyId               (required; unique per company)
 ├── Loan.lenderPartyId            (nullable until backfill)
 ├── Loan.borrowerPartyId          (nullable until backfill)
 ├── CapitalContribution.contributorPartyId
 └── PartyRelationship CONTACT_FOR
       (Individual → Organization contact person)
```

### Link constraints

| Domain link | FK fields | Uniqueness |
|---|---|---|
| Supplier | `partyId` (+ `companyId`) | Unique `(companyId, partyId)` where `partyId IS NOT NULL` |
| Customer | `partyId` (+ `companyId`) | Unique `(companyId, partyId)` where `partyId IS NOT NULL` |
| Partner | `partyId` (+ `companyId`) | Unique `(companyId, partyId)` (required) |
| Loan | `lenderPartyId` / `borrowerPartyId` | Indexed; same Party may hold many loans |
| Capital | `contributorPartyId` | Indexed; distinct from Loan even for same Party |
| SupplierContact | `contactPartyId` | Individual Party for the contact person |

All Party FKs are composite `(partyId, companyId)` → `(parties.id, parties.company_id)` with `ON DELETE RESTRICT`. Domain links cannot cross tenants.

### Partner (minimal)

`Partner` is a relationship row, not an identity master:

- `partyId` (required)
- optional `code`, `ownershipPercent`, `effectiveFrom` / `effectiveTo`, `notes`, status
- **No** ownership governance, equity ledger, or company-management workflows in 5.5.2 — deferred to **Phase 10**

### CONTACT_FOR

```text
Party O-001  ABC Trading LLC   ORGANIZATION
Party P-002  Ali Rezaei        INDIVIDUAL

PartyRelationship:
  fromPartyId = P-002
  toPartyId   = O-001
  type        = CONTACT_FOR
  jobTitle / department / isPrimary / notes (optional)
```

Same Individual may be `CONTACT_FOR` multiple Organizations. Do not duplicate identity.

### Legacy deprecated fields

Identity columns left on domain tables for migration compatibility — **deprecate, do not drop** in 5.5.2:

| Domain | Deprecated (snapshot / compat) | Canonical |
|---|---|---|
| Supplier | `name`, `legalName`, `phone`, `email`, `address` | Party + PartyContactPoint + PartyAddress |
| Customer | `displayName`, names, mobile/phone/email, nationalId/taxId/registrationNumber | Party + contacts |
| Loan | `lenderName` | `lenderParty.displayName` |
| CapitalContribution | `contributorName` | `contributorParty.displayName` |

New authoritative identity writes go through Party. Snapshots may remain for display/compat until a later cleanup phase.

### Search via Party

List/search paths for linked domains (e.g. Supplier) resolve identity through Party (`displayName`, `legalName`, `tradeName`, active contact points) in addition to legacy snapshot fields. Domain services must use `PartyIdentityLookupService` — not bespoke phone/name matchers.

---

## 13. API surface (foundation)

Prefix: `/api/v1/parties`

Permissions: `party.read|create|update|status|contacts.manage|addresses.manage|roles.manage`

Domain create paths conceptually support:

```text
attach existing Party  →  domain relationship
OR
create Party           →  role + domain entity
```

Full Party Management API + UI is delivered in Phase **5.5.3** (`/app/parties`, `/api/v1/parties`, duplicate-check, related-entities).

Also deferred (intentionally):

- Interactive Party merge workflow
- Generic relationship graph beyond `CONTACT_FOR` (`EMPLOYEE_OF`, `OWNER_OF`, …)
- CRM / HR / payroll
- Marketplace / settlement / profit engines
- Phase 10 Partner ownership governance

---

## 14. Integrity / migration / reconcile

```bash
pnpm party:migrate --dry-run   # default if no flag: dry-run
pnpm party:migrate --apply     # controlled backfill (mutates)
pnpm party:integrity           # alias: pnpm db:check:party — read-only
pnpm party:reconcile           # read-only cross-domain link coverage
```

| Command | Mutates? | Role |
|---|---|---|
| `party:migrate` | only with `--apply` | staged backfill + `PartyMigrationMap` provenance |
| `party:integrity` | never | Party + link invariant violations |
| `party:reconcile` | never | Supplier/Customer/Loan/Capital/Partner link coverage |

Integrity / reconcile never auto-repair. Details: `docs/party-migration.md`, `docs/party-domain-linking.md`.
