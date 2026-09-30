# Supplier DN — Option B

Status: implementation and verification complete; approved additive database rollout applied. Application deployment was not requested and has not been performed. Scope and complete schema inventory explicitly approved on 2026-09-29.

## Confirmed behavior

- One supplier-issued debit note references exactly one ACTIVE Purchase. Fully paid and cash purchases remain eligible. The original purchase amount and paid status are preserved.
- DN increases AP as a separate document; posting a DN never moves cash. SupplierPayment may settle a DN alone or alongside purchases, credits and advances.
- Each line selects a PurchaseItem and uses its original display-unit snapshot. Support PER_UNIT and TOTAL increases, NO_VAT / EXCLUDING_VAT / INCLUDING_VAT. Input VAT recoverability is decided on the server by `lib/input-vat.ts` (owner decision 2026-09-30, V1 = option ข): recoverable only when the DN's VAT type is not NO_VAT and the shop's `vat_registered_from` setting is on or before the DN's `debitDate`; otherwise DN VAT is part of cost. DN adjustments inherit the parent DN's VAT type, rate and recoverability.
- DN VAT is computed once on the document subtotal (exact half-up) and allocated to lines by largest remainder, so it matches the supplier's tax document and line sums always equal the header (2026-09-30).
- Use current aggregate SKU stock coverage, including stock from subsequent receipts. This is NOT receipt-specific physical tracing; the user explicitly selected this policy.
- Group affected lines by product before allocating stock coverage. Allocate available positive stock once across affected quantities so duplicate lines cannot reuse coverage. Sum eligible quantities cannot exceed positive current SKU stock or affected quantity. Preserve cent residuals deterministically.
- Capitalize the covered portion; recognize the remainder as current-period purchase cost variance. Quantity and lots do not change. Posting never rewrites earlier sales; cancelling or editing a DN restates the cost snapshots of later sales and their RETURN credit notes (2026-09-30, T1 option A), subject to the profit-distribution month lock.
- DN cost posting uses today's Thailand business date and a durable same-day ordering boundary. The document date and received date are separate. Earlier same-day issues stay before DN; subsequent issues use the new MAVG. Never infer this order from document date alone.
- A zero-stock DN is visible in StockCard, capitalizes zero and recognizes the complete cost adjustment as variance. It cannot carry cost into a later receipt.
- Reports must reconcile sales minus sales cost minus DN variance to adjusted gross profit. Net profit and profit distribution consume the same facts without double-counting capitalized cost.

## Proposed additive schema: approval inventory

No existing field is removed. No existing financial values are overwritten or backfilled by this feature.

| Model | Fields added |
| --- | --- |
| SupplierDebitNote (new) | id, debitNo, supplierReferenceNo, purchaseId, supplierId, userId, debitDate, receivedDate, postingDate, dueDate, reason, note, vatType, vatRate, vatRecoverable, subtotalAmount, vatAmount, netAmount, inventoryAmount, varianceAmount, amountRemain, status, cancelledAt, cancelNote, createdAt, updatedAt |
| SupplierDebitNoteItem (new) | id, debitNoteId, purchaseItemId, productId, lineNo, amountMode, increaseAmount, affectedQuantity, affectedBaseQuantity, showUnitName, unitScale, originalUnitPrice, subtotalAmount, vatAmount, netAmount, costAdjustmentAmount, eligibleBaseQuantity, inventoryAmount, varianceAmount, stockBefore, avgCostBefore, avgCostAfter, stockCardId |
| StockCard | valueAdjustment (money added to inventory without quantity), costVariance (current-period cost difference for display), valuationEpoch (same-day DN boundary; default 0 for legacy rows) |
| SupplierPaymentItem | debitNoteId and relation to SupplierDebitNote; nullable for existing payments |
| User, Supplier, Purchase | supplierDebitNotes relation arrays only |
| Product, PurchaseItem | supplierDebitNoteItems relation arrays only |

Enums added/extended: SupplierDebitAmountMode = PER_UNIT / TOTAL; StockCardSource += SUPPLIER_DEBIT; ProfitSourceType += PURCHASE_COST_VARIANCE; NotificationType += SUPPLIER_DEBIT_NOTE.

Money uses Decimal(10,2); MAVG before/after snapshots retain Decimal(10,4) to match StockCard; quantities and unit scale use Decimal(12,4). New dates use Timestamptz(3). Foreign keys, document dates and frequently filtered status/supplier fields have indexes. Internal debitNo is unique; A supplier's DN number cannot appear twice among ACTIVE DNs of that supplier, compared on a normalized key (upper-case; spaces, '.', '/' and '-' removed) by the partial unique index `SupplierDebitNote_active_supplier_reference_key` (2026-09-30, T4). Numbering uses the existing transaction-aware numbering helper, not a parallel generator.

