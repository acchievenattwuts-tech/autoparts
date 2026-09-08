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

## Admin UI layout parity with the sales entry page (2026-09-07)

Confirmed scope: the whole SQ module (form, list, detail) must match `/admin/sales/new` in labels, type sizes and field positions, and must be checked for responsive behaviour. Business logic, queries, permissions, totals formulas and the print document were left untouched.

- The editor form adopts the sales form presentation tokens verbatim (`inputCls`, `labelCls`, card, section heading). Labels move from bare text nodes inside `<label>` to `text-sm font-medium` blocks with bottom spacing, a red asterisk on required fields, and inputs gain the focus ring and dark placeholder colour they previously lacked.
- Field order follows the sales form: document date, customer, sale type, customer name, phone, credit days, price level, bill discount, note, address, then the VAT row. The two former cards are merged into one "ข้อมูลใบเสนอราคา" card, and the VAT selector becomes the same three-button group plus rate box used on the sales form.
- `saleType` was previously fixed to `RETAIL` with no control even though the schema and the sale hand-off already carried it. A ขายปลีก/ขายส่ง selector was added; this is the only field added in this round. Per-item warranty days and supplier stay out of scope because `SalesQuotationItem` has no such columns.
- Line items move from a six-column responsive grid to the sales form's `<table>` inside `overflow-x-auto`, with the running number column, the same header labels and hints (ก่อนลด / 0 = ไม่ลด / หลังลด), the amber discount column, the row highlight for zero-priced lines, and a trash icon that hides when a single line remains instead of a full-width text button that could be tapped by accident on mobile.
- The totals block becomes the sales form's right-aligned `w-64` label/value list (ราคาขายรวม, ส่วนลดระดับรายการ, ยอดรวม, ส่วนลดท้ายบิล, ยอดก่อนภาษี, VAT, ยอดสุทธิ). Line-level figures are derived in the component for display only; `quotationTotals` is unchanged.
- Both editor routes gain the sales pages' breadcrumb and Kanit `h1`, the action bar moves to the bottom with an เพิ่มรายการ button beside a submit button carrying the sales form's spinner, and errors render in the bordered red card instead of a bare paragraph.
- The list page adopts `AdminPageHeader`, `AdminFilterToolbar`, `AdminTableSection`, `AdminStatusBadge` and `AdminActionGroup`. The filter keeps the mandated `AdminSearchForm` + `AdminSearchSubmitButton` GET pattern. The detail page gains the sales detail breadcrumb plus a summary card (number, date, customer, phone, sale type, credit days, net amount, address) above the print document, and the cancel button becomes a bordered red button.
- Responsive fixes: the list header and filter row now stack below `sm` instead of squeezing at narrow widths; the detail header stacks below `lg`; the item table scrolls horizontally instead of compressing columns, which matters because the sidebar appears at `lg` and makes the content column narrower (~688px) than it is at `md` (~736px).
- Address label kept as "ที่อยู่" so the form and `QuotationPrintDocument` stay in sync, even though the sale hand-off maps it to `shippingAddress`.

Follow-up (2026-09-08): the list filter row was rebuilt on the expenses/WHT toolbar pattern — one row of uniform-height controls (inline "ช่วงวันที่" caption, two date inputs, a free-text box, submit, and a ล้าง link) instead of stacked labels above each field. `AdminSearchForm` always applies `space-y-3`, so a flex row whose children have different heights leaves the submit button sitting below the inputs; equal-height children remove the problem at the source rather than fighting it with alignment utilities.

Verification (2026-09-07): `tsc --noEmit` clean; ESLint on the SQ directory clean; the SQ action test passed; `check:mojibake` clean; all four SQ routes compiled without errors under the dev server. `npm run build` fails on the untracked in-progress WHT module (`app/admin/(protected)/wht/WhtAttachmentCell.tsx` pulls `sharp` into the client bundle) — a pre-existing failure unrelated to this change.
