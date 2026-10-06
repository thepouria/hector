# Scanner UX (Phase 3.16)

Keyboard-wedge barcode scanner support for Warehouse operations.

---

## Principles

```text
Scanner UI  →  bounded resolvers + canonical command endpoints
```

- No proprietary scanner SDK.
- Barcodes are **strings** (leading zeros preserved).
- Scanner never auto-creates Product/SKU.
- Scanner never bypasses RBAC, tenant isolation, or Inventory Ledger.
- Scanner and normal UI call the **same** domain commands.

---

## Scanner Center

Route: `/app/warehouse/scanner`

Permission: `warehouse.scanner.use`

Primary modes:

| Action | Behavior |
|---|---|
| LOOKUP محصول | Resolve product barcode → SKU stock summary (On Hand / Sellable / Reserved / Available / classes) |
| LOOKUP مکان | Resolve location barcode → balances at location |
| RECEIVE / PUTAWAY / MOVE / ISSUE / COUNT / SUPPLIER RETURN | Navigate to operational document pages that own mutations |

Context (company, mode, document) is always visible. Company switch resets scanner state.

---

## Resolvers

```text
GET /api/v1/warehouse/scanner/products/resolve?barcode=
GET /api/v1/warehouse/scanner/locations/resolve?barcode=
```

Exact match only. Pathological payload sizes rejected by DTO (`MaxLength`).

---

## Input component

`BarcodeScanInput` (`apps/web/src/components/catalog/barcode-scan-input.tsx`):

- text input (`dir="ltr"`, mono)
- auto-focus
- Enter submits
- trim + control-strip via `normalizeScannerInput` (preserves leading zeros)
- clear + refocus after successful scan
- busy guard against double-submit while resolving

Do **not** add aggressive debounce that drops fast wedge input.

---

## Workflow state machines (examples)

**Receive** (goods receipt panel): select document → scan product → batch if needed → quantity → confirm line → scan again.

**Transfer**: scan source location → product → destination → confirm line.

**Issue**: scan location → product → classification/qty → confirm line.

**Putaway / Count / Supplier return**: existing document panels with scan-apply.

Physical mutation confirmation is required for post/complete/approve/dispatch — not for every harmless scan.

---

## Feedback

- Success / error text + icon (not color-only).
- Optional non-blocking audio beep helpers where present (`playScannerTone`).
- Recoverable errors return focus to scan input without page reload.
- Network failure must never present as successful inventory mutation.
- Offline queueing is **out of scope**.

---

## Error messages (operator-facing)

| Situation | Message intent |
|---|---|
| Unknown product barcode | Barcode not recognized |
| SKU not on PO | This SKU is not part of this Purchase Order |
| Insufficient available | Reserved stock protected / insufficient available |
| Unknown location | Location barcode not found |

UI maps structured API codes via `mapBusinessError`.

---

## Scanner UX invariants (Phase 3.16)

> Note: Phase 3.6 receiving already defines `WH-SCAN-001…` in `docs/warehouse-invariants.md`. Phase 3.16 operational scanner UX uses `WH-SCANUX-*` to avoid ID collisions.

| ID | Rule |
|---|---|
| WH-SCANUX-001 | Barcode values are treated as strings |
| WH-SCANUX-002 | Leading zeros are preserved |
| WH-SCANUX-003 | Scanner uses canonical barcode resolver |
| WH-SCANUX-004 | Scanner actions use canonical Warehouse commands |
| WH-SCANUX-005 | Scanner cannot bypass RBAC |
| WH-SCANUX-006 | Scanner cannot bypass tenant isolation |
| WH-SCANUX-007 | Repeated submit cannot duplicate inventory mutation |
| WH-SCANUX-008 | Successful scan returns focus to scan input |
| WH-SCANUX-009 | Recoverable scan error does not require page reload |
| WH-SCANUX-010 | Scanner context is always visible |
| WH-SCANUX-011 | Company/Warehouse/document context changes clear unsafe stale state |
| WH-SCANUX-012 | Network failure is never presented as successful inventory mutation |
| WH-SCANUX-013 | Keyboard-wedge scanners work without proprietary integration |
| WH-SCANUX-014 | Unknown barcode never creates Product/SKU automatically |
| WH-SCANUX-015 | Scanner and normal UI produce identical domain truth |

---

## Related

- `docs/barcode-scanner-receiving.md` (Phase 3.6 receiving specifics)
- `docs/warehouse-api.md`
- `docs/warehouse-ui.md`