## Integration checklist

- [x] Pure decimal calculation helper and hand-calculated golden fixtures prepared.
- [x] Schema approved; additive migration and all 14 concurrent indexes applied; Prisma generated/validated; schema drift check passes (known search objects preserved).
- [x] Stock coverage grouped by SKU, value-only replay and append parity, durable same-day epochs.
- [x] Transactional create/cancel service, server validation, deterministic stock locks and idempotency.
- [x] DN payment reference, outstanding-balance recalculation, DN-only settlement and cash amount sign.
- [x] AP balance/register, supplier payment list/detail/edit and document relations.
- [x] Mutation guards: purchase and PurchaseItem referenced by active DN cannot be changed/cancelled; paid DN cannot be cancelled; downstream stock dependencies must be checked before any reversal.
- [x] DN edit: header-only update while ACTIVE; line/VAT repost only when the cancellation guard allows it; UPDATE audit and bell + Telegram notification; 5 golden cases.
- [x] Document activity for Purchase -> DN -> SupplierPayment; shared links/reasons.
- [x] Profit facts, dashboard/detail labels, summaries, distribution, reconciliation and explanation consumers.
- [x] New admin menu permission catalog/staff sets/route/page/action/navigation; light/dark; loading segments.
- [x] In-transaction AuditLog and post-commit notification through createNotification (bell + Telegram).
- [x] StockCard DN link and inventory/variance amounts, including zero-stock rows.
- [x] 58 isolated DN golden/SSR cases; npm run verify passed all 1,776 tests; npm run check:mojibake plus separate new-file scan passed; npm run build passed.

## Golden acceptance cases

Cases 4–5 describe the recoverable-VAT profile. With the current non-recoverable policy (2026-09-30) case 4 capitalizes 200 / variance 300 and case 5 capitalizes 214 / variance 321 (cost 535).

1. Receive 10 at 100, sell 6, DN +50/unit no VAT: AP +500; inventory +200; variance +300; stock 4; MAVG 150; old sale cost 100; subsequent sale cost 150.
2. Receive/sell all 10, DN +50: stock/value remain zero, variance 500, next receipt has only its own cost.
3. Sell all old receipt, receive another 10 of the same SKU, DN on old receipt: aggregate coverage capitalizes the DN against current stock (explicitly approved).
4. Fifty/unit including 7% recoverable VAT, 10 units: subtotal 467.29, VAT 32.71, AP 500; with 4 eligible units inventory 186.92, variance 280.37.
5. Fifty/unit excluding 7% recoverable VAT, 10 units: subtotal/cost 500, VAT 35, AP 535.
6. Nonrecoverable VAT: cost includes tax; it is never also deducted as recoverable input VAT.
7. TOTAL 500 and PER_UNIT 50 x 10 produce the same money, without multiplying TOTAL again.
8. Two selected packs of five, increase 250/pack: affected base quantity 10 and total increase 500.
9. Duplicate SKU purchase lines share stock coverage once; repeated DNs represent independent authorized surcharges; duplicate supplier reference/request cannot post twice.
10. Same-day sale before DN remains before it after replay; sale after DN uses adjusted cost. Recalculate repeatedly produces identical balances.
11. Concurrent sale/receipt/DN, partial/full DN payment, cancellation and return guards; no side effects after a rejected mutation.
12. Summary net/gross profit, report/export, AP and posted DN reconcile; cancelled DN facts do not remain active.

## Rollout and rollback

Use narrow additive SQL only; never db push or migrate dev. Verify test fixtures before applying to the configured database. No production data repair is included. Disable new DN posting if rollout fails, preserve posted rows/audit, and reverse financial documents through guarded application actions rather than dropping tables.

## Sources

- https://learn.microsoft.com/en-us/dynamics365/supply-chain/cost-management/moving-average
- https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-cost-adjustment
- https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana/entering-subsequent-debits-credits
- https://www.rd.go.th/5206.html
- https://www.rd.go.th/5208.html

## Operational details and validation

