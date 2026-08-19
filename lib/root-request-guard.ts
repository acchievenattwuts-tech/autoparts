/**
 * The storefront homepage currently has no Server Action, webhook, or other
 * legitimate POST contract. Reject only that exact method/path pair so a
 * malformed multipart probe cannot reach Next.js' Server Action FormData
 * parser. All other methods and paths must continue through the existing
 * proxy logic unchanged.
 *
 * If a legitimate POST / workflow is introduced, update this guard and its
 * regression tests in the same change (see AGENTS.md: Root POST Guard Sync Rule).
 */
export function shouldRejectRootPost(pathname: string, method: string): boolean {
  return pathname === "/" && method.toUpperCase() === "POST";
}
