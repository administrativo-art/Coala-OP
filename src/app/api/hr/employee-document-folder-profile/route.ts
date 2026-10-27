import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import { canViewHr } from "@/features/hr/lib/server-access";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { readEmployeeDocumentFolderProfile } from "@/lib/hr/employee-document-folder-profile.server";
import { isOwnHrEmployeeId } from "@/lib/hr/person-link";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const path = "/api/hr/employee-document-folder-profile" as const;
const inputSchema = z.object({ employeeId: z.string().trim().min(1).max(180) }).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = { employeeId: string; workspaceId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "hr.employee-document-folder-profile.read",
  version: 1,
  surface: { method: "GET", path },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "hr-view-and-employee-unit" },
  resourceScope: { kind: "custom", strategy: "employee-workspace" },
  input: { kind: "schema", schema: "hr.employee-document-folder-profile.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: "hr-employee-document-folder-profile-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:hr-view-and-employee-unit", "scope:employee-workspace", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!canViewHr(actor.permissions, actor.isDefaultAdmin)) {
      throw new AppError({ code: "HR_FOLDER_PROFILE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = inputSchema.safeParse(query);
    if (!parsed.success || [...request.nextUrl.searchParams.keys()].length !== 1) {
      throw new AppError({ code: "HR_FOLDER_PROFILE_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Colaborador inválido." });
    }
    const employeeId = parsed.data.employeeId;
    const ownProfileOnly = actor.permissions.dp?.collaborators?.ownProfileOnly === true;
    if (ownProfileOnly && employeeId !== actor.decoded.uid && !isOwnHrEmployeeId(actor.userDoc, employeeId)) {
      throw new AppError({ code: "HR_FOLDER_PROFILE_SCOPE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    await assertEmployeeUnitAccess(actor, employeeId).catch((cause) => {
      throw new AppError({ code: "HR_FOLDER_PROFILE_UNIT_FORBIDDEN", kind: "AUTHORIZATION", cause });
    });
    return { actor, input: parsed.data, resource: { employeeId, workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const profile = await readEmployeeDocumentFolderProfile([security.input.employeeId]);
  return NextResponse.json({
    folderProfile: profile ? {
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
      templateLabel: profile.templateLabel,
      folders: profile.folders,
    } : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
});
