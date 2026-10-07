# HECTOR — Phase 5.5.2
# Party Domain Linking + Migration Report

**Date:** 2026-10-06  
**STOP:** Do **not** begin Phase 5.5.3 (Party API/UI polish).

---

## 1. Baseline

Clean bootstrap (`docker compose down -v` → migrate → double seed) + gates:

| Gate | Result |
|---|---|
| `pnpm db:generate` / typecheck / lint / build | PASS |
| API unit | **63 suites / 330 tests** PASS |
| Web unit | **18 files / 89 tests** PASS |
| Security e2e | **32 tests** PASS |
| Full e2e (clean DB, undisturbed) | **62 suites / 554 tests** PASS |
| Catalog / Purchasing / Warehouse / Finance / Sales / Party integrity | **0 violations** |
| `pnpm party:reconcile` (seeded) | Linked suppliers/customers/loans/capital; **0 violations** |

---

## 2. Existing Identity Sources

| Domain | Pre-5.5.2 identity | Post-5.5.2 |
|---|---|---|
| Supplier | `name`, `legalName`, `phone`, `email`, `address` | Party owns identity; columns **deprecated snapshots** |
| SupplierContact | contact person name/role/phone/mobile/email | Contact methods → PartyContactPoint; contact persons → `CONTACT_FOR` + Individual Party |
| Customer | `displayName`, names, mobile/phone/email, IDs, addresses | Party owns identity; CustomerAddress → PartyAddress where migrated |
| Loan | `lenderName` + counterparty enum | `lenderPartyId` / `borrowerPartyId`; amount/FX unchanged |
| Capital | `contributorName` | `contributorPartyId` |
| Partner | finance enum only | Minimal `Partner` row + `PARTNER` role (ownership % deferred to Phase 10) |

---

## 3. Migration Architecture

Staged, deploy-safe:

```text
1. Schema migration 20261014140000_party_domain_linking
   — nullable FKs, Partner, PartyRelationship, PartyMigrationMap
2. pnpm party:migrate --dry-run
3. pnpm party:migrate --apply
4. pnpm party:integrity && pnpm party:reconcile
5. Domain writes create/link Party atomically
6. Legacy columns retained as deprecated snapshots (no DROP in 5.5.2)
```

Commands: `pnpm party:migrate`, `pnpm party:integrity`, `pnpm party:reconcile`.

---

## 4. Identity Matching Rules

Shared in `packages/database/scripts/lib/party-identity-matching.ts` + API `PartyIdentityLookupService`.

| Tier | Evidence | Auto-link? |
|---|---|---|
| STRONG_IDENTITY | nationalId / registrationNumber / taxId | Yes |
| CONTACT_MATCH | normalized mobile/email/phone + compatible type | Yes |
| AMBIGUOUS_SEPARATE | name-only / conflict / multi-match | **Never** — separate Party + potential duplicate |
| CREATED_NEW | no match | Create Party |

**Never** merge on displayName alone (`PARTY-LINK-013`).

---

## 5–9. Domain Linking

- **Supplier** → `partyId` unique per company; SUPPLIER role; create via existing Party or new Party+role+Supplier (atomic).
- **Customer** → `partyId` unique per company; CUSTOMER role; INDIVIDUAL/BUSINESS map to Party types.
- **Partner** → minimal `Partner` entity (`partyId`, optional %, dates, status). Ownership governance deferred.
- **Loan** → `lenderPartyId` / `borrowerPartyId`; Finance owns principal/currency/FX/settlement.
- **Capital** → `contributorPartyId`; distinct from Loan even for same Party.

Same Party may be Supplier + Customer + Partner + Lender simultaneously.

---

## 10–11. Contacts

- **Contact method:** `PartyContactPoint` (phone/mobile/email; leading zeros preserved).
- **Contact person:** Individual Party + `PartyRelationship` type `CONTACT_FOR` (minimal metadata). Same Individual may contact for multiple Organizations.

---

## 12. Duplicate Prevention

Domain services call `PartyIdentityLookupService` only — no per-domain matchers. Strong ID conflicts reject with existing Party details for future UI (5.5.3).

---

## 13. Legacy Identity Fields

| Decision | Fields |
|---|---|
| DEPRECATE (retain) | Supplier name/legalName/phone/email/address; Customer displayName/names/contacts/IDs; Loan.lenderName; Capital.contributorName |
| DROP | Not in 5.5.2 |
| Authoritative writer | Party only after cutover (`PARTY-LINK-025`) |

Compat reads still expose `supplier.name` / `customer.mobile` from snapshots or Party joins.

---

## 14–16. Migration Behavior

Deterministic backfill for Supplier, Customer, SupplierContact, Loan lender, Capital contributor. Provenance via `PartyMigrationMap`. Batched; idempotent; no operational domain events; **no economic amount / FX mutation**.

---

## 17. Migration Statistics (representative)

**Seeded company (already linked):** apply → Parties created 0, Already linked 12, Failures 0.

**Pre-5.5.2 fixture (unlinked Supplier+Customer+USD Loan):**

| Metric | First apply | Second apply |
|---|---|---|
| Parties created | >0 (as needed) | **0** |
| Domain links written | >0 | **0** |
| USD loan `contracted_principal` | `10000` | `10000` (unchanged) |
| USD loan `lender_party_id` | set | unchanged |
| Failures | 0 | 0 |

---

## 18. Ambiguous / Potential Duplicates

Name-only collisions create separate Parties and may record potential duplicates. Not integrity failures until manually resolved (5.5.3).

