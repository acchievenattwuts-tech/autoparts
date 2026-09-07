/** Browser-measured pagination. Only disposable clones are changed, never React's source DOM. */
const clone = (node: HTMLElement) => {
  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  return copy;
};

type Page = { sheet: HTMLElement; header: HTMLElement; body: HTMLElement; footer: HTMLElement };

/** Partition text without losing markup, including a description taller than one sheet. */
function textPart(element: HTMLElement, start: number, end: number): HTMLElement {
  const result = element.cloneNode(false) as HTMLElement;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let opened = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!opened && start <= offset + length) { range.setStart(node, Math.max(0, start - offset)); opened = true; }
    if (opened && end <= offset + length) { range.setEnd(node, Math.max(0, end - offset)); result.append(range.cloneContents()); return result; }
    offset += length;
  }
  return result;
}

function splitToFit(element: HTMLElement, fits: (part: HTMLElement) => boolean): [HTMLElement, HTMLElement] | null {
  // A table row continues its longest description cell; amounts occur only on the first fragment.
  const cells = element instanceof HTMLTableRowElement ? Array.from(element.cells) : [];
  const target = cells.length ? cells.reduce((a, b) => (a.textContent?.length ?? 0) > (b.textContent?.length ?? 0) ? a : b) : element;
  const length = target.textContent?.length ?? 0;
  if (length < 2) return null;
  const make = (start: number, end: number) => {
    const fragment = textPart(target, start, end);
    if (!cells.length) return fragment;
    const row = clone(element) as HTMLTableRowElement;
    if (start) Array.from(row.cells).forEach((cell) => cell.replaceChildren());
    row.cells[cells.indexOf(target as HTMLTableCellElement)].replaceWith(fragment);
    if (start) row.dataset.printContinuation = "true";
    return row;
  };
  let low = 1, high = length - 1, best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(make(0, mid))) { best = mid; low = mid + 1; } else high = mid - 1;
  }
  if (!best) return null;
  // Avoid splitting a surrogate pair.
  const code = target.textContent!.charCodeAt(best - 1);
  if (code >= 0xd800 && code <= 0xdbff) best--;
  return best ? [make(0, best), make(best, length)] : null;
}

