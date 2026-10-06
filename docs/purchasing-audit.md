# Purchasing Audit (Phase 2.15)

Purchasing uses the **Phase 0** `AuditService` — there is no second audit system.

Audit answers **who / what / which entity / when / which company / what changed**.  
Domain Events are separate (`docs/purchasing-events.md`).

---

## Transaction model

```text
Prisma $transaction {
  domain mutation
  AuditService.record(tx, …)   // same transaction
  collect DomainEvent in memory
}
→ commitThenPublish → DomainEventBus (after commit)
```

- No-op snapshots (`before === after`) skip Audit insert and typically skip related events.
- Failed / rolled-back mutations leave **no** success Audit row.
- Audit rows are append-only; no PATCH/DELETE for normal users.

---

## Actor / metadata

| Field | Source |
|---|---|
| companyId | Trusted company context |
| actorUserId / actorCompanyMemberId | Authenticated ALS |
| requestId | Request middleware |
| IP / userAgent | Request context (raw audit only) |

Sensitive auth material is never audited (tokens, passwords, cookies, Authorization).

Money / FX values are stored as **strings** in snapshots (Decimal-safe).

---

## Action catalog

| Area | Actions |
|---|---|
| Supplier | `SUPPLIER_CREATED`, `UPDATED`, `ACTIVATED`, `DEACTIVATED`, `ARCHIVED` |
| Contact | `SUPPLIER_CONTACT_CREATED`, `UPDATED`, `PRIMARY_CHANGED`, `ARCHIVED` |
| Note | `SUPPLIER_NOTE_CREATED` |
| Offer | `SUPPLIER_OFFER_CREATED`, `UPDATED`, `ARCHIVED` |
| PO | `PURCHASE_ORDER_CREATED`, `UPDATED`, item add/update/remove |
| Lifecycle | `PURCHASE_ORDER_APPROVED`, `ORDERED`, `CANCELLED` |
| Costs | `PURCHASE_COST_CREATED`, `UPDATED`, `VOIDED`, `REMOVED` |
| Correction | `PURCHASE_ORDER_CORRECTED`, `PURCHASE_DUE_DATE_CHANGED`, `PURCHASE_FX_TERMS_CHANGED` |
| Discrepancy | `PURCHASE_DISCREPANCY_RECORDED`, `PURCHASE_ORDER_SHORT_CLOSED` |
| Return | `PURCHASE_RETURN_CREATED`, `UPDATED`, `APPROVED`, `CANCELLED` |

Entity types: `SUPPLIER`, `SUPPLIER_CONTACT`, `SUPPLIER_OFFER`, `PURCHASE_ORDER`, `PURCHASE_ORDER_ITEM`, `PURCHASE_ORDER_COST`, `PURCHASE_ORDER_CORRECTION`, `PURCHASE_DISCREPANCY`, `PURCHASE_RETURN`, …

Child audits carry `metadata.purchaseOrderId` where applicable.

---

## Activity vs raw Audit

| Layer | Audience | API | Permission |
|---|---|---|---|
| **Activity timeline** | Purchasing operators | `GET /purchasing/purchase-orders/:id/activity` | `purchasing.read` |
| **Raw Audit** | Admin / debug | `GET /audit-logs` (+ detail) | `audit.read` |

Activity is a **projection** of Audit (PO + related child entities). It does not duplicate storage and omits technical fields (IP / UA).

---

## Security

- Every list/query is `companyId`-scoped.
- Commercially sensitive prices/FX terms require authorized access (`audit.read` for raw payloads).
- Client cannot set actor / company / action / timestamps on Audit records.

---

## Retention

No Purchasing-specific deletion/retention policy in Phase 2.15. Follow Phase 0 defaults.

---

## Indexes

Existing Audit indexes support:

```text
companyId + entityType + entityId + createdAt
companyId + actorUserId + createdAt
```
