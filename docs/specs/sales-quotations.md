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

## Print totals, detail layout and the sale-side SQ picker (2026-09-08)

- `QuotationPrintDocument` totals now use the sales/delivery document's summary form: one bordered strip under the item table with the note cell on the left and a 15rem totals cell on the right (มูลค่ารวม / ส่วนลด / ยอดสุทธิ in bold with the Thai baht text underneath). ยอดก่อนภาษี and VAT rows are rendered only when the quotation actually carries VAT (`vatType !== NO_VAT` and `vatRate > 0`), so a non-VAT shop no longer prints a 0.00 VAT line. The VAT type label in the note cell follows the same condition (2026-09-08): "ไม่มีภาษี" is not worth a line on a quotation that never charges tax, while ราคาไม่รวม/รวม VAT still prints next to the VAT rows. Confirmed with the user before implementing.
- Item detail (`moreDetail`) is rendered inline after the product name separated by a space, matching the sales document, instead of dropping onto its own line.
- The quotation detail page adopts the sale detail page's two-column body: `xl:grid-cols-[30fr_70fr]` with the compact, sticky document activity timeline on the left and the print preview on the right. The preview no longer carries `min-h-[1050px]` on screen — the print stylesheet already sets `min-height: 270mm` on `#quotation-print`, so removing the screen-only class stops the long blank page under short quotations without changing printed output.
- The sale form's SQ picker no longer has its own "เลข SQ / ชื่อลูกค้า" text box or "ค้นหา SQ" button. It loads the available quotations (ACTIVE and not referenced by another sale, 50 most recent) on mount and filters them inside `SearchableSelect`'s own search box; each option shows the document date and net amount as a sublabel. The block is painted as a quiet white card with a muted label rather than the previous sky-tinted panel, because referencing an SQ is the exception, not the norm.
- `SearchableSelect` gained an opt-in `emptyTone="neutral"` prop. The empty trigger otherwise renders in orange to mean "this required field still needs a value", which is the wrong signal for an optional picker. Default behaviour is unchanged for every existing caller, and both themes are covered.

## Sale-side locking for a referenced SQ (2026-09-08)

Confirmed with the user before implementing: on `/admin/sales/new` and `/admin/sales/[id]/edit`, a sale that references an SQ locks the customer selector and the whole VAT control (type buttons and rate), with a short hint saying the SQ has to be detached first. ชื่อลูกค้า, เบอร์โทร, ที่อยู่จัดส่ง and เครดิต stay editable, because a sale legitimately ships to a different name/address than the quotation carried.

`createSale` and `updateSale` re-read the quotation and overwrite `customerId`, `vatType` and `vatRate` with its values before totals are computed — a Server Action can be invoked directly, so the disabled inputs are UX only, and VAT feeds `netAmount`, which is why the override cannot sit inside the transaction next to the reference guard. The three fields are the only ones taken out of the `parsed.data` destructuring and declared with `let`.

`loadQuotationForSale` now fills each imported line's supplier from the product's preferred supplier, exactly as picking the product by hand on the sale form does. SQ has no supplier column and the action previously hard-coded `supplierId: ""`, so every SQ-sourced sale line started with an empty supplier.

Known consequence: a user without `sales_quotations.view` editing a sale that already references an SQ sees the locked fields but no picker, so they cannot detach the reference to unlock them. That matches the intent — those fields belong to the quotation — but it is a real dead end for that role.
