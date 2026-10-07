# Party Invariants (Phase 5.5.1 + 5.5.2)

Do not renumber casually. Add new codes at the end.

| ID | Invariant |
|---|---|
| PARTY-001 | Every Party belongs to exactly one Company/Tenant. |
| PARTY-002 | A Party represents identity, not a domain-specific business relationship. |
| PARTY-003 | A Party is either INDIVIDUAL or ORGANIZATION. |
| PARTY-004 | Party code is unique within Company. |
| PARTY-005 | Party code is server-owned and immutable. |
| PARTY-006 | One Party may hold multiple simultaneous business roles. |
| PARTY-007 | Roles are not represented by boolean columns on Party. |
| PARTY-008 | PartyRole does not replace Supplier/Customer/Partner/Finance entities. |
| PARTY-009 | Duplicate ACTIVE role type for the same Party is forbidden. |
| PARTY-010 | Contact values such as phone numbers are stored as strings. |
| PARTY-011 | Leading zeros in contact values must never be lost. |
| PARTY-012 | Party may have multiple contact points. |
| PARTY-013 | Primary contact semantics are per-type, deterministic, and race-safe. |
| PARTY-014 | Party may have multiple addresses. |
| PARTY-015 | Primary address semantics are deterministic and race-safe (one non-archived primary). |
| PARTY-016 | Names are not globally unique identifiers. |
| PARTY-017 | Potential duplicates must never be automatically merged. |
| PARTY-018 | Archived Parties retain historical identity and child records. |
| PARTY-019 | Party is not an Auth User. |
| PARTY-020 | Organization Party is not automatically a Hector Company/Tenant. |
| PARTY-021 | Party does not own Supplier purchasing terms. |
| PARTY-022 | Party does not own Customer financial debt. |
| PARTY-023 | Party does not own Partner ownership/accounting truth. |
| PARTY-024 | Party does not own Loan/Funding balances. |
| PARTY-025 | Party child records cannot cross tenant boundaries. |
| PARTY-026 | Party integrity tooling is read-only. |
| PARTY-027 | Party type cannot change after creation. |
| PARTY-028 | `displayName` resolution is server-deterministic (see architecture doc). |
| PARTY-029 | nationalId / registrationNumber are unique per company when present. |
| PARTY-030 | Soft-delete / archive only — no hard delete of referenced Parties. |

## Domain linking invariants (Phase 5.5.2)

| ID | Invariant |
|---|---|
| PARTY-LINK-001 | Every Supplier references exactly one canonical Party after migration. |
| PARTY-LINK-002 | Every Customer references exactly one canonical Party after migration. |
| PARTY-LINK-003 | Supplier identity is owned by Party. |
| PARTY-LINK-004 | Customer identity is owned by Party. |
| PARTY-LINK-005 | One Party may simultaneously be Supplier and Customer. |
| PARTY-LINK-006 | One Party may simultaneously be Partner and Lender. |
| PARTY-LINK-007 | Supplier-specific data remains owned by Purchasing. |
| PARTY-LINK-008 | Customer-specific data remains owned by Sales. |
| PARTY-LINK-009 | Loan/liability truth remains owned by Finance. |
| PARTY-LINK-010 | Partner ownership truth is not owned by Party. |
| PARTY-LINK-011 | Domain links cannot cross Company boundaries. |
| PARTY-LINK-012 | Strong identity reuse must be deterministic. |
| PARTY-LINK-013 | Name alone must never trigger automatic Party merge. |
| PARTY-LINK-014 | Ambiguous identities must never be automatically merged. |
| PARTY-LINK-015 | Migration must be idempotent. |
| PARTY-LINK-016 | Migration must preserve historical operational records. |
| PARTY-LINK-017 | Party archive must not destroy domain history. |
| PARTY-LINK-018 | Domain deactivation must not automatically archive Party. |
| PARTY-LINK-019 | Identity updates occur through Party, not duplicated domain fields. |
| PARTY-LINK-020 | Migration must not alter economic amounts. |
| PARTY-LINK-021 | FX obligations must remain unchanged by identity migration. |
| PARTY-LINK-022 | Capital and Loans remain distinct even when linked to same Party. |
| PARTY-LINK-023 | Contact method and Contact Person are distinct concepts. |
| PARTY-LINK-024 | Migration diagnostic/reconciliation tools are read-only. |
| PARTY-LINK-025 | No permanent dual identity source-of-truth is allowed. |
