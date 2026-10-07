# Sales Invariants (Phase 5.1+)

Stable machine identifiers for Sales domain rules.

## SALE-001

Every Sales entity is company-scoped.

## SALE-002

Client-supplied companyId never determines ownership.

## SALE-003

Catalog owns Product/SKU truth.

## SALE-004

Warehouse owns physical inventory truth.

## SALE-005

Finance owns financial/accounting truth.

## SALE-006

Sales Channel identifies source of sale; it does not own marketplace integration credentials.

## SALE-007

Channel code is unique within Company.

## SALE-008

Inactive Channel remains valid for historical references.

## SALE-009

Customer internal ID is canonical customer identity.

## SALE-010

Customer contact fields are not assumed globally unique unless explicitly constrained.

## SALE-011

Customer Master does not own financial balance/receivable truth.

## SALE-012

Customer history must survive customer inactivation.

## SALE-013

Marketplace Sale is not Marketplace Settlement.

## SALE-014

Sale is not Payment.

## SALE-015

Sales does not directly mutate Warehouse stock.

## SALE-016

Sales does not calculate authoritative Profit.

## SALE-017

Sales does not implement Buy Box/Pricing strategy.

## SALE-018

Future external order identity must be scoped by Company + Channel.

## SALE-019

Customer/Channel mutations are auditable.

## SALE-020

Domain Events represent committed Sales facts.

## SALE-021

Every Sales Order belongs to exactly one Company.

## SALE-022

Every Sales Order references exactly one Sales Channel.

## SALE-023

Every Sales Order Item references canonical Catalog SKU.

## SALE-024

Original ordered quantity is never rewritten to represent cancellation.

## SALE-025

Authoritative commercial totals are calculated server-side.

## SALE-026

Every monetary Sales Order has explicit currency.

## SALE-027

Wholesale uses canonical SalesOrder, not a parallel sales engine.

## SALE-028

CASH/CREDIT/PARTIAL describe commercial terms, not actual money movement.

## SALE-029

Sales does not own actual paid/outstanding financial truth.

## SALE-030

Confirmed commercial facts cannot be arbitrarily mutated.

## SALE-031

Lifecycle transitions are explicit and validated.

## SALE-032

Cancellation preserves original order history.

## SALE-033

Cancelled quantity cannot exceed eligible quantity.

## SALE-034

Returns reference original Sales Order Items.

## SALE-035

Return does not itself mean Warehouse stock was received.

## SALE-036

Return does not itself mean money was refunded.

## SALE-037

Sales does not directly mutate Warehouse inventory.

## SALE-038

Sales does not directly mutate Finance account balances.

## SALE-039

Historical orders survive Customer/Channel/SKU inactivation.

## SALE-040

External order identity is scoped by Company + Channel.

## SALE-041

Critical lifecycle operations are concurrency-safe.

## SALE-042

Material Sales mutations are auditable.

## SALE-043

Sales events represent committed business facts.

## SALE-044

Client input cannot control authoritative totals or lifecycle metadata.

## SALE-045

Reservations reduce Available but never On Hand.

## SALE-046

Sales reservations can consume only eligible SELLABLE stock.

## SALE-047

Normal Sales never consumes TESTER, DAMAGED, or QUARANTINE stock.

## SALE-048

Sales never directly mutates Stock Balance.

## SALE-049

Every physical Sales outbound is represented by Warehouse Movement.

## SALE-050

Fulfilled quantity can never exceed ordered quantity minus cancelled quantity.

## SALE-051

One order/item may have multiple partial fulfillments.

## SALE-052

Fulfillment is idempotent.

## SALE-053

Concurrent reservations cannot oversubscribe stock.

## SALE-054

Concurrent fulfillments cannot over-fulfill an order.

## SALE-055

Sales outbound consumes FIFO through Warehouse's canonical FIFO engine.

## SALE-056

FIFO consumption remains traceable to Sales fulfillment (via InventoryMovement + InventoryLayerConsumption).

## SALE-057

Sales does not calculate authoritative Profit.

## SALE-058

Approved Return does not affect stock until physical receipt.

## SALE-059

Every physical customer return into stock is represented by RETURN_IN.

## SALE-060

Returned quantity cannot exceed eligible fulfilled quantity.

## SALE-061

Returned stock classification is explicit.

## SALE-062

Sales does not directly mutate financial account balances.

## SALE-063

Actual payment truth belongs to Finance.

## SALE-064

Customer receivable truth belongs to Finance (`CustomerReceivable`).

## SALE-065

Marketplace sale does not imply marketplace settlement.

## SALE-066

Marketplace sale does not automatically increase Bank.

## SALE-067

Financial recognition from Sales is idempotent.

## SALE-068

Partial fulfillment cannot duplicate financial recognition.

## SALE-069

Financial entries remain traceable to Sales source (fulfillment / return).

## SALE-070

Order-level discounts are allocated deterministically for partial recognition.

## SALE-071

Return does not imply actual cash refund.

## SALE-072

Cross-domain Sales execution must not leave contradictory committed state.

## SALE-073

Every Sales/Warehouse/Finance cross-reference is company-safe.

## SALE-074

Historical fulfilled commercial facts cannot be rewritten to correct operational mistakes.

## SALE-075

`fulfilledQuantity` is the only physical fulfillment truth on order items; ordered `quantity` is never rewritten for fulfillment.

## SALE-076

Returnable quantity is `fulfilledQuantity − returnedQuantity`.

## SALE-077

Revenue recognition is fulfillment-scoped (not confirm-scoped) and posts DR AR · CR REVENUE without inventing bank cash.

## SALE-078

Sales integrity checks are read-only: they detect quantity, money, tenant, movement, reservation, and recognition violations without mutating data (`pnpm db:check:sales` / `sales:integrity`).

## SALE-079

Sales UI and dashboard queries are always company-scoped via active company context; query keys include `companyId` so cache never crosses tenants.

## SALE-080

Dashboard outstanding receivables are Finance `CustomerReceivable` truth (labeled); Sales does not maintain a parallel debt balance. Cash settlement remains Phase 6.
