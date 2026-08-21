const AUTH_BASE_PATH = "/api/auth";

const AUTH_ACTIONS = new Set([
  "callback",
  "csrf",
  "error",
  "providers",
  "session",
  "signin",
  "signout",
  "verify-request",
  "webauthn-options",
]);

const AUTH_ACTIONS_WITH_PROVIDER = new Set([
  "callback",
  "signin",
  "webauthn-options",
]);

export type AuthRequestGuardDecision =
  | { type: "forward" }
  | { type: "reject"; status: 404 | 405; allow?: string };

function hasSupportedAuthPath(pathname: string): boolean {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;

  const segments = pathname
    .slice(AUTH_BASE_PATH.length)
    .split("/")
    .filter(Boolean);

  if (segments.length !== 1 && segments.length !== 2) return false;

  const [action, providerId] = segments;
  if (!AUTH_ACTIONS.has(action)) return false;

  return !providerId || AUTH_ACTIONS_WITH_PROVIDER.has(action);
}

export function decideAuthRequest(
  pathname: string,
  method: string,
): AuthRequestGuardDecision {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === "HEAD") {
    return { type: "reject", status: 405, allow: "GET, POST" };
  }

  if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
    return { type: "reject", status: 405, allow: "GET, POST" };
  }

  if (!hasSupportedAuthPath(pathname)) {
    return { type: "reject", status: 404 };
  }

  return { type: "forward" };
}

export function createAuthGuardResponse(
  decision: Extract<AuthRequestGuardDecision, { type: "reject" }>,
): Response {
  return new Response(decision.status === 404 ? "Not Found" : null, {
    status: decision.status,
    headers: {
      ...(decision.allow ? { Allow: decision.allow } : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
