# Purchasing Domain Events (Phase 2.15)

Purchasing emits **business facts** on the Phase 0 in-process `DomainEventBus`.  
Events are **not** Audit and must not be polled from AuditLogs by future modules.

---

## Delivery guarantees (current)

| Concern | Behavior |
|---|---|
| Transport | In-process `DomainEventBus` |
| Durable | **NO** |
| Transactional Outbox | **NO** |
| Broker | **NO** |
| Crash after DB commit | Event may be lost |
| Ordering | Within one request / aggregate commit order only |

Events are structured so a future **Transactional Outbox** can adopt the same contracts without redesign.

---

## Envelope

`DOMAIN_EVENT_VERSION = 1`

```text
eventId, type, version, occurredAt,
companyId, actor, correlationId / requestId,
payload
```

- `eventId` is unique per emission (never = purchaseOrderId).
- `companyId`, `actor`, timestamps are **server-derived**.
- Payloads are explicit maps — not Prisma entities.
- No tokens / cookies / Authorization headers.

---

## Event catalog

### Supplier / Offer

| Type | When | Aggregate | Payload (conceptual) |
|---|---|---|---|
| `purchasing.supplier.created` | Supplier created | Supplier | companyId, supplierId |
| `purchasing.supplier.updated` | Meaningful update | Supplier | companyId, supplierId, changedFields |
| `purchasing.supplier.status_changed` | Activate/deactivate | Supplier | companyId, supplierId, status |
| `purchasing.supplier.archived` | Archive | Supplier | companyId, supplierId |
| `purchasing.supplier_contact.*` | Contact lifecycle | Contact | companyId, supplierId, contactId |
| `purchasing.supplier_offer.created` | Offer recorded | Offer | companyId, offerId, supplierId, skuId, currency, quotedAt |
| `purchasing.supplier_offer.updated` / `.archived` | Offer change/archive | Offer | ids + changedFields |

### Purchase Order

| Type | When | Notes |
|---|---|---|
| `purchasing.purchase_order.created` | Draft created | identity + itemCount |
| `purchasing.purchase_order.updated` | Draft header meaningful change | changedFields |
| `purchasing.purchase_order.item_added` / `.item_updated` / `.item_removed` | Draft item mutations | skuId, quantity |
| `purchasing.purchase_order.approved` | DRAFT→APPROVED | previousStatus, purchaseType, approvedAt |
| `purchasing.purchase_order.ordered` | APPROVED→ORDERED | **Phase 3 candidate**; does **not** create stock/receipt |
| `purchasing.purchase_order.cancelled` | →CANCELLED | previousStatus, reason |

Duplicate approve/order after success → invalid transition → **no second success event**.

### Costs

| Type | When |
|---|---|
| `purchasing.purchase_cost.added` / `.updated` / `.voided` / `.removed` | Cost lifecycle |

### Corrections / terms

| Type | When |
|---|---|
| `purchasing.purchase_order.corrected` | Any applied correction |
| `purchasing.purchase_due_date.changed` | Due date actually changed via correction |
| `purchasing.purchase_fx_terms.changed` | Obligation amount and/or reference rate changed |

### Discrepancy / short-close

| Type | When | Does NOT mean |
|---|---|---|
| `purchasing.purchase_discrepancy.recorded` | Discrepancy recorded | Inventory truth |
| `purchasing.purchase_order.short_closed` | Short-close recorded | Stock movement |

### Purchase Return

| Type | When | Does NOT mean |
|---|---|---|
| `purchasing.purchase_return.created` | Intent created | Goods left warehouse |
| `purchasing.purchase_return.approved` | Intent approved | Physical return / refund / payable change |
| `purchasing.purchase_return.cancelled` | Intent cancelled | |

---

## Future consumers (not implemented)

### Phase 3 Warehouse (candidates)

```text
PurchaseOrderOrdered
PurchaseOrderCorrected
PurchaseOrderCancelled
PurchaseReturnApproved
```

### Phase 4 Finance (candidates)

```text
PurchaseOrderApproved / Ordered
PurchaseDueDateChanged
PurchaseFxTermsChanged
PurchaseOrderCancelled
```

Purchasing **must not** import Warehouse/Finance services. Consumers subscribe to events/contracts.

---

## Side-effect boundary

Emitting `purchasing.purchase_order.ordered` does **not**:

- create Goods Receipt / stock / movement / batch / bin

Emitting `purchasing.purchase_return.approved` does **not**:

- decrement stock, create refund, change payable

---

## Observability

Dev/test: subscribe via `DomainEventBus` in e2e.  
Avoid logging full commercial payloads in production unless policy allows.
