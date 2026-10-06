# RBAC

## Authorization hierarchy

```text
User
  ↓
CompanyMember
  ↓
CompanyMemberRole
  ↓
Role (company-scoped)
  ↓
RolePermission
  ↓
Permission (global)
```

Effective permissions for a member are the **union** of permissions from all non-deleted roles assigned to an `ACTIVE` membership.

## Permission convention

```text
resource.action
```

Registry (single source of truth): `@hector/database` → `PERMISSIONS` / `PERMISSION_DEFINITIONS`.

Phase 0.6 keys:

```text
company.read
company.update
member.read
member.create
member.update
member.remove
role.read
role.create
role.update
role.delete
role.assign
role.permissions.update
permission.read
audit.read
```

Obsolete Phase 0.2 keys removed by seed sync: `member.invite`.

Permissions are code-defined. There is no company API to create/delete permissions.

See also: `docs/architecture/audit.md` for audit trail behavior.

## Request pipeline

```text
Authentication Guard
  ↓
Company Context Guard
  ↓
Permissions Guard
  ↓
Controller
```

## Decorator

```ts
@RequirePermissions(PERMISSIONS.MEMBER_READ)
```

**AND semantics**: every listed permission is required. No silent ANY behavior in Phase 0.6.

## OWNER

- System role (`isSystem = true`, key `OWNER`)
- Permission set is **code-managed** via `syncOwnerRolePermissions` (seed/sync)
- Cannot be deleted or have permissions manually reduced via API
- Only an existing ACTIVE OWNER may grant or remove the OWNER role
- Last ACTIVE OWNER cannot be removed/suspended/stripped (`LAST_OWNER_REQUIRED`, company row locked)

## Custom roles

- `isSystem = false`
- Key: uppercase snake case, immutable after creation
- Soft-deleted via `deletedAt`
- Cannot delete while assigned to ACTIVE/SUSPENDED members (`ROLE_IN_USE`)
- Permission composition requires `role.permissions.update` (OWNER-seeded)

## System roles

`OWNER` and `WAREHOUSE_OPERATOR` are system-managed identities. Permission composition for system roles is code-managed (not editable via API). `WAREHOUSE_OPERATOR` currently has no inventory permissions (deferred).

## Immediate authorization

Roles/permissions are resolved server-side per request. They are **not** stored in JWT. Changes take effect on the next request without re-login.

## Company isolation

Roles belong to exactly one company. Lookups always scope `roleId + companyId`. Cross-company assignment/read returns safe errors.

## Escalation prevention

1. Only OWNER may grant/remove OWNER
2. Non-owners with `role.assign` may only assign roles whose effective permissions are a **subset** of their own
3. Same subset rule applies on member creation role lists
4. `role.permissions.update` is OWNER-seeded to prevent custom admins from composing stronger roles

## Company creation (future)

When companies are created later, provision system roles and run `syncOwnerRolePermissions` for that company. Do not hard-code Pishteh.

## Current authorization endpoint

```http
GET /api/v1/me/authorization
Authorization: Bearer …
X-Company-Id: …
```

Returns the caller's roles + sorted effective permission keys for UX. Backend guards remain authoritative.

## Deferred

```text
AuditLog writes → Phase 0.7
Domain Events → Phase 0.8
Inventory / finance permissions → later domain phases
```
