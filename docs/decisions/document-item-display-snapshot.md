# Document Item Display Snapshot

## Status
Implemented on 2026-05-31.

## Context
Transaction item tables store stock quantities and costs in base unit so StockCard, MAVG, lot balance, and reference-cost flows can remain consistent. That is correct for inventory accounting, but it made reopened documents display normalized base-unit values instead of the quantity, unit, and unit price originally entered by the user.

## Decision
Purchase, purchase return, sale, and sale return item rows now store a display snapshot alongside the existing base-unit fields:
- `showQty`
- `showUnitName`
- `showPricePerUnit`
- `unitScale`

The base-unit fields remain the source of truth for inventory and cost calculations. The display snapshot is the source of truth for document presentation and edit-form rehydration. `unitScale` is stored silently for reconstruction and is not shown as user-facing document text.

Historical documents are not backfilled. Old rows can continue to fall back to existing base-unit fields.

## Impact
- StockCard, MAVG, lot movement, lot balance, and reference-cost logic must continue to use base-unit quantities and costs.
- Document detail/edit pages should prefer the display snapshot when present.
- Purchase report should show purchase item display snapshots because it is a line-level purchase document report.
- Other reports should continue to use their existing report/master-unit semantics unless a separate report-specific change is approved.
