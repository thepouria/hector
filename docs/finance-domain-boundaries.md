# Finance Domain Boundaries (Phase 4.1)

## Source-of-truth map

| Fact | Owner |
|---|---|
| Product / SKU / Barcode | Catalog |
| Supplier master | Purchasing |
| PO commercial truth (qty, price, type, currency, terms, costs) | Purchasing |
| Purchase FX obligation + reference rate | Purchasing |
| Purchase Return authorization | Purchasing |
| Physical Goods Receipt | Warehouse |
| InventoryMovement / StockBalance | Warehouse |
| Physical supplier return dispatch | Warehouse |
| FIFO layers / consumptions / known inventory valuation | Warehouse |
| Financial Account / cash-bank-wallet balances | **Finance** |
| Capital / Equity funding | **Finance** |
| Loan liability / repayments | **Finance** |
| Supplier Payable / settlements | **Finance** |
| Payments / receipts / account transfers | **Finance** |
| Expenses (period) | **Finance** |
| FX settlement monetary effects | **Finance** |
| Journal / Financial Ledger | **Finance** |
| Sales Order / channel order | Future Sales |
| Marketplace settlement | Future Settlement |
| Profit / COGS / margins | Future Profit Engine |

---

## Recognition matrix

| Business Event | Physical Stock | Cash | Liability | Equity | Revenue |
|---|---:|---:|---:|---:|---:|
| Owner/partner capital injection | 0 | + | 0 | + | 0 |
| IRR loan received | 0 | + | + | 0 | 0 |
| USD loan received | 0 | + USD | + USD | 0 | 0 |
| Credit PO ordered (no receipt) | 0 | 0 | 0 | 0 | 0 |
| Goods received on credit (POSTED GRN) | + | 0 | + | 0 | 0 |
| Supplier payment | 0 | − | − | 0 | 0 |
| Internal same-currency transfer | 0 | src− / dest+ | 0 | 0 | 0 |
| Period expense paid | 0 | − | 0 | 0 | 0 |
| Inventory reservation | 0 | 0 | 0 | 0 | 0 |
| Stock issue (sample/tester/…) | − | 0 | 0 | 0 | 0 |

Payable quantity basis: **accepted received** on POSTED Goods Receipt (incremental). Not ordered qty alone.

---

## Same person, different economics

Ahmad pays Company `500M IRR`:

| FundingType | Cash | Equity | Debt | Revenue |
|---|---:|---:|---:|---:|
| `PARTNER_EQUITY` | +500M | +500M | 0 | 0 |
| `LOAN_RECEIVED` | +500M | 0 | +500M | 0 |

---

## Forbidden ownership crossings

- Finance must not mutate Purchasing PO/item commercial fields  
- Finance must not mutate Warehouse Movement / Balance / FIFO  
- Warehouse must not create supplier financial settlement  
- Catalog barcodes remain Catalog identity  

---

## Integration ports (code)

```text
apps/api/src/modules/finance/contracts/
  purchasing-finance.contract.ts
  warehouse-finance.contract.ts
```
