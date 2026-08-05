import { cache } from "react";
import type { Session } from "next-auth";

import { auth } from "@/auth";

/**
 * Request-scoped session reader.
 *
 * Every `auth()` call re-runs the jwt() callback in auth.config.ts, which hits
 * the DB for the session-revocation + permission refresh. A single admin
 * navigation used to pay that round-trip three times (layout, page-level
 * `auth()`, and `requirePermission()`), all returning identical data.
 *
 * React's `cache()` memoizes per request only — the DB check still runs once on
 * every navigation, so session revocation and permission changes take effect
 * exactly as fast as before.
 */
export const getSession = cache(async (): Promise<Session | null> => auth());
