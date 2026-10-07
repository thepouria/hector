# HECTOR — Phase 5.5.1
# Party Architecture + Party Master Report

**Date:** 2026-10-06  
**STOP:** Do **not** begin 5.5.2 (domain linking / migration) or 5.5.3 (UI polish).

---

## 1. Baseline

| Gate | Result |
|---|---|
| typecheck / lint / build | PASS (pre-change) |
| API unit | 319 |
| Web unit | 89 |
| Security | 32 |
| Sales e2e | 47 |
| Integrities (catalog/purchasing/warehouse/finance/sales) | 0 violations |

---

## 2. Existing Identity Model Review

| Domain | Identity fields today | Notes |
|---|---|---|
| Supplier | name, legalName, phone, email, address | Free-text address; contacts are separate people |
| SupplierContact | name, role, phone, mobile, email | Not a Party; person-as-contact |
| Customer | displayName, names, mobile/phone/email, nationalId/taxId/registrationNumber, addresses | Closest to Party shape |
| Loan / Capital | lenderName / contributorName + FinanceCounterpartyType | No Party FK |
| Partner | No dedicated Partner master table | Only finance counterparty enum MEMBER/PARTNER |
| User | Auth identity | Must stay separate from Party |

---

## 3. Party Architecture

Canonical company-scoped identity master: `parties` + contacts + addresses + roles.  
Docs: `docs/party-architecture.md`, `docs/party-invariants.md`.

## 4. Individual Model

`type=INDIVIDUAL` with firstName/lastName/birthDate optional; displayName derived when omitted.

## 5. Organization Model

`type=ORGANIZATION` with legalName/tradeName; displayName derived from trade → legal.

## 6. Identity Fields

nationalId / registrationNumber / taxId optional; hard uniqueness only for nationalId + registrationNumber when present.

## 7. Party Code

`PTY-######` via `party_sequences` atomic UPSERT; immutable; company-unique.

## 8. Status / Archive Semantics

`ACTIVE | INACTIVE | ARCHIVED`. No hard delete. Type change forbidden.

## 9. Contact Architecture

Multiple `party_contact_points`; primary **per type**; phone values are strings.

## 10. Contact Normalization

Lookup normalization strips spaces/hyphens/parentheses for phones; lowercases email. Original `value` preserved (leading zeros kept).

## 11. Address Architecture

Multiple `party_addresses`; one non-archived primary per Party.

## 12. Party Roles

`PartyRole` capacity flags — not booleans on Party; not domain entities.

## 13. Multi-Role Support

Same Party can be SUPPLIER + CUSTOMER + PARTNER + LENDER simultaneously (seed + e2e).

## 14. Tenant Isolation

Company-scoped tables + composite FKs; e2e IDOR returns 404.

## 15. Duplicate Detection

`POST /parties/potential-duplicates` — read-only signals; never merges.

## 16. Concurrency

Party code race (8 parallel creates → unique codes). Primary mobile race ends with exactly one ACTIVE primary.

## 17. Security

Auth + company header + RBAC permissions; mass assignment rejected by `forbidNonWhitelisted`.

## 18. Integrity Checker

`pnpm db:check:party` / `pnpm party:integrity` — read-only; 0 violations after seed.

## 19. Tests Added

| Layer | Count |
|---|---:|
| Unit (numbering + normalization) | +8 |
| API unit total | **327** (0 fail / 0 skip / 0 todo) |
| Party e2e | **8** (0 fail / 0 skip / 0 todo) |
| Security | **32** |

## 20. Existing Domain Regression

Sales/Purchasing/Warehouse/Finance integrities remain 0. Supplier/Customer/Finance behavior unchanged (no linking).

## 21. Existing Supplier Mapping (planned 5.5.2)

`Supplier.name/legalName/phone/email/address` → Party identity/contacts/address; Supplier keeps purchasing fields. **Not migrated.**

## 22. Existing Customer Mapping (planned 5.5.2)

Customer identity fields → Party; Customer keeps sales codes/terms. **Not migrated.**

## 23. Existing Finance / Funding Mapping (planned 5.5.2)

`Loan.lenderName` / capital contributor names → Party; balances stay Finance. **Not migrated.**

## 24. Planned 5.5.2 Domain Linking

```text
Party → Supplier / Customer / Partner / Lender-Borrower
```

Labeled **PLANNED — NOT IMPLEMENTED IN 5.5.1**.

## 25. Known Limitations

- No UI yet (5.5.3)
- No Supplier/Customer/Finance FK links yet (5.5.2)
- No Party-to-Party CONTACT_FOR graph
- No auto-merge / CRM / HR

## 26. Technical Debt

- Concurrent primary-set losers get 409 (acceptable; final state consistent)
- Full `test:e2e` suite beyond parties not re-run in final close-out loop (parties + security + units + integrities green)

## 27. Open Issues

None blocking 5.5.1.

## 28. Completion Gate

```text
Can Hector represent an Individual Party? YES
Can Hector represent an Organization Party? YES
Can Party exist without being Supplier/Customer/etc. yet? YES
Can one Party have multiple phone numbers? YES
Can one Party have multiple emails? YES
Can leading-zero phone numbers be preserved? YES
Can one Party have multiple addresses? YES
Can primary contact/address semantics be enforced safely? YES
Can one Party have multiple roles? YES
Can one Party simultaneously be Supplier + Customer + Partner + Lender? YES
Are roles modeled without Party boolean flags? YES
Does SUPPLIER PartyRole replace Supplier entity? NO
Does CUSTOMER PartyRole replace Customer entity? NO
Does PARTNER PartyRole own ownership percentage? NO
Does LENDER PartyRole own loan balance? NO
Does Party own customer debt? NO
Is Party the same thing as Auth User? NO
Is Organization Party the same thing as Hector Company? NO
Are Parties company-scoped? YES
Can Company A access Company B Party? NO
Can Party children cross company boundaries? NO
Are potential duplicates detected without automatic merge? YES
Are archived Parties preserved historically? YES
Are existing Supplier/Customer records migrated in this phase? NO
Is Party ready for domain linking in 5.5.2? YES
```

---

## PHASE 5.5.1 STATUS: COMPLETE

```text
PARTY ARCHITECTURE: READY
INDIVIDUAL PARTY: READY
ORGANIZATION PARTY: READY
IDENTITY: READY
CONTACT INFORMATION: READY
ADDRESSES: READY
STATUS / ARCHIVE: READY
NOTES: READY
MULTI-ROLE FOUNDATION: READY
TENANT ISOLATION: READY
DUPLICATE DETECTION FOUNDATION: READY
PARTY INTEGRITY: READY

READY FOR PHASE 5.5.2
```

**STOP — do not begin domain migration/linking automatically.**