---

## 19. Migration Idempotency

Second `--apply` on same DB: 0 new Parties/roles/contacts/addresses/links. Gate: **PASS**.

---

## 20. Tenant Isolation

Composite FKs `(partyId, companyId)` → `(parties.id, parties.companyId)`. Cross-company `partyId` injection rejected. Integrity checks cross-company links.

---

## 21. RBAC / Security

Supplier/Customer/Finance create still require domain permissions. Party create requires Party permissions when calling Party APIs. Security e2e: **32 PASS**.

---

## 22. Concurrency

Party code allocation uses atomic sequence UPSERT. Unique indexes on `(companyId, partyId)` for Supplier/Customer/Partner and strong IDs. Race e2e covered in parties suite.

---

## 23–25. Regression

Purchasing / Sales / Finance e2e suites included in full **554** pass. Party linkage does not alter PO amounts, sales money, loan principal, or FX reference rates.

---

## 26. Party Integrity

Extended checks: unlinked Supplier/Customer, missing/cross-company Party, missing roles, duplicate links, finance counterparty company match, relationship company/self rules, legacy snapshot drift (info).

---

## 27. Cross-Domain Reconciliation

`pnpm party:reconcile` — read-only linked/unlinked counts + potential duplicates. Clean seed: **OK**.

---

## 28. Existing Database Migration Test

Fixture script `packages/database/scripts/party-migrate-fixture.ts` creates unlinked Supplier/Customer/Loan; migrate links them; USD principal preserved; second apply no-ops.

---

## 29. Clean Bootstrap

```text
docker compose down -v && docker compose up -d
pnpm db:migrate:deploy && pnpm db:generate
pnpm db:seed && pnpm db:seed
```

Double seed keeps Demo B `party_sequences.next_value` from being lowered (bugfix in this phase). All integrities **0 violations**.

---

## 30. Automated Tests

| Layer | Suites / Files | Tests | Failed | Skipped | Todo |
|---|---|---|---|---|---|
| API unit | 63 | 330 | 0 | 0 | 0 |
| Web unit | 18 | 89 | 0 | 0 | 0 |
| Security e2e | 1 | 32 | 0 | 0 | 0 |
| Full e2e | 62 | 554 | 0 | 0 | 0 |

---

## 31. Build

`pnpm build` — PASS (api + web + packages).

---

## 32. Documentation

| Doc | Status |
|---|---|
| `docs/party-architecture.md` | Updated (5.5.2 linking) |
| `docs/party-invariants.md` | PARTY-LINK-001…025 appended |
| `docs/party-domain-linking.md` | Added |
| `docs/party-migration.md` | Added |
| This report | `docs/phase-5.5.2-party-domain-linking-migration-report.md` |

---

## 33. Bugs Found

| Severity | Issue | Fix |
|---|---|---|
| HIGH | Demo B seed reset `party_sequences.next_value` to 2 on re-seed → partyCode unique 409 in e2e | Never lower nextValue (`Math.max`) |
| MED | E2e fixtures created Suppliers without `partyId` | `createPartyLinkedSupplier` helper + integrity `supplier_unlinked` / `customer_unlinked` |
| LOW | Obsolete e2e asserts expecting missing `payment` / `payable` Prisma models | Removed |
| LOW | Finance payments e2e cleanup missing ledger/party deletes | Extended afterAll cleanup |

---

## 34. Known Limitations

- Legacy identity columns still present (deprecated).
- Partner ownership % / governance is minimal (Phase 10).
- Manual duplicate merge UI deferred to 5.5.3.
- Fuzzy name matching not implemented (by design).

---

## 35. Technical Debt

- Drop deprecated identity columns after soak period.
- Migrate remaining any ad-hoc e2e raw domain inserts to Party-linked helpers.
- Polish Party Management API/UI in 5.5.3.

---

## 36. Open Issues

None blocking 5.5.2 completion.

---

## 37. Completion Gate

```text
Does every Supplier reference Party? YES
Does every Customer reference Party? YES
Can existing Party become Supplier? YES
Can existing Party become Customer? YES
Can one Party be Supplier + Customer? YES
Can one Party be Partner + Lender? YES
Can one Party hold multiple business roles? YES
Is Supplier identity canonical in Party? YES
Is Customer identity canonical in Party? YES
Does Supplier still own purchasing-specific data? YES
Does Customer still own sales-specific data? YES
Does Finance still own Loan/liability truth? YES
Does Party own loan balances? NO
Does Party own customer receivable balances? NO
Does Party own supplier payable balances? NO
Does Party own partner capital balances? NO
Can a Loan reference a lender Party? YES
Can a Loan reference a borrower Party where applicable? YES
Can USD lender identity reference Party without changing USD obligation? YES
Can Capital and Loan reference the same Party while remaining distinct? YES
Are Contact Methods separate from Contact Persons? YES
Can an Organization have an Individual Party as contact person? YES
Can identity be updated once through Party? YES
Do Supplier/Customer see that updated identity? YES
Can domain links cross companies? NO
Does name alone cause automatic merge? NO
Are ambiguous matches automatically merged? NO
Is migration idempotent? YES
Does migration preserve historical records? YES
Does migration preserve financial amounts? YES
Are legacy identity fields no longer competing source-of-truth? YES
Can Party ↔ Domain links be reconciled? YES
Are all existing domains regression-safe? YES
```

```text
PHASE 5.5.2 STATUS: COMPLETE
```

Do **not** begin 5.5.3 automatically.