export function paginatePrintSource(source: HTMLElement, output: HTMLElement) {
  const measure = document.createElement("div");
  measure.className = "print-pagination-measure print-document-root";
  measure.setAttribute("aria-hidden", "true");
  document.body.append(measure);
  const pages: Page[] = [];
  try {
    const children = Array.from(source.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName !== "STYLE");
    const headers = children.filter((node) => node.dataset.printRole === "header");
    const footers = children.filter((node) => node.dataset.printRole === "footer");
    const overlays = children.filter((node) => node.dataset.printRole === "overlay");
    const summaries = children.filter((node) => node.dataset.printRole === "summary");
    const content = children.filter((node) => !["header", "footer", "overlay", "summary"].includes(node.dataset.printRole ?? ""));
    const addPage = () => {
      const sheet = document.createElement("section"); sheet.className = "print-paper";
      const header = document.createElement("div"); header.className = "print-paper-header";
      const body = document.createElement("div"); body.className = "print-paper-body";
      const footer = document.createElement("div"); footer.className = "print-paper-footer";
      header.append(...headers.map(clone)); footer.append(...footers.map(clone));
      sheet.append(...overlays.map(clone), header, body, footer); measure.append(sheet);
      // Final totals reserve the same space on every sheet; only the last sheet displays them.
      const reserve = document.createElement("div"); reserve.className = "print-summary-reserve";
      reserve.append(...summaries.map(clone)); footer.prepend(reserve);
      const page = { sheet, header, body, footer }; pages.push(page); return page;
    };
    let page = addPage();
    const fits = () => page.body.getBoundingClientRect().bottom <= page.footer.getBoundingClientRect().top - 2;
    const hasContent = () => page.body.textContent?.trim();
    const appendBlock = (element: HTMLElement) => {
      if (element instanceof HTMLTableElement) { appendTable(element); return; }
      let pending: HTMLElement | null = clone(element);
      while (pending) {
        page.body.append(pending);
        if (fits()) return;
        const style = getComputedStyle(pending);
        const height = pending.getBoundingClientRect().height + parseFloat(style.marginTop || "0") + parseFloat(style.marginBottom || "0");
        const sheetStyle = getComputedStyle(page.sheet);
        const capacity = page.sheet.clientHeight - parseFloat(sheetStyle.paddingTop) - parseFloat(sheetStyle.paddingBottom) - page.header.offsetHeight - page.footer.offsetHeight - 2;
        pending.remove();
        // Break large structured report/payment sections at child boundaries first.
        if (height > capacity && (pending.children.length > 1 || pending.querySelector("table"))) {
          const children = Array.from(pending.children) as HTMLElement[];
          for (const child of children) appendBlock(child);
          return;
        }
        if (height <= capacity && hasContent()) { page = addPage(); continue; }
        const parts = splitToFit(pending, (part) => { page.body.append(part); const ok = fits(); part.remove(); return ok; });
        if (!parts && hasContent()) { page = addPage(); continue; }
        if (!parts) throw new Error("ส่วนหัวหรือท้ายเอกสารสูงเกินพื้นที่ A4 กรุณาลดข้อความในส่วนดังกล่าว");
        page.body.append(parts[0]); page = addPage(); pending = parts[1];
      }
    };
    const appendTable = (table: HTMLTableElement) => {
      const rows = Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
      let active: HTMLTableElement | null = null;
      const ensureTable = () => {
        if (active?.parentElement === page.body) return active.tBodies[0];
        active = clone(table) as HTMLTableElement;
        Array.from(active.tBodies).forEach((body) => body.remove()); active.tFoot?.remove();
        // Freeze widths measured with all rows, so each page wraps text identically.
        const widths = Array.from(table.tHead?.rows[0]?.cells ?? []).map((cell) => cell.getBoundingClientRect().width);
        if (widths.some((width) => width > 0)) {
          active.querySelectorAll("colgroup").forEach((group) => group.remove());
          const group = document.createElement("colgroup");
          widths.forEach((width) => { const col = document.createElement("col"); col.style.width = `${width}px`; group.append(col); });
          active.prepend(group); active.style.tableLayout = "fixed";
        }
        const body = document.createElement("tbody"); active.append(body); page.body.append(active); return body;
      };
      for (const row of rows) {
        let pending: HTMLElement | null = clone(row);
        while (pending) {
          const body = ensureTable(); body.append(pending);
          if (fits()) break;
          pending.remove();
          if (body.rows.length || page.body.children.length > 1) { if (!body.rows.length) body.parentElement?.remove(); page = addPage(); continue; }
          const parts = splitToFit(pending, (part) => { body.append(part); const ok = fits(); part.remove(); return ok; });
          if (!parts) throw new Error("รายการสูงเกินพื้นที่พิมพ์ กรุณาตรวจสอบส่วนหัวและท้ายเอกสาร");
          body.append(parts[0]); page = addPage(); pending = parts[1];
        }
      }
      if (!rows.length) ensureTable();
      if (table.tFoot) appendBlock(table.tFoot);
    };
    // Measure the original table at the same physical width before fixing column widths.
    const reference = document.createElement("div"); reference.className = "print-pagination-reference";
    reference.append(...content.map(clone)); measure.append(reference);
    for (const element of Array.from(reference.children) as HTMLElement[]) {
      if (element instanceof HTMLTableElement) appendTable(element); else appendBlock(element);
    }
    pages.forEach(({ sheet }, index) => {
      sheet.querySelectorAll("[data-print-page-label]").forEach((label) => { label.textContent = `หน้า ${index + 1}/${pages.length}`; });
      const summary = sheet.querySelector<HTMLElement>(".print-summary-reserve");
      if (summary && index < pages.length - 1) {
        summary.style.visibility = "hidden";
        summary.setAttribute("aria-hidden", "true");
        summary.classList.add("print-summary-placeholder");
      }
      sheet.dataset.printPage = String(index + 1);
    });
    output.replaceChildren(...pages.map(({ sheet }) => sheet));
  } finally { measure.remove(); }
}
