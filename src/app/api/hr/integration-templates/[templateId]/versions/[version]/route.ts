import { NextRequest, NextResponse } from "next/server";

import { getIntegrationTemplateVersion } from "@/features/hr/integration/server";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ templateId: string; version: string }> };

export const GET = withApiErrorHandling<RouteContext>({
  source: "api-hr",
  operation: "get-integration-template-version",
  routeOrJob: "/api/hr/integration-templates/[templateId]/versions/[version]",
}, async (request, { params }) => {
    await assertFormalizationAccess(request, "view").catch((cause) => {
      throw new AppError({ code: "HR_TEMPLATE_VIEW_FORBIDDEN", kind: "AUTHORIZATION", cause });
    });
    const { templateId, version: rawVersion } = await params;
    const versionNumber = Number(rawVersion);
    if (!Number.isInteger(versionNumber) || versionNumber < 1) {
      throw new AppError({
        code: "HR_TEMPLATE_VERSION_INVALID",
        kind: "VALIDATION",
        safeMessage: "Versão inválida.",
      });
    }
    const version = await getIntegrationTemplateVersion(templateId, versionNumber);
    if (!version) {
      throw new AppError({
        code: "HR_TEMPLATE_VERSION_NOT_FOUND",
        kind: "NOT_FOUND",
        safeMessage: "Versão não encontrada.",
      });
    }
    return NextResponse.json({ version });
});
