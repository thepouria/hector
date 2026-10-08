# HECTOR
# P.1 — PRODUCTION READINESS AUDIT

**Audit date:** 2026-10-07  
**Scope:** Phases 0–6 core (Products, Parties, Purchasing, Warehouse, Finance, Sales foundations, Settlement, Reconciliation)  
**Out of scope:** Marketplace APIs, Profit Engine, Pricing Engine, Buy Box, advanced wholesale  
**Method:** Inspect → Run → Test → Audit → Classify → Report  
**Evidence tags:** `VERIFIED` | `CODE REVIEW ONLY` | `NOT VERIFIED` | `NOT IMPLEMENTED`

### Amendment (2026-10-07) — P.1.1 / P.1.2

| ID | Status | Evidence |
| --- | --- | --- |
| PR-004 | **CLOSED** | P.1.1 + full E2E 598/598; post-E2E inventory/valuation/warehouse PASS — `docs/p-1-1-inventory-fifo-stabilization.md`, `docs/p-1-2-ci-integrity-hardening.md` |
| PR-005 | **CLOSED** | `pnpm integrity:all` CI-gated after E2E (no DB reset); hard violations 0 — `docs/p-1-2-ci-integrity-hardening.md` |

**P.1 overall remains NO-GO** (PR-001, PR-002, PR-003, PR-006, PR-007 still open). Historical sections below retain the original audit wording.

---

## 1. Executive Summary

Hector’s **domain core is substantially built and, on a clean migrated+seeded database, passes all available integrity checkers**. Money uses `Prisma.Decimal`, company scoping + RBAC are enforced in Nest guards, security e2e covers tenant/IDOR paths for finance, and CI runs typecheck/lint/unit/security/e2e/build against Postgres.

However, Hector is **not operationally ready to hold real Pishteh inventory/financial data**. There is **no backup/restore capability**, **no application container/deploy artifact** (Compose runs Postgres only), **demo seed is the only bootstrap path**, post–e2e shared-DB integrity can fail badly (including FIFO/valuation mismatches), one warehouse transfer e2e failed conservation checks on a polluted DB, and CI omits finance/settlement/party/sales/valuation integrity gates.

**Verdict for entering real operational/financial data: NO-GO.** Domain quality is high enough to proceed into Production Readiness work (P.2–P.4), not high enough to cut over.

---

## 2. Final Decision

```text
NO-GO
```

**Why (mandatory blockers):**

| ID | Severity | Blocker |
| --- | --- | --- |
| PR-001 | P0 | No automated backup / no verified restore path for PostgreSQL |
| PR-002 | P0 | No reproducible production app deployment (no Dockerfile/process manager for API/Web) |
| PR-003 | P0 | Risk of demo/dev seed data and weak secrets if production bootstrap is not strictly separated |
| PR-004 | ~~P1~~ **CLOSED** (see amendment) | Was: shared-DB post-E2E inventory/FIFO risk — re-proven and CI-gated in P.1.1/P.1.2 |
| PR-005 | ~~P1~~ **CLOSED** (see amendment) | Was: missing finance/settlement/valuation integrity in CI — `integrity:all` post-E2E now mandatory |

Remaining mandatory blockers: **PR-001, PR-002, PR-003, PR-006, PR-007**. Domain correctness on clean bootstrap + post-E2E integrity is strong (`VERIFIED`). That still does **not** satisfy recoverability, deploy safety, or production hygiene.

---

## 3. Architecture Overview

```text
Monorepo (pnpm + Turborepo)
├── apps/api          NestJS modular monolith (/api/v1 + GET /health)
├── apps/web          Next.js App Router + Tailwind
└── packages/
    ├── database      Prisma schema, migrations, seed, integrity CLIs
    ├── config / types / validation
```

| Concern | Implementation | Evidence |
| --- | --- | --- |
| Backend | NestJS modular monolith | `apps/api` |
| Frontend | Next.js (App Router) | `apps/web` |
| Database | PostgreSQL 16 | `docker-compose.yml` |
| ORM | Prisma | `packages/database` |
| Tenancy | Company-scoped via `X-Company-Id` + membership | `CompanyContextGuard` |
| Auth | JWT access + HttpOnly refresh cookie | `AuthModule`, `refresh-cookie.service.ts` |
| AuthZ | Permission keys + `PermissionsGuard` | `RbacModule` |
| Events | In-process `commitThenPublish` (no outbox/broker) | `infrastructure/events/` |
| Jobs | No Cron/Bull workers found | `CODE REVIEW ONLY` |
| Audit | `AuditLog` + domain events | docs + modules |
| Health | `GET /health` + DB ping | `HealthService` |
| Local infra | Compose = Postgres only | `docker-compose.yml` |

---

## 4. Repository / Git State

