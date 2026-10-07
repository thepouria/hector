# Sales API endpoint matrix (Phase 5.1–5.4)

Base: `/api/v1` · Auth: Bearer · Tenant: `X-Company-Id`

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/sales/dashboard` | `sales.dashboard.read` | Range `today\|7d\|30d\|custom` + optional `channelId`, `from`/`to`. Finance OPEN receivables labeled. |
| GET | `/sales/channels` | `sales.channels.read` | List |
| GET | `/sales/channels/:id` | `sales.channels.read` | Detail |
| POST | `/sales/channels` | `sales.channels.manage` | Create |
| PATCH | `/sales/channels/:id` | `sales.channels.manage` | Update metadata |
| POST | `/sales/channels/:id/activate` | `sales.channels.manage` | |
| POST | `/sales/channels/:id/deactivate` | `sales.channels.manage` | |
| GET | `/sales/customers` | `sales.customers.read` | List |
| GET | `/sales/customers/:id` | `sales.customers.read` | Detail + addresses |
| POST | `/sales/customers` | `sales.customers.manage` | Create |
| PATCH | `/sales/customers/:id` | `sales.customers.manage` | Update |
| POST | `/sales/customers/:id/activate` | `sales.customers.manage` | |
| POST | `/sales/customers/:id/deactivate` | `sales.customers.manage` | |
| POST | `/sales/customers/:id/addresses` | `sales.customers.manage` | Add address |
| PATCH | `/sales/customers/:id/addresses/:addressId` | `sales.customers.manage` | |
| POST | `/sales/customers/:id/addresses/:addressId/set-default` | `sales.customers.manage` | |
| POST | `/sales/customers/:id/addresses/:addressId/deactivate` | `sales.customers.manage` | |
| GET | `/sales/orders` | `sales.orders.read` | Filters: status, channel, customer, paymentTerm, from/to, search |
| POST | `/sales/orders` | `sales.orders.create` | DRAFT only |
| GET | `/sales/orders/:id` | `sales.orders.read` | Enriched qty + reservation/fulfillment/finance summaries |
| GET | `/sales/orders/:id/finance` | `sales.orders.read` | Receivables by `salesOrderId` (read-only) |
| PATCH | `/sales/orders/:id` | `sales.orders.manage` | DRAFT only |
| POST | `/sales/orders/:id/confirm` | `sales.orders.confirm` | + best-effort reserve |
| POST | `/sales/orders/:id/reserve` | `sales.orders.reserve` | |
| GET | `/sales/orders/:id/reservations` | `sales.orders.read` | |
| POST | `/sales/orders/:id/reservations/release` | `sales.orders.reserve` | |
| POST | `/sales/orders/:id/cancel` | `sales.orders.cancel` | |
| POST | `/sales/orders/:id/items/:itemId/cancel` | `sales.orders.cancel` | Partial |
| GET | `/sales/fulfillments` | `sales.fulfillments.read` | |
| POST | `/sales/fulfillments` | `sales.fulfillments.create` | DRAFT |
| GET | `/sales/fulfillments/:id` | `sales.fulfillments.read` | |
| POST | `/sales/fulfillments/:id/complete` | `sales.fulfillments.complete` | ISSUE + AR |
| POST | `/sales/fulfillments/:id/cancel` | `sales.fulfillments.manage` | DRAFT only |
| GET | `/sales/returns` | `sales.returns.read` | |
| POST | `/sales/returns` | `sales.returns.create` | DRAFT |
| GET | `/sales/returns/:id` | `sales.returns.read` | |
| POST | `/sales/returns/:id/approve` | `sales.returns.approve` | Commercial |
| POST | `/sales/returns/:id/receive` | `sales.returns.receive` | RETURN_IN + AR credit |
| POST | `/sales/returns/:id/cancel` | `sales.returns.manage` | |
| GET | `/finance/customer-receivables` | `finance.receivables.read` | Finance list (optional `salesOrderId`) |

## Integrity CLI

```bash
pnpm db:check:sales
pnpm sales:integrity
```

Exit `1` if any violation. Never mutates.

## Out of scope (Phase 6+)

Marketplace APIs, settlement engine, AR cash allocation, profit/COGS.
