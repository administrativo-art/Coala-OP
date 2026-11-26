import { NextResponse, type NextRequest } from "next/server";

import {
  jobRolePatchSchema,
  normalizeJobRolePatch,
  stripUndefined,
} from "@/features/hr/lib/schemas";
import { rejectJobRole, requireJobRoleAccess } from "@/features/hr/lib/job-role-route.server";
import { serializeHrValue, type HrAccess } from "@/features/hr/lib/server-access";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { parseRouteBody } from "@/lib/security/route-access.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  applyRecruitmentScoring,
  getRecruitmentScoringBlockMessage,
} from "@/lib/recruitment-scoring";
import { reconcileExecutiveJobRoleHierarchy } from "@/features/hr/lib/job-role-hierarchy.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ roleId: string }> };
type PatchRoleInput = ReturnType<typeof jobRolePatchSchema.parse>;

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "hr.job-roles.update",
  version: 1,
  surface: { method: "PATCH", path: "/api/hr/roles/[roleId]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.job-roles.manage" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "hr.job-roles.update-input", unknownFields: "strip" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

export const PATCH = secureRoute({
  contract,
  enforcer: createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, HrAccess, PatchRoleInput>(contract, {
    authenticate: ({ request }) => requireJobRoleAccess(request, "manage"),
    parseInput: ({ request }) => parseRouteBody(request, jobRolePatchSchema, "HR_JOB_ROLE"),
    // `assertHrAccess` já confere a permissão de gestão.
    authorize: () => undefined,
  }),
}, async ({ routeContext, security: { input } }) => {
  const { roleId } = await routeContext.params;
  const roleRef = hrDbAdmin.collection("jobRoles").doc(roleId);
  const existing = await roleRef.get();
  if (!existing.exists) rejectJobRole("Cargo não encontrado.", "NOT_FOUND");

  const payload = normalizeJobRolePatch(input);
  if (payload.formQuestions !== undefined) {
    const scoringBlock = getRecruitmentScoringBlockMessage(
      applyRecruitmentScoring(payload.formQuestions, "role_100").snapshot
    );
    if (scoringBlock) rejectJobRole(scoringBlock);
  }
  if (payload.parentId === roleId || payload.reportsTo === roleId) rejectJobRole("Um cargo não pode ser pai dele mesmo.");

  const current = existing.data() ?? {};
  const nextData = stripUndefined({
    ...current,
    ...payload,
    createdAt: current.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  if (nextData.isActive !== false && !nextData.defaultProfileId) {
    rejectJobRole("Todo cargo ativo deve possuir um perfil de acesso padrão.");
  }
  if (typeof nextData.defaultProfileId === "string") {
    const profile = await dbAdmin.collection("profiles").doc(nextData.defaultProfileId).get();
    if (!profile.exists) rejectJobRole("Perfil de acesso não encontrado.");
  }

  await roleRef.set(nextData);
  await reconcileExecutiveJobRoleHierarchy();
  const saved = await roleRef.get();
  return NextResponse.json({
    role: {
      id: saved.id,
      ...((serializeHrValue(saved.data() ?? nextData) as Record<string, unknown>) ?? {}),
    },
  });
});
