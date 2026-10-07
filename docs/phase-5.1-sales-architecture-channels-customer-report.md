# HECTOR — Phase 5.1
## Sales Architecture + Channels + Customer Master Report

**PHASE 5.1 STATUS: COMPLETE**  
**SALES ARCHITECTURE: READY** · **CHANNEL MASTER: READY** · **CUSTOMER MASTER: READY**  
**READY FOR PHASE 5.2**

---

### 1. Baseline

Prior phases (0–4) complete. No Sales Channel / Customer models existed before 5.1. Implementation mirrored Supplier Master patterns.

### 2. Architecture Decisions

- New Nest `SalesModule` under `apps/api/src/modules/sales/`
- Company-scoped masters with `@@unique([id, companyId])` + Restrict FKs
- Channel `code` required + UPPER-normalized; Customer `code` optional
- Status `ACTIVE`/`INACTIVE` with explicit activate/deactivate endpoints
- Default address enforced via service transaction + partial unique index
- Domain events omit phone / nationalId / notes (ids + type/status only)

### 3. Sales Source-of-Truth Boundaries

Sales owns Channels, Customers, and (later) commercial sale facts. Documented in `docs/sales-architecture.md` and SALE-001…020.

### 4. Catalog Boundary

Catalog remains Product/SKU authority. Sales never creates parallel SKU master (SALE-003).

### 5. Warehouse Boundary

Warehouse owns stock/FIFO/movements. Sales does not mutate stock in 5.1 (SALE-004, SALE-015).

### 6. Finance Boundary

Finance owns ledger/cash/receivables truth. Customer Master does not store balances (SALE-005, SALE-011, SALE-013, SALE-014).

### 7. Sales Channel Model

`SalesChannel`: id, companyId, code, name, type, status, notes?, timestamps, createdById?, archivedAt?

### 8. Channel Types

`WEBSITE` | `MARKETPLACE` | `WHOLESALE` | `MANUAL` | `OTHER` — marketplace brands are codes, not enums.

### 9. Seeded Channels

Pishteh: WEBSITE, KHANOUMI, DIGIKALA, SNAPP_SHOP, WHOLESALE, MANUAL (+ Demo B WHOLESALE for IDOR). Idempotent by companyId+code. Sample customer `CUS-DEMO`.

### 10. Customer Model

`Customer`: type, displayName required; optional code/contact/tax fields; ACTIVE/INACTIVE.

### 11. Customer Address Model

`CustomerAddress` with optional geography fields; at most one active `isDefault` per customer.

### 12. Optional Customer Fields

email, nationalId, taxId, registrationNumber, address, notes, phone, mobile, businessName — all optional at create.

### 13. Tenant Isolation

All queries scoped by `@CurrentCompany()`. Cross-company IDOR → 404. Body `companyId` rejected (forbidNonWhitelisted).

### 14. RBAC

| Permission | Use |
| --- | --- |
| `sales.channels.read` | List/get channels |
| `sales.channels.manage` | Create/update/activate/deactivate |
| `sales.customers.read` | List/get customers |
| `sales.customers.manage` | Create/update/status/addresses |

Registered in `permissions.ts` + web `keys.ts`; OWNER sync via seed.

### 15. Audit

Entity types: `SALES_CHANNEL`, `CUSTOMER`, `CUSTOMER_ADDRESS`.  
Actions: CREATED, UPDATED, ACTIVATED, DEACTIVATED, ADDRESS_*, ADDRESS_DEFAULT_CHANGED.

### 16. Domain Events

- `sales.channel.created|updated|status_changed`
- `sales.customer.created|updated|status_changed`
- `sales.customer.address_created|address_updated|address_archived|address_default_changed`

Published via `commitThenPublish`.

### 17. Database Constraints / Indexes

- Unique `(companyId, code)` on channels and customers
- Indexes on status/type/displayName/mobile
- Partial unique: `customer_addresses_one_default_active` WHERE is_default AND archived_at IS NULL
- Migration: `20261010180000_sales_channel_customer`

### 18. API Implemented

| Method | Path |
| --- | --- |
| GET/POST | `/api/v1/sales/channels` |
| GET/PATCH | `/api/v1/sales/channels/:id` |
| POST | `/api/v1/sales/channels/:id/activate\|deactivate` |
| GET/POST | `/api/v1/sales/customers` |
| GET/PATCH | `/api/v1/sales/customers/:id` |
| POST | `/api/v1/sales/customers/:id/activate\|deactivate` |
| POST/PATCH | `/api/v1/sales/customers/:id/addresses[/:addressId]` |
| POST | `.../addresses/:addressId/set-default\|archive` |

### 19. Tests Added

- Unit: `sales.normalization.spec.ts` — **3 passed**
- E2E: `sales-channels.e2e-spec.ts` + `sales-customers.e2e-spec.ts` — **19 passed** (2 suites)
- Full unit suite: **295 passed** (55 suites)
- Security suite: **32 passed**

### 20. Security Tests

Unauthenticated 401, RBAC 403, IDOR 404, mass-assignment 400, unique code 409 covered in sales e2e. Security suite passed (new OWNER permissions auto-synced — 102 total).

### 21. Clean Bootstrap

**PASS** — `docker compose down -v` → up → migrate deploy (43 migrations including sales) → generate → seed ×2 idempotent.

### 22. Previous Phase Regression

| Check | Result |
| --- | --- |
| typecheck | PASS |
| lint | PASS |
| unit test | PASS (295) |
| test:security | PASS (32) |
| sales e2e | PASS (19) |
| finance:integrity | OK (0 violations) |
| db:check:catalog | OK |
| db:check:purchasing | OK |
| db:check:warehouse | OK |
| build | PASS |
| Browser QA | NOT TESTED |

### 23. Known Limitations

- No SalesOrder / reservation / fulfillment / receivables
- No marketplace APIs or credentials
- No Buy Box / Profit
- Browser QA: NOT TESTED

### 24. Technical Debt

- Web UI for channels/customers not built (API-only in 5.1)
- Customer code sequencing not automated (manual optional code)

### 25. Open Issues

None blocking Phase 5.2.

### 26. Phase 5.1 Completion Gate

| Gate | Answer |
| --- | --- |
| Define Website/Khanoumi/Digikala/Snapp/Wholesale channels? | YES |
| Add future channels without schema redesign? | YES |
| Marketplace APIs/credentials required now? | NO |
| Individual + Business customers? | YES |
| Minimal customer create? | YES |
| Customer later many orders / wholesale reference? | YES (ready) |
| Customer stores debt balance? | NO |
| Sales duplicates SKU / owns stock / owns ledger / calculates Profit / Buy Box? | NO |
| Company-isolated? | YES |

**STOP — do not start Phase 5.2 in this change set.**
