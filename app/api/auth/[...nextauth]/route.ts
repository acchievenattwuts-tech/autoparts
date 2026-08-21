import { handlers } from "@/auth";
import {
  createAuthGuardResponse,
  decideAuthRequest,
} from "@/lib/auth-request-guard";
import type { NextRequest } from "next/server";

function guardRequest(request: NextRequest): Response | null {
  const decision = decideAuthRequest(request.nextUrl.pathname, request.method);
  return decision.type === "reject" ? createAuthGuardResponse(decision) : null;
}

export function GET(request: NextRequest) {
  return guardRequest(request) ?? handlers.GET(request);
}

export function POST(request: NextRequest) {
  return guardRequest(request) ?? handlers.POST(request);
}

export function HEAD() {
  return createAuthGuardResponse({
    type: "reject",
    status: 405,
    allow: "GET, POST",
  });
}
