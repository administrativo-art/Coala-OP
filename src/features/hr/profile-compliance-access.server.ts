import type { NextRequest } from "next/server";

import { PROFILE_COMPLIANCE_POLICY_VERSION } from "@/features/hr/profile-compliance";

const INCOMPLETE_PROFILE_ALLOWED_PATHS = [
  "/api/profile-compliance",
  "/api/auth/last-login",
  "/api/auth/password-changed",
  "/api/hr/login-access",
] as const;

export function requestAllowsIncompleteProfile(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (INCOMPLETE_PROFILE_ALLOWED_PATHS.some((path) => pathname === path)) return true;

  if (pathname === "/api/client/bootstrap") {
    const requested = (request.nextUrl.searchParams.get("collections") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return requested.length === 1 && requested[0] === "currentUser";
  }

  return false;
}

export function hasCurrentProfileCompliance(userData: Record<string, unknown>) {
  const compliance = userData.profileCompliance && typeof userData.profileCompliance === "object"
    ? userData.profileCompliance as Record<string, unknown>
    : {};
  return compliance.status === "complete"
    && compliance.policyVersion === PROFILE_COMPLIANCE_POLICY_VERSION;
}

export function requiresProfileCompliance(
  userData: Record<string, unknown>,
  request: NextRequest,
) {
  return !requestAllowsIncompleteProfile(request) && !hasCurrentProfileCompliance(userData);
}
