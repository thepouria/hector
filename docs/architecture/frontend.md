# Hector — Phase 0.9 Frontend Shell

## Stack

- Next.js 15 App Router
- React 19 + TypeScript
- Tailwind CSS 4
- TanStack Query
- Vazirmatn (RTL Persian)

## Auth

Access JWT stays in memory. Refresh uses HttpOnly cookie (`hector_refresh`) via `credentials: 'include'`.

Bootstrap: refresh → `/auth/me` → companies → active company → `/me/authorization`.

## Company

`activeCompanyId` may persist in localStorage (not a secret). Always validated against server memberships. Company-scoped requests send `X-Company-Id`.

## Permissions

Frontend `can()` is UX-only. NestJS RBAC remains authoritative.

## Routes

```text
/login
/app/dashboard
/app/products|warehouse|purchasing|sales|finance|settlements  (placeholders)
/app/audit
/app/settings/{company|members|roles}
```