- DN posting allocates positive current stock by the sum of affected base quantities per SKU, including replenished receipts as approved. Cumulative rounding preserves each SKU's money and quantity residual once in source-line order.
- New DN uses postingDate = today's Thailand business date; source/debit/received/due dates remain independently visible. An overdue DN may retain an earlier due date.
- No DN cost is attached to a specific historic sale/customer/channel. Sale-line profit retains the original invoice cost; company/product/document period profit includes the separate variance fact. Profit-distribution snapshots already issued remain historical snapshots.
- Supplier payments lock the DN before settling/recalculating it. DN-only suppliers appear in outstanding supplier selection; partial/full payment and reversal maintain the separate DN balance.
- Every source stock mutation before an active DN is rejected under sorted SKU locks. DN cancellation requires reversing active payments and later stock movements first. Claim/stock-list UI uses the same guard reason and document links.
- Purchase returns retain their existing original purchase reference cost. The DN surcharge remains in pooled valuation and period variance; this module does not calculate a supplier credit automatically. From 2026-09-30 (T3), when a return or any outgoing row empties stock with value left, that residual is written off as a STOCK_VALUE_RESIDUAL cost variance instead of disappearing.
- Review 2026-09-30 changes: DN AP age uses receivedDate; open DN balances count in dashboard/LINE summary/workboard AP; coverage uses the latest StockCard qtyBalance instead of the rounded Product.stock; DN edits reject a stale form by `updatedAt`, validate before reversing rows, and recalculate only SKUs removed by the edit.
- An entire-document total is entered through TOTAL lines allocated by the operator. Each selected line still requires its affected quantity. DN has no reopen flow; cancellation is available only while unreferenced. Edit (2026-09-29, permission `supplier_debit_notes.update`): header fields may change while ACTIVE with no stock/AP/cost effect, per the owner-approved field policy of 2026-09-30 (R4): note, reason and supplier reference any time; due date only while an outstanding balance remains; debit date and received date only while an outstanding balance remains and the posting month has no ACTIVE profit distribution. VAT or line changes are allowed while no active payment blocks them (an edit may not bring the net below the amount already paid) and the affected months are not locked by a profit distribution (admin override with reason); later stock movements no longer block. The edit reverses the value-only StockCard rows and reposts under the same DN number at the ORIGINAL posting date and position, with coverage taken at that position, then restates later sales' cost snapshots (2026-09-30, R5/T1). A DN whose month is locked is corrected with an adjustment DN dated today (R5-D). The source purchase cannot change. A cancelled DN's supplier number may be reused by a new DN (owner decision 2026-09-30, T4); uniqueness applies to ACTIVE DNs only.
- Golden tests are isolated from the live database: fixed expected values cover calculation, real replay/ordering, service orchestration/rollback, AP/report/fact rebuild, guard/UI and a controlled sale/DN lock interleave. They are not a live database end-to-end write test.
- Database rollout is additive only. No old document amounts, SaleItem snapshots, StockCard values or stock lots were backfilled. All legacy valuationEpoch/valueAdjustment/costVariance defaults are zero.
- 2026-09-29: 58 DN golden/SSR cases passed; the combined DN plus claim-cancel suite passed 68/68. Configured database migration/indexes applied, both new financial tables have RLS enabled, and schema drift/Prisma validation passed. Full repository verify passed 1,776/1,776 (zero skipped); lint returned zero errors with 261 pre-existing warnings. Production build passed against final application code. UTF-8/mojibake scan passed for tracked files and all 34 new files. No application deployment performed.
- Follow-up approved and implemented: [VAT Option A](profit-vat-option-a.md) aligns legacy P&L revenue with FactProfit and corrects sale VAT allocation/header rounding. Expense VAT policy remains unchanged. DN variance is deducted once in both. The read-only audit found no existing SALE facts requiring a VAT rebuild.
- ปรับยอด DN (2026-09-30, owner approved R5-D, T1, ก3): an ACTIVE DN that cannot be edited in place is corrected by an adjustment DN dated today (`adjustsDebitNoteId`), created from the parent's detail page (`/admin/supplier-debit-notes/[id]/adjust`, permission `supplier_debit_notes.create`). Lines reference the parent DN's purchase lines with signed deltas, one sign per document; same numbering, VAT policy and document-level VAT rounding; month lock on today's posting date only. A positive delta posts like a DN (coverage = current on-hand) and is its own payable. A negative delta posts a negative value-only row: the covered part lowers inventory value (never below zero: the replay writes the unabsorbed part off as a STOCK_VALUE_RESIDUAL, `computeDebitValueResidual`), the rest is negative PURCHASE_COST_VARIANCE (fact subtype `SUPPLIER_DN_ADJUSTMENT`, label "ปรับยอด DN"). It first reduces the parent's amountRemain; any excess is kept as supplier credit (amountRemain stored negative, consumed by SupplierPayment via `debitCreditId`, which reduces cash paid) or refunded (DocumentPayment + CashBankMovement IN, source `SUPPLIER_DEBIT_REFUND`). The family balance is recomputed from stored facts in `lib/supplier-debit-balance.ts`. The parent cannot be cancelled or reposted while an ACTIVE adjustment exists; an adjustment is cancel-only (blocked by an ACTIVE payment that used its credit) and its cancel restates later sales like any DN cancel, restores the parent's balance and reverses the refund. AP totals net the credit; the per-supplier DN column and P&L variance net the signed amounts.
