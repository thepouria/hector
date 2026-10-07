# Party Migration (Phase 5.5.2)

**Status:** IMPLEMENTED  
**Related:** `docs/party-architecture.md`, `docs/party-domain-linking.md`, `docs/party-invariants.md`

Controlled backfill that links existing Suppliers, Customers, SupplierContacts, Loans, Capital Contributions, and Partner rows to canonical Parties — without inventing identity merges and without touching economic amounts.

---

## 1. Staged strategy

```text
1. Schema: add nullable Party FKs + Partner / PartyRelationship / PartyMigrationMap
2. Dry-run: pnpm party:migrate --dry-run
3. Apply:   pnpm party:migrate --apply
4. Verify:  pnpm party:integrity && pnpm party:reconcile
5. Cutover: new writes prefer Party as identity SoT; legacy columns deprecated
6. Later:   drop deprecated columns (NOT in 5.5.2)
```

Nullable FKs exist deliberately so deploy and backfill can be staged. Partner is new and requires `partyId` immediately.

Do not require clean bootstrap alone — also run against representative pre-5.5.2 data (existing suppliers, customers, contacts, loans/funding).

---

## 2. Matching rules

Implemented in `packages/database/scripts/lib/party-identity-matching.ts` (same tiers as runtime lookup).

| Order | Tier | Evidence | Action |
|---|---|---|---|
| 1 | Strong identity | normalized nationalId / registrationNumber / taxId (same company, compatible type) | Reuse Party |
| 2 | Contact match | normalized mobile / email / phone + compatible identity | Reuse Party |
| 3 | Ambiguous | name-only or conflicting / multi-match | **Create separate Party**; flag potential duplicate |
| — | No match | — | Create new Party |

### Never name-only merge

```text
displayName
firstName + lastName
organization / trade name
```

alone must **never** auto-merge Parties (`PARTY-LINK-013`, `PARTY-LINK-014`).

False merge is worse than temporary duplication. Ambiguous rows are recorded with match tier `AMBIGUOUS_SEPARATE`.

---

## 3. Dry-run vs apply

```bash
pnpm party:migrate --dry-run   # report only (default if neither flag)
pnpm party:migrate --apply     # perform backfill
```

| Mode | Behavior |
|---|---|
| `--dry-run` | Reports would-create / would-link / would-reuse / would-flag / would-fail — **no mutations** |
| `--apply` | Writes Parties, roles, contacts/addresses as needed, domain FKs, `PartyMigrationMap` |
| both flags | Rejected (exit 2) |

Diagnostic commands must never unexpectedly mutate production data.

Migration does **not**:

- emit operational domain events
- alter financial amounts or FX obligations (`PARTY-LINK-020`, `PARTY-LINK-021`)
- rewrite historical PO / Sales Order / Journal / Loan settlement rows beyond Party FKs + snapshots as designed

---

## 4. Idempotency

Migration is safe to re-run (`PARTY-LINK-015`).

Mechanisms:

- Skip sources already linked (`partyId` / `lenderPartyId` / … already set)
- `PartyMigrationMap` unique on `(companyId, sourceType, sourceId)` — provenance of what was linked and how
- Role ensure is upsert-style (ACTIVE role if missing)
- Contact/address migration uses deterministic fingerprints where applicable

Expected second `--apply`: largely `skippedAlreadyLinked`, zero new economic side effects.

---

## 5. Provenance — PartyMigrationMap

```text
PartyMigrationMap
  companyId
  sourceType     SUPPLIER | CUSTOMER | SUPPLIER_CONTACT | LOAN_LENDER | CAPITAL_CONTRIBUTOR | PARTNER
  sourceId
  partyId
  matchTier      CREATED_NEW | STRONG_IDENTITY | CONTACT_MATCH | EXPLICIT_LINK | AMBIGUOUS_SEPARATE
  notes?
  createdAt
```

Purpose:

- explain how a domain row got its Party
- support idempotent re-runs
- surface ambiguous / potential-duplicate counts in reconcile reports

Maps are operational provenance for migration — not a second identity master.

---

## 6. What gets migrated

| Source | Link written | Side effects (identity only) |
|---|---|---|
| Supplier | `Supplier.partyId` | Party (+ contacts/address from legacy fields), `SUPPLIER` role |
| Customer | `Customer.partyId` | Party (+ contacts/ids), `CUSTOMER` role |
| SupplierContact | `contactPartyId` + `CONTACT_FOR` to supplier’s org Party when applicable | Individual Party + relationship |
| Loan | `lenderPartyId` (and borrower when modeled) | Party + `LENDER` / `BORROWER` role as appropriate |
| CapitalContribution | `contributorPartyId` | Party (+ role as needed) |
| Partner | already requires `partyId` | ensure `PARTNER` role |

Historical operational records are preserved (`PARTY-LINK-016`). Capital and Loans stay distinct (`PARTY-LINK-022`).

---

## 7. Legacy field policy — deprecate, do not drop

Identity columns on Supplier / Customer / Loan / Capital remain for compatibility:

- Marked `@deprecated` in Prisma schema
- Stop treating them as authoritative SoT after cutover
- May continue as display/compat snapshots during transition
- **Do not drop** in 5.5.2 — destructive removal is a later cleanup when risk is acceptable

Permanent dual SoT is forbidden (`PARTY-LINK-025`): once Party owns identity, new authoritative updates go through Party (`PARTY-LINK-019`).

---

## 8. Rollback / recovery notes

There is no destructive “undo migration” that deletes Parties blindly — domain history and Party children must remain (`PARTY-LINK-017`).

Practical recovery options:

| Situation | Approach |
|---|---|
| Bad apply in a disposable environment | Restore DB snapshot / rebuild from backup taken before `--apply` |
| Wrong link discovered | Correct `partyId` (or finance Party FK) explicitly; do not auto-repair via integrity tools |
| Ambiguous separate Parties | Leave separate until a human merge workflow (deferred); use reconcile potential-duplicate counts |
| Need to re-run | `--apply` is idempotent for already-mapped sources |

Integrity / reconcile never silently repair (`PARTY-LINK-024`, `PARTY-026`).

Party archive must not cascade-destroy Supplier / Customer / Loan / Partner history. Domain deactivation must not auto-archive Party (`PARTY-LINK-018`).

---

## 9. Reconcile and integrity

```bash
pnpm party:integrity    # = pnpm db:check:party — Party + link invariant checks
pnpm party:reconcile    # cross-domain link coverage report
```

Both are **read-only**.

Reconcile typically reports:

```text
Suppliers linked / unlinked
Customers linked / unlinked
Loans / Capital linked / unlinked
Partners present
SupplierContacts linked
Potential duplicates / ambiguous (informational)
Integrity violations (failures)
```

Potential duplicates are **not** automatic integrity failures if explicitly unresolved. Unlinked required rows and cross-company FKs **are** failures.

Exit conventions (reconcile): `0` = clean link coverage; `1` = violations.

---

## 10. Command summary

| Command | Mutates | Purpose |
|---|---|---|
| `pnpm party:migrate --dry-run` | No | Preview backfill |
| `pnpm party:migrate --apply` | Yes | Controlled migration |
| `pnpm party:integrity` | No | Invariant validation |
| `pnpm party:reconcile` | No | Domain ↔ Party coverage |

Keep migration separate from diagnostics (`party:migrate` vs `party:integrity` / `party:reconcile`).
