"use client";

type PrintReadyOptions = {
  root?: Document | HTMLElement | null;
  timeoutMs?: number;
  settleMs?: number;
};

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_SETTLE_MS = 100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const imageIsReady = (image: HTMLImageElement) => image.complete;

const waitForImage = async (image: HTMLImageElement, timeoutMs: number) => {
  if (imageIsReady(image)) return;

  await Promise.race([
    new Promise<void>((resolve) => {
      const done = () => {
        image.removeEventListener("load", done);
        image.removeEventListener("error", done);
        resolve();
      };

      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    }),
    wait(timeoutMs),
  ]);

  if (image.complete && image.decode) {
    await image.decode().catch(() => undefined);
  }
};

export const waitForPrintAssets = async ({
  root,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  settleMs = DEFAULT_SETTLE_MS,
}: PrintReadyOptions = {}) => {
  const target = root ?? document;
  const targetDocument =
    "nodeType" in target && target.nodeType === Node.DOCUMENT_NODE
      ? (target as Document)
      : (target as HTMLElement).ownerDocument ?? document;
  const images = Array.from(target.querySelectorAll("img")) as HTMLImageElement[];
  const fonts = "fonts" in targetDocument ? targetDocument.fonts.ready.catch(() => undefined) : Promise.resolve();

  await Promise.all([fonts, Promise.all(images.map((image) => waitForImage(image, timeoutMs)))]);
  await wait(settleMs);
};

export const printWhenReady = async (options?: PrintReadyOptions) => {
  await waitForPrintAssets(options);
  window.print();
};

/** The load event alone is insufficient for streamed App Router pages. */
export const waitForPrintDocument = async (frame: HTMLIFrameElement, expectedUrl: string, timeoutMs = 60000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!frame.isConnected) throw new Error("ยกเลิกการโหลดเอกสาร");
    const doc = frame.contentDocument;
    if (doc && doc.URL !== "about:blank") {
      if (new URL(doc.URL).pathname !== new URL(expectedUrl, document.baseURI).pathname) {
        throw new Error("ไม่สามารถเปิดเอกสารได้ กรุณาตรวจสอบการเข้าสู่ระบบและสิทธิ์");
      }
      const roots = Array.from(doc.querySelectorAll(".print-document-root"));
      if (roots.length && roots.every((root) => root.getAttribute("data-print-ready") === "true")) {
        await waitForPrintAssets({ root: doc });
        return;
      }
    }
    await wait(100);
  }
  throw new Error("โหลดเอกสารไม่สำเร็จ กรุณาลองอีกครั้ง หรือเปิดหน้าเอกสารเพื่อตรวจสอบ");
};
