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

const A4_HEIGHT_PX = (297 / 25.4) * 96;
const A4_HEIGHT_BUFFER_PX = 8;

const measureReceiptContentHeight = (receipt: HTMLElement): number => {
  const children = Array.from(receipt.children) as HTMLElement[];
  if (children.length === 0) return receipt.scrollHeight;
  let total = 0;
  for (const child of children) {
    const style = window.getComputedStyle(child);
    if (style.position === "absolute" || style.position === "fixed") continue;
    const rect = child.getBoundingClientRect();
    total += rect.height;
  }
  const computed = window.getComputedStyle(receipt);
  total += parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);
  return total;
};

const applyPrintAutoFit = () => {
  const receipt = document.getElementById("receipt");
  if (!receipt) return () => undefined;

  const previousTransform = receipt.style.transform;
  const previousTransformOrigin = receipt.style.transformOrigin;
  const previousWidth = receipt.style.width;

  const contentHeight = measureReceiptContentHeight(receipt);
  if (contentHeight <= A4_HEIGHT_PX - A4_HEIGHT_BUFFER_PX) {
    return () => undefined;
  }

  const scale = (A4_HEIGHT_PX - A4_HEIGHT_BUFFER_PX) / contentHeight;
  const safeScale = Math.max(0.6, Math.min(scale, 1));
  receipt.style.transform = `scale(${safeScale})`;
  receipt.style.transformOrigin = "top left";
  receipt.style.width = `${100 / safeScale}%`;

  return () => {
    receipt.style.transform = previousTransform;
    receipt.style.transformOrigin = previousTransformOrigin;
    receipt.style.width = previousWidth;
  };
};

export const printWhenReady = async (options?: PrintReadyOptions) => {
  await waitForPrintAssets(options);
  const restore = applyPrintAutoFit();
  try {
    window.print();
  } finally {
    setTimeout(restore, 1000);
  }
};
