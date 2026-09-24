import { del, get, put } from "@vercel/blob";

/**
 * Shared access to the PRIVATE Vercel Blob store (the same store that holds LINE
 * payment slips, see `lib/line-payment-slip-storage.ts`). Used for PII evidence
 * files — expense attachments and delivery-proof images — that must never be
 * reachable by a public URL. Objects are addressed by pathname and served only
 * through session-checked `/api/admin/...` routes.
 */

export const PRIVATE_BLOB_TOKEN_ENV = "BLOB_SLIPS_READ_WRITE_TOKEN";

/** Thrown when the private store token is missing — never fall back to the public store. */
export class PrivateBlobStoreNotConfiguredError extends Error {
  constructor() {
    super(`${PRIVATE_BLOB_TOKEN_ENV}_NOT_CONFIGURED`);
    this.name = "PrivateBlobStoreNotConfiguredError";
  }
}

/**
 * The private store token. Throws when unset: `@vercel/blob` would otherwise fall
 * back to `BLOB_READ_WRITE_TOKEN`, i.e. the PUBLIC store.
 */
export const getPrivateBlobToken = (): string => {
  const token = process.env[PRIVATE_BLOB_TOKEN_ENV]?.trim();
  if (!token) throw new PrivateBlobStoreNotConfiguredError();
  return token;
};

/** Uploads an object to the private store and returns its pathname (what the DB stores). */
export async function putPrivateBlobObject(input: {
  objectPath: string;
  body: Uint8Array;
  contentType: string;
}): Promise<string> {
  const token = getPrivateBlobToken();
  const result = await put(input.objectPath, Buffer.from(input.body), {
    access: "private",
    contentType: input.contentType,
    // Paths are content-addressed (timestamp + uuid) so they never collide.
    addRandomSuffix: false,
    token,
  });
  return result.pathname;
}

/** Reads a private object for a stream route. Null when missing or unreadable. */
export async function readPrivateBlobObject(
  pathname: string,
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null> {
  try {
    const result = await get(pathname, { access: "private", token: getPrivateBlobToken() });
    if (result && result.statusCode === 200) {
      return {
        stream: result.stream,
        contentType: result.headers.get("content-type") ?? "application/octet-stream",
      };
    }
  } catch (error) {
    console.error("[private-blob-storage] read failed", error);
  }
  return null;
}

/** Best-effort removal of private objects — never throws. */
export async function deletePrivateBlobObjects(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    await del(pathnames, { token: getPrivateBlobToken() });
  } catch (error) {
    console.error("[private-blob-storage] delete failed", error);
  }
}
