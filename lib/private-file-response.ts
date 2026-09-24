import { NextResponse } from "next/server";

import { readPrivateBlobObject } from "@/lib/private-blob-storage";
import { isLegacyPublicFileUrl, isPrivateObjectPathUnderRoot } from "@/lib/private-file-ref";

/** PII: browser-only cache, short-lived, never a shared/CDN cache. */
export const PRIVATE_FILE_CACHE_CONTROL = "private, max-age=300";

const LEGACY_REDIRECT_STATUS = 302;

export const privateFileNotFoundResponse = (): Response => new Response("Not Found", { status: 404 });

/** RFC 5987 `filename*` value — ASCII-only so it is always a valid header. */
const encodeContentDispositionFileName = (fileName: string): string =>
  encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Serves one stored evidence file to an already-authorized admin:
 *  - legacy public `https://` URL → redirect to it (it is public already);
 *  - private pathname under `root/` → stream it from the private store;
 *  - anything else (other prefix, missing object) → 404.
 */
export async function respondWithStoredFile(input: {
  storedValue: string | null | undefined;
  root: string;
  fileName?: string;
}): Promise<Response> {
  const { storedValue, root } = input;
  if (!storedValue) return privateFileNotFoundResponse();

  if (isLegacyPublicFileUrl(storedValue)) {
    if (!/^https:\/\//i.test(storedValue)) return privateFileNotFoundResponse();
    return new Response(null, {
      status: LEGACY_REDIRECT_STATUS,
      headers: { Location: storedValue, "Cache-Control": PRIVATE_FILE_CACHE_CONTROL },
    });
  }

  if (!isPrivateObjectPathUnderRoot(storedValue, root)) return privateFileNotFoundResponse();

  const file = await readPrivateBlobObject(storedValue);
  if (!file) return privateFileNotFoundResponse();

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Cache-Control": PRIVATE_FILE_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
  if (input.fileName) {
    headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeContentDispositionFileName(input.fileName)}`;
  }
  return new Response(file.stream, { status: 200, headers });
}

/** Maps `requirePermission` failures to 401/403; anything else is a logged 500. */
export function privateFileRouteErrorResponse(error: unknown, scope: string): Response {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  console.error(`[${scope}] request failed`, error);
  return NextResponse.json({ error: "INTERNAL_SERVER_ERROR" }, { status: 500 });
}
