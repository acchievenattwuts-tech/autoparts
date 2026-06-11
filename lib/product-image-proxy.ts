const PRODUCT_IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const PRODUCT_IMAGE_PROXY_TIMEOUT_MS = 8_000;

export function getProductImageProxyContentType(objectPath: string, headers: Headers): string {
  const upstreamContentType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (upstreamContentType?.startsWith("image/")) {
    return upstreamContentType;
  }

  const extension = objectPath.split(".").pop()?.toLowerCase();
  if (extension && PRODUCT_IMAGE_MIME_BY_EXTENSION[extension]) {
    return PRODUCT_IMAGE_MIME_BY_EXTENSION[extension];
  }

  return "application/octet-stream";
}

export async function withProductImageProxyTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PRODUCT_IMAGE_PROXY_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new Error("Product image upstream request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
