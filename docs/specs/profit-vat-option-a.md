# Profit VAT — Option A

Approved 2026-09-29. Correct the existing revenue VAT basis without replacing the P&L engine.

## Revenue and rounding

- P&L uses posted `Sale.subtotalAmount` and `CreditNote.subtotalAmount` for revenue and sales returns.
- Operational sales summaries, receipt totals and AR/AP continue to use tax-inclusive document amounts.
- SALE FactProfit allocates posted header subtotal and VAT to products and shipping. The sum of each basis must match the posted header to the cent. VAT never increases gross or net profit.
- Apply the existing discount policy: products first, then shipping. Cumulative cent allocation assigns each rounding residual once, without a negative final line or revenue on a zero-weight line.
- Allocate VAT separately from the base, so every line's inclusive amount equals its base plus allocated tax. Including-VAT and excluding-VAT input modes both reconcile to the same posted totals.
- `calcItemSubtotal()` correctly extracts the base from an inclusive price. Historical line subtotals are not used to construct SALE revenue facts.
- Preserve sale cost snapshots, DN capitalization/period variance, inventory, document numbers, cash, payments and distribution snapshots.
- Expense VAT/recoverability policy is unchanged. This round fixes revenue VAT; it does not infer input-tax eligibility from a VAT mode or retroactively alter stock valuation.

The revenue basis follows [IFRS 15 paragraph 47](https://www.ifrs.org/content/dam/ifrs/meetings/2024/march/iasb/ap6a-ifrs15-pir-transaction-price.pdf), which excludes amounts collected on behalf of third parties, and [Dynamics 365 profitability](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/analytics/sales-profitability-performance-content-pack), which subtracts sales tax included in invoice amounts.

## Existing data

Run the strictly read-only audit:

```powershell
npx tsx --env-file=.env.local scripts/audit-sale-profit-vat.ts
```

The audit scans active sales in batches of 100, compares existing SALE facts to posted header totals and expected line/shipping allocations, and reports missing facts, invalid allocation bases, stale source subtotals and affected distributed periods. It performs no writes, including audit-log writes.

The 2026-09-29 audit found 206 active sales, zero SALE document-total revenue mismatches, zero missing facts and zero invalid headers. All active sales are NO_VAT. Two documents have different cent residual placement under the new cumulative allocator; the old allocations are valid, sum exactly to the posted totals and do not alter document/company profit. They are retained. No revenue VAT rebuild is required. Two active distribution documents have no affected periods. No database repair was run.

One active purchase item has a stale including-VAT subtotal. This is a source-document anomaly, not a SALE profit-fact mismatch. Its correction requires separate review; the audit does not amend source documents or MAVG. No active purchase-return header anomalies were found.

If a future audit finds mismatches, preview the document and period impact before applying a targeted repair. Lock each Sale using the edit/cancel row-lock protocol, re-read its status and totals, rebuild only that document's derived SALE facts within a transaction, retain old versions, and append an audit record. A repeat repair should be a no-op when totals already match. Do not use the broad backfill script as a VAT-only repair.

Distribution snapshots and prior payments remain immutable. Nevertheless, `lib/profit-distribution.ts` compares current recalculated profit to the historical snapshot; a historical rebuild can change future carry-forward. Review that impact before applying a repair.

Marketplace other income, fee allocation dates and filter scope can still differ between legacy P&L and dashboard. Option A resolves VAT differences; it does not replace their underlying scopes with a shared FactProfit query.

## Verification

Golden cases cover all VAT modes, fractional quantities, header discounts, shipping spillover, zero-price lines, tiny totals across many lines, exact document cents, returns, DN variance, unchanged cash summaries and historic costs, repeat fact generation and canceled sales. Run `npm run verify`, `npm run check:mojibake` and `npm run build` before completion.

2026-09-29: all 16 new golden cases passed; isolated-patch verify passed 1,792/1,792 with zero failures/skips, production build passed, and tracked UTF-8/mojibake checks passed. No source documents, fact rows or distribution records were repaired.
