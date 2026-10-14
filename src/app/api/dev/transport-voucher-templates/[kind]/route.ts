import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { systemDocumentTemplateById } from "@/features/hr/documents/system-template-catalog";
import { renderTransportVoucherTemplateDemoPdf } from "@/features/hr/requests/transport-voucher-template-pdf.server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_IDS = {
  suspension: "system-admission-transportation-voucher-waiver",
  adhesion: "system-admission-transportation-voucher-request",
  reactivation: "system-post-admission-transportation-voucher-reactivation",
} as const;

type RouteContext = { params: Promise<{ kind: string }> };
const inputSchema = z.object({ kind: z.enum(["suspension", "adhesion", "reactivation"]) }).strict();

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "dev.transport-voucher-template.preview",
  version: 1,
  surface: { method: "GET", path: "/api/dev/transport-voucher-templates/[kind]" },
  exposure: "public",
  identity: { kind: "none" },
  authorization: { kind: "none" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "transport-voucher-template-preview", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
  additionalGuarantees: ["control:localhost-only"],
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, undefined, z.infer<typeof inputSchema>, undefined>({
  id: "dev-transport-voucher-template-preview-v1",
  guarantees: ["input-validated", "fields-allowlisted", "control:localhost-only"],
  async enforce({ request, routeContext }) {
    const hostname = request.nextUrl.hostname;
    if (process.env.NODE_ENV === "production" || (hostname !== "localhost" && hostname !== "127.0.0.1")) {
      throw new AppError({ code: "TRANSPORT_VOUCHER_PREVIEW_NOT_FOUND", kind: "EXPECTED_BUSINESS", safeMessage: "Prévia local não encontrada.", httpStatus: 404, reportable: false });
    }
    const parsed = inputSchema.safeParse(await routeContext.params);
    if (!parsed.success) throw new AppError({ code: "TRANSPORT_VOUCHER_PREVIEW_KIND_INVALID", kind: "VALIDATION", safeMessage: "Modelo não encontrado.", reportable: false });
    return { actor: undefined, input: parsed.data, resource: undefined };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { kind } = security.input;
  const templateId = TEMPLATE_IDS[kind as keyof typeof TEMPLATE_IDS];
  const template = templateId ? systemDocumentTemplateById(templateId) : null;
  if (!template) throw new AppError({ code: "TRANSPORT_VOUCHER_PREVIEW_TEMPLATE_NOT_FOUND", kind: "EXPECTED_BUSINESS", safeMessage: "Modelo não encontrado.", httpStatus: 404, reportable: false });
  try {
    const pdf = await renderTransportVoucherTemplateDemoPdf(template);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${kind}-vale-transporte.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Document-Preview-Mode": "fictional-demo",
      },
    });
  } catch (cause) {
    throw new AppError({ code: "TRANSPORT_VOUCHER_PREVIEW_RENDER_FAILED", kind: "UNEXPECTED_APPLICATION", safeMessage: "Não foi possível gerar a prévia do termo.", cause });
  }
});
