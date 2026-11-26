import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { secureRoute } from "@/lib/security/secure-route.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { AppError } from "@/lib/observability/app-error";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { discardCancelledOnboardingDocuments } from "@/lib/hr/onboarding-document-discard.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ onboardingId: z.string().min(1).max(250).regex(/^[^/\\\u0000]+$/).optional() }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: "jobs.hr.onboarding-document-discard", version: 1, surface: { method: "POST", path: "/api/jobs/hr/onboarding-document-discard" }, exposure: "internal-service", identity: { kind: "service-job", service: "onboarding-document-discard" }, authorization: { kind: "custom", strategy: "onboarding-discard-service" }, resourceScope: { kind: "custom", strategy: "cancelled-admission-only" }, input: { kind: "schema", schema: "onboarding-discard-job", unknownFields: "reject" }, effects: { mode: "delete", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, { id: string }, z.infer<typeof schema>, undefined>({
  id: "onboarding-discard-job-v1", guarantees: ["authenticated-service", "authorization:onboarding-discard-service", "scope:cancelled-admission-only", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request }) {
    const expected = Buffer.from(process.env.ONBOARDING_DOCUMENT_DISCARD_SECRET?.trim() ?? ""), actual = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError({ code: "ONBOARDING_DISCARD_JOB_UNAUTHORIZED", kind: "AUTHENTICATION" });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || request.nextUrl.searchParams.size) throw new AppError({ code: "ONBOARDING_DISCARD_JOB_INVALID", kind: "VALIDATION" });
    return { actor: { id: "system:onboarding-document-discard" }, input: parsed.data, resource: undefined };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const parents = security.input.onboardingId ? [await hrDbAdmin.collection("onboardingProcesses").doc(security.input.onboardingId).get()] : (await hrDbAdmin.collection("onboardingProcesses").where("documentDiscard.status", "==", "pending").limit(5).get()).docs;
  const results = [];
  for (const parent of parents) {
    if (!parent.exists || parent.get("status") !== "cancelled" || !parent.get("documentDiscard") || parent.get("completedAt")) continue;
    results.push(await discardCancelledOnboardingDocuments(parent.id, security.actor.id));
  }
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
});
