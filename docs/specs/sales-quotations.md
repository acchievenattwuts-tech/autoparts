# Sales quotations (SQ)

Confirmed scope: 2026-09-07. Implemented in the local workspace; application deployment is separate.

- SQ is third under Sales & Receivables. Navigation and Quick Search use the shared navigation configuration, with a create shortcut. Separate view/create/update/cancel permissions initially granted to ADMIN.
- Numbering uses SQ + YYMM + four-digit minimum sequence, resets monthly, and retains cancelled numbers. An advisory transaction lock serializes allocation.
- Customer contact snapshots, credit days, price levels, units, line discounts, bill discount, VAT and notes follow the sales workflow. SQ makes no stock, receivable, or cash/bank movements.
- One SQ can be referenced by one active sale. A sale can reference one SQ, edit its own values, and detach the reference when saved. Cancellation/detachment releases the SQ; historical quotation ID and revision remain on a cancelled sale.
- Server-side transaction locks and reference guards reject changes/cancellation of a linked SQ. Activity timelines and audit records expose the related sale.
- Original documents display the base SQ number. A save changing business values increments Rev.01, Rev.02, etc.; an unchanged save does not increment. The base number remains immutable. AuditLog stores complete before/after snapshots and revision metadata; there is no revision-history table. Stale editor revisions are rejected. Sale references retain the revision used at attachment.
- Quote printing uses shared presentation primitives, due date (document date + credit days), the primary transfer account, and the latest saving user's signature name. No verification/notice section; the unboxed signature is at the bottom right.
- Sales prints use entered customer name/phone; delivery uses entered shipping address, pickup uses customer address when available and hides an absent address. Customer tax ID and quotation reference display only when present. Cash receipt hides credit terms/due date. Delivery batch, receipt presentation and LIFF consumers are synchronized.
- Shared list printing waits for the requested route, committed document content, fonts and images. It rejects blank/redirected/timed-out documents and retains the iframe until afterprint rather than deleting it after ten seconds. All consumers of PrintFromListButton share the fix.

## Database exception approved by user

The actual Prisma diff proposed deleting five unrelated search indexes and product_search_documents.trgm_text. The user explicitly approved narrow SQ-only SQL instead of the `.rules` db-push-only rule for this change. `prisma/scripts/sales-quotation-schema.sql` and the incremental `sales-quotation-revision.sql` were applied successfully inside transactions. Four permissions and ADMIN grants were added through `setup-sales-quotations.ts`. Existing search indexes and trgm_text were verified retained. No test business documents were inserted into the live database.

## Verification

Regression coverage includes quotation validation/totals, no-op and real revision updates, stale revisions, locked source mutations, sale print snapshots/conditional fields and frozen reference revision, and delayed/blank print readiness. A local browser fixture checked both themes, delayed rendering and iframe retention beyond ten seconds with simulated print/afterprint events; native printer output was not tested.

Final verification (2026-09-07): typecheck passed; all 940 automated tests passed; targeted ESLint passed with zero errors and four existing no-img-element warnings; production build passed. No commit or application deployment was performed. Concurrent uncommitted work in lib/line-webhook-processor.ts, lib/purchase-invoice-ocr.ts and outputs/ was left untouched.