| Item | Value | Evidence |
| --- | --- | --- |
| Branch | `main` | `git branch --show-current` `VERIFIED` |
| HEAD | `6368cc6 feat:finance and other stuff` | `git log -10 --oneline` `VERIFIED` |
| Working tree at audit close | Clean (0 modified / 0 untracked) | `git status --porcelain` `VERIFIED` |
| Migrations present | 53 migration directories under `packages/database/prisma/migrations` | `VERIFIED` |
| Recent domain migrations | Party, settlement, channel settlement, reconciliation (20261013–20261018) | `VERIFIED` |

Note: Conversation-start snapshot showed large uncommitted Phase 5–6 trees; at audit close the tree was clean on `main`. Unrelated local work was not modified by this audit beyond `docker compose down -v` / migrate / seed for verification.

---

## 5. Build & Test Baseline

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm db:generate` | Used successfully before checks | Prior runs `VERIFIED` |
| `pnpm typecheck` | Pass (prior audit runs) | Terminal logs `VERIFIED` |
| `pnpm lint` | Pass (`--max-warnings 0`) | `VERIFIED` |
| `pnpm test` (unit) | 54 suites / 292 tests pass | Terminal 871755 `VERIFIED` |
| `pnpm test:security` | 32/32 pass | Terminals 408191 / 871755 `VERIFIED` |
| `pnpm test:e2e` | **591 passed, 1 failed** | Terminal 815048 `VERIFIED` |
| Failing e2e | `stock-transfer.e2e-spec.ts` — conservation Expected `MATCH` Received `MISMATCH` | `VERIFIED` |
| `pnpm build` | API + Web production build pass | Terminal 408191 `VERIFIED` |
| Clean integrity (all domains) | **OK** after `down -v` + migrate + seed | This session `VERIFIED` |
| Dirty post-e2e integrity | warehouse/inventory/valuation/settlement/phase6 **FAILED** | This session (pre-reset) `VERIFIED` |
| Seed idempotency | Second `pnpm db:seed` completes | This session `VERIFIED` |

---

## 6. Environment Configuration

Source: `.env.example` + `apps/api/src/config/env.validation.ts` (`VERIFIED` / `CODE REVIEW ONLY`).

| Variable | Class | Notes |
| --- | --- | --- |
| `NODE_ENV` | required | `development` \| `test` \| `production` |
| `API_PORT` | required | API listen port |
| `DATABASE_URL` | required / secret | Postgres URL |
| `JWT_ACCESS_SECRET` | required / secret | ≥32 chars; production rejects weak markers |
| `JWT_ACCESS_TTL` | optional | default `15m` |
| `AUTH_SESSION_TTL_DAYS` | optional | default `30` |
| `AUTH_REFRESH_COOKIE_NAME` | optional | default `hector_refresh` |
| `CORS_ORIGINS` | required in practice | rejects `*` / `null`; default localhost |
| `SWAGGER_ENABLED` | optional | prod should set `false` |
| `LOG_LEVEL` | optional | default `info` |
| `DEV_SEED_PASSWORD` | development-only / secret | seed users |
| `NEXT_PUBLIC_API_URL` | frontend public | browser-visible API base |
| `WEB_PORT` / `POSTGRES_*` | local/compose | compose defaults |

**Production fail-safe (`VERIFIED` via unit tests + code):** production rejects JWT secrets containing `dev-only`, `change-me`, `example`, `placeholder`, `hector-jwt`, etc. CORS `*` rejected when credentials enabled.

**Gap:** No separate production bootstrap env checklist committed as a deploy runbook; `.env.example` is clearly development-oriented.

---

## 7. Secrets

| Finding | Category | Evidence |
| --- | --- | --- |
| `.env.example` contains labeled **dev** passwords/JWT placeholders | Expected for local | `CODE REVIEW ONLY` |
| Local `.env` present (not printed) | Secret (gitignored assumed) | User workspace |
| No committed production private keys / live API tokens found in scanned source | Search | `rg` over apps/packages `.github` `VERIFIED` (no live secrets echoed) |
| Pino redact list includes `password`, `passwordHash`, `JWT_ACCESS_SECRET` | Logging hygiene | `app.module.ts` `CODE REVIEW ONLY` |
| Compose default `hector_dev_password` | Dev default risk if reused in prod | `docker-compose.yml` |

**Do not use** example JWT / `DEV_SEED_PASSWORD` / compose default DB password in production.

---

## 8. Authentication

| Check | Status | Evidence |
| --- | --- | --- |
| Login / logout | Implemented + security e2e | `VERIFIED` (security suite) |
| Invalid credentials generic error | Covered | security e2e `VERIFIED` |
| Session expire / revoke | Covered | security e2e `VERIFIED` |
| Refresh rotation + reuse revoke | Covered | security e2e `VERIFIED` |
| Cookie: HttpOnly | Yes | `refresh-cookie.service.ts` `CODE REVIEW ONLY` |
| Cookie: Secure in production | `refreshCookieSecure: nodeEnv === 'production'` | `auth.config.ts` `CODE REVIEW ONLY` |
| Cookie: SameSite | `lax` | `CODE REVIEW ONLY` |
| Password hashing | Dedicated hasher service | `CODE REVIEW ONLY` |
| Disabled/suspended users | Membership deny paths tested | security e2e `VERIFIED` |

---

## 9. Authorization / RBAC

Backend enforcement via `PermissionsGuard` + permission keys (`CODE REVIEW ONLY`), with finance IDOR/RBAC cases in security e2e (`VERIFIED`).

Representative domains with permissioned controllers: Catalog, Purchasing, Warehouse, Finance (accounts, capital, loans, payments, payables), Party, Settlement, Reconciliation, Sales (`CODE REVIEW ONLY`).

Frontend hiding is **not** treated as authorization. Warehouse operators are denied finance mutations in security e2e (`VERIFIED`).

---

## 10. Tenant Isolation

| Check | Status |
| --- | --- |
| Cross-company via `X-Company-Id` | Denied in security e2e `VERIFIED` |
| Finance accounts/payments/capital/loans/FX IDOR | Covered `VERIFIED` |
| Members/roles/audit cross-company | Covered `VERIFIED` |
| Exhaustive Party/Settlement/Reconciliation IDOR matrix | Partially covered by patterns; not every entity exercised in security suite — residual `CODE REVIEW ONLY` / gap P2 |

**No exploitable tenant leak demonstrated in security suite.** Residual: expand security e2e to Party / Settlement / Reconciliation / Warehouse detail IDORs before soft launch.

---

## 11. Database Schema

Prisma schema is large (~6k lines) with company FKs, money as `Decimal`, inventory ledger + balances, finance movements, settlement allocations, reconciliation entities (`CODE REVIEW ONLY`).

Strengths: explicit currency enums (`IRR`/`USD`), unique business numbers, ledger-oriented inventory.

Risks observed operationally: after heavy e2e, orphan balances and FIFO layer equation failures appeared (`VERIFIED` on dirty DB) — indicating either test pollution writing inconsistent fixtures **or** rare production paths that must be eliminated. Clean seed state reconciles (`VERIFIED`).

---

## 12. Migration Safety

| Check | Status |
| --- | --- |
| Ordered Prisma migrations | Present; lock file `VERIFIED` |
| Clean deploy | `pnpm db:migrate:deploy` on empty volume succeeded `VERIFIED` |
| Destructive reset in migrations | Not observed as default path; volume wipe is operator `down -v` only `CODE REVIEW ONLY` |
| Historical upgrade simulation from ancient Phase 0 DB | `NOT VERIFIED` (impractical full chain in P.1; limitation stated) |
| Irreversible data migrations | Several domain expansions likely irreversible without restore — treat forward-only + backup as policy |

---

## 13. Product Master

Catalog integrity OK on clean DB (`VERIFIED`). Architecture docs + e2e coverage for brands/categories/SKUs/barcodes exist (`CODE REVIEW ONLY` / prior phases). Duplicate barcode handling is intentional catalog invariant territory — rely on integrity + existing tests; browser lifecycle smoke `NOT VERIFIED` in this audit.

---

## 14. Party / Supplier

Party integrity OK (`VERIFIED`). Party module + linking migrations present. Supplier ↔ Party linking documented and seeded. Duplicate detection by strong identifiers is designed; name-only auto-merge not observed as default (`CODE REVIEW ONLY`). Deactivate-vs-history: archive/status patterns preferred over hard delete for economic entities (`CODE REVIEW ONLY`).

---

## 15. Purchasing

Purchasing integrity OK on clean DB (`VERIFIED`). Extensive e2e (PO types, partial receipt, short-close, GRN). CI runs `db:check:purchasing`. Over-receipt and quantity progress covered in purchasing tests/contracts (`CODE REVIEW ONLY` + prior e2e pass counts). Dirty DB showed `received_po_with_remaining` violations after e2e pollution — treat as test isolation / status accounting review (P2) unless reproducible on clean path.

---

## 16. Warehouse

Clean warehouse integrity OK (`VERIFIED`). Movement types, transfers, issues, putaway, counts, tester classification implemented. Stock-transfer conservation e2e **failed once** on shared DB (`VERIFIED` failure). **Must re-run transfer suite alone on clean DB before go-live** (`NOT VERIFIED` isolated re-proof in this session after reset).

---

## 17. Inventory Integrity

| State | Result |
| --- | --- |
| Clean migrate+seed | Inventory OK; orphanBalances=0 `VERIFIED` |
| After full e2e (pre-reset) | Orphan zero-qty TESTER balance; valuation QTY_RECON + LAYER_EQ failures `VERIFIED` |

Ledger is intended source of truth with balance projection + rebuild scripts (`inventory-ledger.service.ts`, `rebuild-inventory-balances`) `CODE REVIEW ONLY`. Direct balance mutation outside ledger is architecturally discouraged; query service documents read-only balances.

---

## 18. FIFO / Valuation Foundation

Valuation integrity **PASSED** on clean seed (`VERIFIED`). Dirty DB showed physical ≠ layer remaining across SELLABLE/TESTER/DAMAGED/QUARANTINE and 77 layers with `remaining+consumed ≠ original` (`VERIFIED`). Treat as **P1 gate**: prove FIFO invariants under transfer/issue/reclass concurrency on clean DB; add valuation check to CI.

---

## 19. Finance

Canonical money: `apps/api/src/modules/finance/money/money.ts` uses `Prisma.Decimal` only for authoritative math (`CODE REVIEW ONLY`). Finance integrity OK on clean DB (`VERIFIED`). Opening balance API with idempotency exists (`accounts.service.ts` `recordOpeningBalance`) `CODE REVIEW ONLY`. Dashboard uses `Number` only for counts, not money (`CODE REVIEW ONLY`).

Prior dirty DB showed `orphan_payment_movement_source` (finance integrity FAIL) — e2e pollution risk; clean state OK.

---

## 20. Capital

Capital contribution flows, journals, and Party linkage implemented with dedicated numbering and events (`CODE REVIEW ONLY`). Security e2e covers capital/loans RBAC/IDOR (`VERIFIED`). Full UI capital path browser execution in this audit: `NOT VERIFIED`.

---

## 21. Loans

IRR/USD loan funding/repayment services present (`CODE REVIEW ONLY`). Distinct from capital (separate models/constants). Security coverage for loans IDOR (`VERIFIED`). End-to-end “pay supplier must not settle loan” critical path: covered by domain design + settlement e2e areas; full UI path `NOT VERIFIED`.

---

## 22. FX

FX rates, conversions, USD liabilities, FX settlement detail migrations present (`CODE REVIEW ONLY`). Settlement FX composite unique migration applied on clean deploy (`VERIFIED`). Implicit global IRR-only for multi-currency paths not observed as architecture default — currency is explicit on money types (`CODE REVIEW ONLY`).

---

## 23. Settlement

Settlement integrity **0 hard violations** on clean seed (`VERIFIED`). Dirty DB: `partially_settled_with_zero_allocated`, `channel_settlement_source_missing` (`VERIFIED`). Allocation capacity modules exist (`payment-allocation-capacity.ts`, settlement services) `CODE REVIEW ONLY`. Core settlement e2e suites exist.

---

## 24. Channel Settlement

Manual channel settlement foundation (Khanoumi/Digikala/Snapp Shop as channel entities) present; advanced marketplace sync **out of scope**. Gross-to-net helpers and channel settlement numbering exist (`CODE REVIEW ONLY`). Clean integrity OK; dirty DB orphaned channel items after e2e.

---

## 25. Reconciliation

Reconciliation integrity 0 hard violations on clean and dirty (`VERIFIED`). Engine + UI routes under settlements/reconciliation (`CODE REVIEW ONLY`). Resolved-difference history preservation is designed in domain docs/state machine; full browser resolution path `NOT VERIFIED`.

---

## 26. Audit / Events

| Topic | Finding |
| --- | --- |
| Audit trail | Mutations audited; security e2e checks success vs failed audits `VERIFIED` |
| Immutability | No ordinary user API to rewrite audit history found `CODE REVIEW ONLY` |
| Events | In-process after commit via `commitThenPublish` `CODE REVIEW ONLY` |
| Delivery risk | Process crash after commit before publish can drop side effects; no outbox `P2` |
| Brokers/queues | `NOT IMPLEMENTED` |

---

## 27. Concurrency

| Area | Status |
| --- | --- |
| Inventory balance row locks | Documented in ledger service `CODE REVIEW ONLY` |
| Last-owner concurrent removal | security e2e `VERIFIED` |
| Dual issue 8+8 on qty 10 | Dedicated concurrency proof not isolated in this audit `NOT VERIFIED` |
| Finance double-spend / over-allocation | Covered in part by e2e + capacity rules `CODE REVIEW ONLY` |

---

## 28. Idempotency

Finance opening balance, payments/receipts, and many mutations use `requestId` / idempotency conflict codes (`CODE REVIEW ONLY`). Security/e2e suites exercise many flows; exhaustive retry matrix for capital/loan/transfer `NOT VERIFIED` as a single harness.

---

## 29. API Safety

| Control | Status |
| --- | --- |
| ValidationPipe / DTOs | Present `CODE REVIEW ONLY` |
| Global exception filter | Controlled error body; no passwordHash in responses (security e2e) `VERIFIED` |
| Rate limiting | `@nestjs/throttler` default 120/min; headers observed in security logs `VERIFIED` |
| CORS | Explicit origins; `*` rejected `VERIFIED` (unit) |
| CSRF | Refresh cookie scoped to `/api/v1/auth` + Origin check for cookie refresh (security e2e) `VERIFIED`; access token bearer pattern reduces classic CSRF on mutations |
| File upload | No general upload pipeline found → **N/A** `CODE REVIEW ONLY` |
| Pagination | List DTOs extend pagination; unbounded lists residual risk → spot-check P2 |

---

## 30. Frontend / UX

| Check | Status |
| --- | --- |
| Production build | Pass `VERIFIED` |
| Routes exist | Login, products, parties, purchasing, warehouse, finance, settlements, sales `CODE REVIEW ONLY` / build route list |
| Browser smoke of critical pages | `NOT VERIFIED` in P.1 session |
| Empty DB UX | `NOT VERIFIED` |
| Deep-link refresh | `NOT VERIFIED` |
| Secret bundling | Only `NEXT_PUBLIC_*` expected client-side `CODE REVIEW ONLY` |

---

## 31. Performance

| Check | Status |
| --- | --- |
| N+1 review | Spot `CODE REVIEW ONLY` only; no systematic load test |
| 10k SKU simulation | `NOT VERIFIED` |
| Indexes | companyId/SKU/barcode patterns present in schema migrations `CODE REVIEW ONLY`; no speculative index adds in P.1 |

---

## 32. Background Jobs

**No CronModule / Bull queues / scheduled workers found** in API source (`CODE REVIEW ONLY` search). Integrity checks are **manual CLI** scripts. Production implication: no silent job double-run risk; also no automated periodic integrity monitor (`P2` observability).

---

## 33. Logging / Error Handling

Pino request logging with requestId, userId, companyId, redaction of secrets (`CODE REVIEW ONLY`). Production should avoid leaking stacks via filter (`CODE REVIEW ONLY`). Unhandled promise / empty catch: not exhaustively proven (`NOT VERIFIED`). ForceExit warnings in Jest indicate open handles in test harness (P3).

---

## 34. Deployment

| Artifact | Status |
| --- | --- |
| `docker-compose.yml` | Postgres only `VERIFIED` |
| App Dockerfile | **Absent** `VERIFIED` |
| Nginx / PM2 / systemd unit | **Absent** `NOT IMPLEMENTED` |
| CI | GitHub Actions verify job `VERIFIED` |
| Reproducible prod deploy | **No** — local Node processes assumed by README |

**Recommended future sequence (derived):** backup → migrate deploy → deploy API/Web compatible build → health → smoke → integrity CLIs. Not executable today without P.2 infra.

---

## 35. Backup / Restore

| Question | Answer |
| --- | --- |
| Automatic DB backups configured? | **No** `NOT IMPLEMENTED` |
| Frequency / retention / encryption / off-host? | N/A |
| Restore tested? | **No** `NOT VERIFIED` |
| Classification | **P0 go-live blocker** |

**Initial RPO/RTO recommendation (assumptions: single-company ops, daily finance/warehouse use):**

- **RPO:** ≤ 24h initially; target ≤ 1h once WAL/PITR available  
- **RTO:** ≤ 4h to restore Postgres + restart API/Web on single server  

Without meeting at least daily off-host backup + one successful restore drill, **do not enter real balances**.

---

## 36. Observability

| Question | Current |
| --- | --- |
| Backend alive? | `/health` DB ping `VERIFIED` code |
| Frontend alive? | No dedicated probe `NOT IMPLEMENTED` |
| Centralized errors (Sentry etc.) | **None found** `NOT IMPLEMENTED` |
| Metrics / APM | **None found** `NOT IMPLEMENTED` |
| Job failure visibility | N/A (no workers) |

---

## 37. Opening Data / Cutover

| Capability | Status |
| --- | --- |
| Opening account balance API | Exists `CODE REVIEW ONLY` |
| Opening supplier payable | Exists in finance payables `CODE REVIEW ONLY` |
| Opening stock | Via controlled adjustments / seed patterns; dedicated cutover UX unclear `CODE REVIEW ONLY` / gap |
| Opening capital / loans | Create flows exist; opening vs historical policy needed operationally |
| Production bootstrap seed | **Current seed is demo** (fake products, balances, sample POs) — **must not** run on production as-is `VERIFIED` (seed output) |
| Cutover date | Not chosen (correct for P.1); system can support cutover **if** opening workflows + empty bootstrap exist |

**Historical data strategy (recommendation):**

| Domain | Strategy |
| --- | --- |
| Products / Parties / Suppliers | Must import / create master data |
| Inventory | Opening stock sufficient; optional limited movement history |
| Finance accounts | Opening balances sufficient |
| Capital / Loans | Opening positions + documents; optional history |
| Purchases / Payables | Open items + opening AP; do not bulk-fake closed history |
| Sales / Channel settlements | Opening outstanding statements only |
| Audit | Start at cutover |

---

## 38. Critical Workflow Matrix

| Workflow | API | UI | Tests | Audit | Integrity | Production Ready |
| --- | --- | --- | --- | --- | --- | --- |
| Product | Yes | Yes | Strong | Yes | Clean OK | Conditional* |
| Supplier / Party | Yes | Yes | Strong | Yes | Clean OK | Conditional* |
| Purchase | Yes | Yes | Strong | Yes | Clean OK | Conditional* |
| Goods Receipt | Yes | Yes | Strong | Yes | Clean OK | Conditional* |
| Stock | Yes | Yes | Strong | Yes | Clean OK / dirty FAIL | **No** until transfer/FIFO gate |
| Stock Count | Yes | Yes | Present | Yes | Clean OK | Conditional* |
| Capital | Yes | Yes | Present | Yes | Clean OK | Conditional* |
| Loan | Yes | Yes | Present | Yes | Clean OK | Conditional* |
| Payment | Yes | Yes | Strong | Yes | Clean OK | Conditional* |
| Supplier Settlement | Yes | Yes | Present | Yes | Clean OK / dirty FAIL | Conditional* |
| Channel Settlement | Yes | Yes | Present | Yes | Clean OK / dirty FAIL | Soft-launch only |
| Reconciliation | Yes | Yes | Present | Yes | Clean OK | Conditional* |

\*Conditional = domain OK after ops/security/backup gates; not ready for real data under overall NO-GO.

---

## 39. Production Critical Path Results

| Path | Result |
| --- | --- |
| Party → Supplier → Product → PO → GRN → Stock → Payable → Payment → Allocation → Outstanding 0 | Covered extensively by e2e corpus; full single-run harness in this audit `NOT VERIFIED` as one script; suite-level evidence strong with 1 transfer failure |
| Capital → Account → Purchase → Supplier Payment (concepts distinct) | Design + services `CODE REVIEW ONLY`; browser `NOT VERIFIED` |
| Loan → Account → Purchase → Supplier Payment (loan remains) | Design supports separation `CODE REVIEW ONLY` |
| Warehouse: GRN → Batch → Location → Transfer → Tester → Count | Clean integrity OK; transfer e2e conservation fail on dirty DB `VERIFIED` anomaly |

---

## 40. Security Findings

| ID | Sev | Finding |
| --- | --- | --- |
| SEC-1 | — | Security e2e 32/32 pass (auth, RBAC, tenant, finance IDOR, cookie origin) `VERIFIED` |
| SEC-2 | P1 | Demo seed users (`*@hector.local`) + known `DEV_SEED_PASSWORD` pattern must never exist in prod |
| SEC-3 | P2 | `pnpm audit --prod`: 8 vulns (4 high / 4 moderate) incl. transitive `mysql2` via Prisma tooling path, `js-yaml` via swagger — triage, no mass upgrade in P.1 |
| SEC-4 | P2 | Expand IDOR coverage to Party/Settlement/Reconciliation/Warehouse |
| SEC-5 | P3 | Swagger must be disabled in production (`SWAGGER_ENABLED=false`) |
| SEC-6 | — | Rate limit present; login shares global limiter (consider stricter auth bucket later) P3 |

---

## 41. Integrity Results

### Clean bootstrap (`docker compose down -v` → up → migrate → seed) — `VERIFIED`

| Check | Result |
| --- | --- |
| catalog | OK |
| purchasing | OK |
| warehouse | OK |
| inventory | OK |
| valuation | PASSED |
| finance | OK |
| party | OK |
| settlement | 0 hard violations |
| reconciliation | 0 hard violations |
| sales | OK |
| phase6 | OK |

### After full e2e on shared DB (pre-reset) — `VERIFIED`

| Check | Result |
| --- | --- |
| warehouse | FAILED (`received_po_with_remaining`, orphan TESTER balance) |
| inventory | FAILED (1 orphan balance) |
| valuation | FAILED (QTY_RECON + LAYER_EQ) |
| finance | Prior run: orphan_payment_movement_source |
| settlement / phase6 | FAILED (partially_settled_with_zero_allocated, channel_settlement_source_missing) |

**Interpretation:** Clean product state is coherent. Shared e2e DB is not a trustworthy production proxy; either tests leave illegal residue or rare paths corrupt projections — both are go-live gates.

---

## 42. Test Results

| Suite | Result |
| --- | --- |
| Unit | 292 pass |
| Security e2e | 32 pass |
| Domain e2e | 591 pass / **1 fail** (`stock-transfer` conservation) |
| Skipped tests (finance-focused search) | No finance `.skip`/`xit` hotspot found in quick scan |
| CI gaps | Missing: finance, inventory, valuation, party, sales, settlement, reconciliation integrity scripts |

---

## 43. Production Readiness Scorecard

Score 0–5. Scores &lt;4 explained.

| Area | Score | Notes |
| --- | --- | --- |
| Architecture | 4 | Solid modular monolith |
| Database Integrity | 3 | Clean OK; dirty FAIL + e2e pollution |
| Inventory Correctness | 3 | Strong design; transfer fail + valuation dirty FAIL |
| Finance Correctness | 4 | Decimal SoT; clean integrity OK |
| Settlement Correctness | 3 | Clean OK; dirty FAIL; CI gap |
| Security | 4 | Strong security e2e; seed/prod hygiene gap |
| Tenant Isolation | 4 | Core verified; expand coverage |
| Authentication / Authorization | 4 | Production cookie/JWT rules present |
| Migration Safety | 3 | Clean deploy OK; historical upgrade not simulated |
| Backup / Recovery | **0** | Not implemented |
| Observability | 1 | Health only |
| Deployment Reproducibility | **1** | Postgres compose only |
| Operational UX | 3 | Apps exist; browser smoke not done |
| Testing | 4 | Broad; 1 failing e2e; CI integrity incomplete |
| Performance | 2 | No large-data proof |
| Cutover Readiness | 2 | Opening APIs exist; prod bootstrap missing |

---

## 44. Issue Register

### PRODUCTION READINESS ISSUE REGISTER

| ID | Severity | Domain | Issue | Evidence | Business Risk | Recommended Fix | Required Before Go-Live? | Complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PR-001 | P0 | Ops | No DB backup/restore | Audit §35 | Irrecoverable loss of inventory/finance | Automated off-host backups + restore drill | **Yes** | M |
| PR-002 | P0 | Deploy | No app Docker/PM deploy path | No Dockerfile; compose Postgres-only | Unsafe/non-reproducible production | Production images + runbook | **Yes** | L |
| PR-003 | P0 | Seed | Demo seed is only bootstrap; contains fake balances/POs | Seed logs `VERIFIED` | Contaminates real company truth | `seed:dev` vs `bootstrap:production` (roles/company only) | **Yes** | M |
| PR-004 | P1 | Inventory | ~~OPEN~~ **CLOSED** (P.1.1/P.1.2) | Was: transfer/FIFO post-E2E | — | See `docs/p-1-1-inventory-fifo-stabilization.md` | Closed | — |
| PR-005 | P1 | CI | ~~OPEN~~ **CLOSED** (P.1.2) | Was: missing integrity gates | — | See `docs/p-1-2-ci-integrity-hardening.md` | Closed | — |
| PR-006 | P1 | Security | Prod must not ship demo users/passwords | Seed + `.env.example` | Account takeover | Prod user provisioning checklist | **Yes** | S |
| PR-007 | P1 | Cutover | No documented empty-company production opening procedure | Seed is demo-heavy | Wrong opening balances | Opening-data runbook + UI/API checklist | **Yes** | M |
| PR-008 | P2 | Events | In-process events only (no outbox) | `commitThenPublish` | Lost side effects after crash | Document risk; later outbox | Soft-launch OK | L |
| PR-009 | P2 | Security | Dependency advisories (8) | `pnpm audit --prod` | Supply-chain | Triage/patch non-breaking | Soon | S |
| PR-010 | P2 | Security | Incomplete IDOR matrix for Party/Settlement/Recon/Warehouse | security.e2e scope | Tenant leak residual | Extend security e2e | Before broad multi-user | M |
| PR-011 | P2 | Test | E2E shared DB pollution | Dirty integrity | False confidence / hides bugs | Per-suite isolation or DB reset strategy | Yes for CI trust | M |
| PR-012 | P2 | Observability | No error monitoring / metrics | Search empty | Blind failures | Add health+error product (P.2/P.3) | Strongly recommended | M |
| PR-013 | P2 | Perf | No large-dataset proof | NOT VERIFIED | Ops pain at scale | Synthetic load in staging | Before heavy catalog | M |
| PR-014 | P3 | DX | Jest ForceExit / open handles | Test output | Flaky CI | Detect open handles | No | S |
| PR-015 | P3 | Docs | README still Phase-0.1 oriented in places | README | Operator confusion | Refresh runbooks | No | S |

---

## 45. GO-LIVE Blockers

```text
GO-LIVE BLOCKERS
```

1. **PR-001 (P0)** — Backup + verified restore  
2. **PR-002 (P0)** — Reproducible production deployment for API + Web + migrate  
3. **PR-003 (P0)** — Production bootstrap without demo financial/inventory data  
4. ~~**PR-004**~~ **CLOSED** — Inventory transfer/FIFO + post-E2E integrity  
5. ~~**PR-005**~~ **CLOSED** — CI `integrity:all` after E2E  
6. **PR-006 / PR-007 (P1 mandatory)** — Production users + opening/cutover procedure without demo seed  

Until these are closed, **do not enter real Pishteh operational or financial data**.

---

## 46. Required Fixes

**Before any real data (minimum):**

1. PostgreSQL backup automation + one successful restore in a scratch environment  
2. Production deploy artifacts and documented start sequence  
3. Split seed: development fixtures vs production bootstrap (company, roles, admin user, COA shells only)  
4. Fix/confirm stock-transfer conservation; add warehouse + valuation integrity to CI  
5. Add finance/settlement/party/sales integrity to CI  
6. Production secrets + disable Swagger + CORS lock to real origin  
7. Opening balance / opening stock / opening AP runbook  

**Do not** implement marketplace integrations or Profit Engine as part of closing these.

---

## 47. Recommended Fix Order

1. Data corruption risks (PR-004 transfer/FIFO; investigate e2e pollution)  
2. Security / tenant hygiene (PR-006, PR-010)  
3. Migration + CI integrity gates (PR-005)  
4. Backup / restore (PR-001)  
5. Production bootstrap / cutover (PR-003, PR-007)  
6. Deployment reproducibility (PR-002)  
7. Observability (PR-012)  
8. Operational UX browser verification  
9. Performance (PR-013)  
10. Dependency/cleanup (PR-009, PR-014, PR-015)  

---

## 48. Soft Launch Plan

**Do not enable every process on day one.** After blockers clear:

| Stage | Enable |
| --- | --- |
| 1 | Users/permissions, Products, Parties, Suppliers |
| 2 | Warehouses, locations, **opening stock** (verify ledger↔balance) |
| 3 | Finance accounts, **opening balances**, Capital, Loans |
| 4 | Purchasing, Goods Receipt, Supplier payments/allocations |
| 5 | Settlement / Reconciliation (manual channel statements) |

Defer: marketplace sync, advanced sales volume, automated channel imports.

---

## 49. Known Limitations

- No marketplace APIs (intentional)  
- Events are in-process only  
- No background workers  
- No app containers  
- No centralized APM/error product  
- Historical migration upgrade from Phase 0 not simulated end-to-end  
- Browser smoke and 10k-SKU load not executed in P.1  
- Full e2e currently leaves shared DB non-integral (test hygiene)

---

## 50. Final Production Recommendation

**Decision: NO-GO** for deploying Hector as the system of record for real Pishteh inventory, capital, loans, payables, or settlements.

**What is true:** On a clean database, domain integrity across catalog → warehouse → finance → party → settlement → reconciliation is **green**, security regression suite passes, and production builds succeed. The business core is close enough that Production Readiness engineering (infra, backup, seed split, integrity CI, inventory anomaly closure) is the correct next work — **not** more marketplace features.

**What is not true:** Passing most tests does not equal production safety. Without recoverability, a reproducible deploy path, a non-demo bootstrap, and a clean inventory/FIFO proof under CI, real data entry would put Pishteh at unacceptable risk.

**Stop condition:** P.1 complete. Do **not** start P.2/P.3/P.4, do not deploy production, do not enter real Pishteh data until this audit is reviewed and blockers are scheduled.

---

## Appendix A — Soft operational ownership (planning only)

| Domain | Suggested owner role |
| --- | --- |
| Products | Catalog admin |
| Purchasing | Purchasing |
| Goods receipt / putaway | Warehouse |
| Stock adjustment / count approve | Authorized warehouse manager |
| Finance payments / capital / loans | Finance admin |
| Settlement / reconciliation resolution | Finance / management |
| User/role admin | Owner |

Dangerous permissions to restrict tightly: stock adjustment, stock count post, payment/allocation reversal, capital/loan modification, reconciliation resolution, role management.

---

## Appendix B — First production transaction (after GO)

Small real purchase: one supplier, one SKU, small qty, one warehouse, one payment, then verify stock ledger↔balance, payable↔allocation, audit trail before scaling.

## Appendix C — Post-go-live checks

Stock ledger ↔ balance; finance movements ↔ account balance; PO ↔ GRN; payable ↔ settlement; outstanding ↔ allocations; audit who/what/when/why.
