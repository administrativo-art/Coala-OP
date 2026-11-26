import { NextResponse, type NextRequest } from "next/server";

import {
  jobRoleCreateSchema,
  normalizeJobRoleInput,
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

type StaticRouteContext = { params: Promise<Record<string, never>> };
type CreateRoleInput = ReturnType<typeof jobRoleCreateSchema.parse>;

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: "hr.job-roles.list",
  version: 1,
  surface: { method: "GET", path: "/api/hr/roles" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.job-roles.view" },
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: "hr.job-roles.create",
  version: 1,
  surface: { method: "POST", path: "/api/hr/roles" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.job-roles.manage" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "hr.job-roles.create-input", unknownFields: "strip" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

export const GET = secureRoute({
  contract: listContract,
  enforcer: createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, HrAccess>(listContract, {
    authenticate: ({ request }) => requireJobRoleAccess(request, "view"),
    // `assertHrAccess` já confere a permissão do modo pedido.
    authorize: () => undefined,
  }),
}, async () => {
  const snapshot = await hrDbAdmin.collection("jobRoles").orderBy("name").get();
  return NextResponse.json({
    roles: snapshot.docs.map((doc) => ({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
  });
});

export const POST = secureRoute({
  contract: createContract,
  enforcer: createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, HrAccess, CreateRoleInput>(createContract, {
    authenticate: ({ request }) => requireJobRoleAccess(request, "manage"),
    parseInput: ({ request }) => parseRouteBody(request, jobRoleCreateSchema, "HR_JOB_ROLE"),
    authorize: () => undefined,
  }),
}, async ({ security: { input } }) => {
  const payload = normalizeJobRoleInput(input);
  if (payload.isActive !== false && !payload.defaultProfileId) {
    rejectJobRole("Todo cargo ativo deve possuir um perfil de acesso padrão.");
  }
  if (payload.defaultProfileId) {
    const profile = await dbAdmin.collection("profiles").doc(payload.defaultProfileId).get();
    if (!profile.exists) rejectJobRole("Perfil de acesso não encontrado.");
  }
  const scoringBlock = getRecruitmentScoringBlockMessage(
    applyRecruitmentScoring(payload.formQuestions ?? [], "role_100").snapshot
  );
  if (scoringBlock) rejectJobRole(scoringBlock);

  const now = new Date().toISOString();
  const data = stripUndefined({
    ...payload,
    createdAt: now,
    updatedAt: now,
  });

  const ref = await hrDbAdmin.collection("jobRoles").add(data);
  await reconcileExecutiveJobRoleHierarchy();
  const saved = await ref.get();

  return NextResponse.json(
    {
      role: {
        id: saved.id,
        ...((serializeHrValue(saved.data() ?? data) as Record<string, unknown>) ??
          {}),
      },
    },
    { status: 201 }
  );
});
