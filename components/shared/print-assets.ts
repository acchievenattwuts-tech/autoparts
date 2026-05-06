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
