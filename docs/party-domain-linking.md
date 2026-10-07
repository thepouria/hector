# Party Domain Linking (Phase 5.5.2)

**Status:** IMPLEMENTED  
**Related:** `docs/party-architecture.md`, `docs/party-invariants.md`, `docs/party-migration.md`  
**STOP:** Full Party UI is Phase **5.5.3**. This doc describes linking architecture only — no invented UI APIs.

---

## 1. Purpose

Connect existing Hector domains to the canonical Party Master so one real-world person or organization is one Party with multiple business relationships.

```text
Party PTY-000001 Ahmad

Roles: SUPPLIER, PARTNER, LENDER

Supplier.partyId              = PTY-000001
Partner.partyId               = PTY-000001
Loan.lenderPartyId            = PTY-000001
```

Without linking, the same identity is duplicated across Supplier / Customer / Finance tables. That is forbidden after cutover.

---

## 2. Source-of-truth boundaries

| Layer | Owner | Examples |
|---|---|---|
| **Identity** | Party | displayName, type, nationalId / registrationNumber / taxId, phones, emails, addresses, general identity notes |
| **Business relationship** | Domain entity | Supplier code/status/terms; Customer code/status/sales notes; Partner ownership % / effective dates |
| **Transaction / balance** | Owning domain | PO/payable; Sales Order / receivable; Loan principal, FX, settlement; Capital amounts |

After migration there is **no permanent dual identity SoT**. Legacy domain identity columns may remain as deprecated snapshots (see §9), but authoritative identity reads/writes go through Party (`PARTY-LINK-025`, `PARTY-LINK-019`).

---

## 3. Matching tiers

Shared rules live in `packages/database/scripts/lib/party-identity-matching.ts` and are mirrored by API `PartyIdentityLookupService`. Domain services must **not** invent their own matchers.

| Tier | When | Auto-link / reuse? |
|---|---|---|
| **STRONG_IDENTITY** | Same company + compatible Party type + exact normalized `nationalId` **or** `registrationNumber` **or** `taxId` | Yes — deterministic reuse |
| **CONTACT_MATCH** | Same company + normalized mobile / email / phone match + compatible identity | Yes — reuse (weaker than strong) |
| **AMBIGUOUS_SEPARATE** | Name-only similarity, conflicting contacts, or multiple candidates | **Never** auto-merge — create separate Party; record potential duplicate |
| **CREATED_NEW** | No usable match | Create new Party |
| **EXPLICIT_LINK** | Caller supplied an existing `partyId` | Link that Party (tenant-checked) |

### Hard rules

- **Never** merge solely on `displayName`, `firstName + lastName`, or organization name (`PARTY-LINK-013`).
- Ambiguous cases must not be guessed (`PARTY-LINK-014`). False merge is worse than temporary duplication.
- Strong identity reuse must be deterministic (`PARTY-LINK-012`).

---

## 4. Supplier linkage

```text
Supplier
  companyId
  partyId          — nullable until backfill; unique (companyId, partyId) when set
  code             — purchasing relationship code
  status
  …purchasing fields…

Deprecated snapshots (compat): name, legalName, phone, email, address
```

- After migration: every Supplier references exactly one Party (`PARTY-LINK-001`).
- Supplier identity is owned by Party (`PARTY-LINK-003`); purchasing terms stay Purchasing (`PARTY-LINK-007`).
- One Party may be both Supplier and Customer (`PARTY-LINK-005`) — separate domain rows, shared Party.
- Duplicate Supplier for the same `(companyId, partyId)` is rejected (partial unique index).

Create paths:

```text
Existing Party → ensure SUPPLIER role → create Supplier
OR
Create Party   → SUPPLIER role → create Supplier
```

---

## 5. Customer linkage

```text
Customer
  companyId
  partyId          — nullable until backfill; unique (companyId, partyId) when set
  code
  type / status
  …sales relationship fields…

Deprecated snapshots: displayName, firstName, lastName, businessName,
                      mobile, phone, email, nationalId, taxId, registrationNumber
```

- After migration: every Customer references exactly one Party (`PARTY-LINK-002`).
- Customer identity is owned by Party (`PARTY-LINK-004`); sales/credit configuration stays Sales (`PARTY-LINK-008`).
- Customer debt / receivable truth stays Finance — never Party.

---

## 6. Partner linkage (minimal)

