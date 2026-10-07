# Settlement / Reconciliation UI (Phase 6.5)

Operator-facing Settlement Center. Backend remains authoritative for all money and allocation truth.

## Navigation

```text
تسویه
├── نمای کلی تسویه        /app/settlements
├── بدهی تأمین‌کننده      /app/settlements/payables
├── وام‌ها                /app/settlements/loans
├── تسویه کانال           /app/settlements/channels
├── مغایرت‌گیری           /app/settlements/reconciliation
└── تاریخچه تسویه         /app/settlements/audit
```

## Source of truth

| Display | Source |
| --- | --- |
| Outstanding payable / loan | Settlement / Finance domain derivation |
| Channel Expected Net | ChannelSettlement components (server) |
| Actual received | Active SettlementAllocation (Receipt) |
| Matched / difference | Reconciliation view over allocations |
| Dashboard KPIs | `GET /api/v1/settlements/dashboard` |

Never edit `outstanding`, `matchedAmount`, or `difference` in the UI.

## Currency

Dashboard and lists **never** sum IRR + USD. Amounts are always grouped by currency.

## Key flows

1. **Channel:** create draft → components → finalize → allocate receipt → open reconciliation
2. **Payable / Loan:** open detail → allocate existing Finance Payment (FX fields when needed)
3. **Reconciliation:** candidates (read-only) → match → close matching → discrepancy reasons → resolve

Resolved variance keeps the historical difference visible.
