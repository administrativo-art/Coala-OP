import { NextRequest, NextResponse } from "next/server";

import { generateDocumentFromTemplate } from "@/features/hr/documents/generate-document.server";
import { assertFormalizationAccess } from "@/features/hr/lib/server-access";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

export const runtime = "nodejs";
function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }

export async function POST(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "documents.generate");
    const body = await request.json().catch(() => ({}));
    const templateId = text(body.templateId); const employeeId = text(body.employeeId); const onboardingId = text(body.onboardingId);
    if (!templateId || (!employeeId && !onboardingId)) return error("Informe o modelo e o colaborador ou integração.");
    const includeSensitive = hasFormalizationPermission(access.permissions, "sensitiveData.view", access.isDefaultAdmin);
    const manualValues = body.manualValues && typeof body.manualValues === "object" && !Array.isArray(body.manualValues) ? body.manualValues as Record<string, unknown> : undefined;
    const lifecycle = body.lifecycle === "draft" ? "draft" as const : "final" as const;
    const generated = await generateDocumentFromTemplate({ templateId, employeeId, onboardingId, includeSensitive, manualValues, lifecycle, actorId: access.decoded.uid, actorName: access.actorName });
    if (body.output === "json") {
      return NextResponse.json({ document: { id: generated.id, fileName: generated.fileName, status: generated.status, pdfAvailable: !!generated.pdfStoragePath, missingRequired: generated.missingRequired, templateVersion: generated.templateVersion } });
    }
    return new NextResponse(new Uint8Array(generated.buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${generated.fileName}"`, "Cache-Control": "private, no-store", "X-Generated-Document-Id": generated.id, "X-Missing-Variables": String(generated.missingRequired.length) } });
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Falha ao gerar documento.", 400); }
}