```text
Partner
  companyId
  partyId              — required; unique (companyId, partyId)
  code?
  status
  ownershipPercent?    — placeholder field only
  effectiveFrom? / effectiveTo?
  notes?
```

- Partner is a **relationship**, not an identity master.
- PartyRole `PARTNER` declares capacity; `Partner` row holds the domain relationship.
- Partner ownership / equity / company-management **truth is not owned by Party** (`PARTY-LINK-010`).
- Full ownership governance is deferred to **Phase 10** — do not implement it in 5.5.x.

---

## 7. Finance — Loan linkage

```text
Loan
  lenderPartyId      — nullable until backfill
  borrowerPartyId    — nullable until backfill (Hector-as-lender / receivable cases)
  lenderName         — deprecated display snapshot
  principal / currency / FX / status / settlement  — Finance-owned
```

- Loan / liability / FX / settlement truth remains Finance (`PARTY-LINK-009`, `PARTY-LINK-020`, `PARTY-LINK-021`).
- Same Party may be lender on many loans; same Party may be Partner + Lender (`PARTY-LINK-006`).
- Migration must not change economic amounts or FX obligations.

---

## 8. Finance — Capital linkage

```text
CapitalContribution
  contributorPartyId   — nullable until backfill
  contributorName      — deprecated display snapshot
  amount / currency / account / status  — Finance-owned
```

- Capital and Loans remain **distinct** economic instruments even when both reference the same Party (`PARTY-LINK-022`).

Example:

```text
Party Ahmad
  CapitalContribution  1B IRR     (contributorPartyId)
  Loan                 10,000 USD (lenderPartyId)
```

---

## 9. Contact method vs CONTACT_FOR person

### Contact method

```text
Party → PartyContactPoint (phone / email / …)
Party → PartyAddress
```

Channels belonging to that Party’s own identity.

### Contact person

```text
Individual Party  ──CONTACT_FOR──►  Organization Party
```

Implemented as `PartyRelationship` with `type = CONTACT_FOR`, optional `jobTitle`, `department`, `isPrimary`, `notes`.

Rules:

- Do not confuse method with person (`PARTY-LINK-023`).
- SupplierContact may carry `contactPartyId` pointing at the Individual Party.
- One Individual may be `CONTACT_FOR` multiple Organizations — do not duplicate Ali’s Party.
- Do not build a generic CRM / relationship graph beyond what 5.5.2 needs.

---

## 10. Duplicate prevention (post-cutover)

Domain creation must search / reuse Party via `PartyIdentityLookupService`:

```text
findPartyByStrongIdentity(...)
findPotentialPartyMatches(...)
```

Signals: `nationalId`, `registrationNumber`, `taxId`, normalized mobile/email/phone, `partyCode`.

Forbidden:

```text
Create Supplier → always create a new Party (blind)
SupplierService / CustomerService / FinanceService → custom phone or name dedup
```

Allowed:

```text
Select existing Party  OR  Create new Party
```

Potential duplicates are informational until a human merge workflow exists (deferred).

---

## 11. Tenant isolation

- Every Party and every domain link is company-scoped.
- FKs are composite `(partyId, companyId)` → Party `(id, companyId)`.
- Domain links cannot cross Company boundaries (`PARTY-LINK-011` / `PARTY-025`).
- Cross-company Party attach must be rejected by services and integrity checks.

---

## 12. Nullability until backfill

| Column | Nullability in 5.5.2 schema |
|---|---|
| `Supplier.partyId` | Nullable until backfill completes |
| `Customer.partyId` | Nullable until backfill completes |
| `Loan.lenderPartyId` / `borrowerPartyId` | Nullable until backfill |
| `CapitalContribution.contributorPartyId` | Nullable until backfill |
| `SupplierContact.contactPartyId` | Nullable until backfill |
| `Partner.partyId` | **Required** (new table) |

After `pnpm party:migrate --apply`, reconcile expects Suppliers / Customers / Finance counterparties linked. Unlinked required rows are reconcile/integrity failures.

---

## 13. Deferred — Phase 10 ownership

Explicitly **out of scope** for 5.5.2:

- Partner ownership governance / equity ledgers
- Company Management ownership workflows
- Interactive Party merge UI
- Generic relationship types beyond `CONTACT_FOR`
- Dropping legacy identity columns
- Phase 5.5.3 Party UI polish

`Partner.ownershipPercent` may exist as a minimal field; it does **not** make Party or 5.5.2 the ownership SoT.
