import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getFinancialInboxAutomationSettings,
  updateFinancialInboxAutomationSettings,
} from "@/features/financial/inbox/automation-settings.server";
import { requireUser } from "@/lib/auth-server";
import { AppError, withApiErrorHandling } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  mode: z.enum(["manual", "document_identity"]),
}).strict();

function canViewInbox(actor: Awaited<ReturnType<typeof requireUser>>) {
  return actor.isDefaultAdmin
    || (actor.permissions.financial?.view === true && actor.permissions.financial?.inbox?.view === true);
}

function canManageInboxAutomation(actor: Awaited<ReturnType<typeof requireUser>>) {
  return actor.isDefaultAdmin
    || (canViewInbox(actor) && actor.permissions.financial?.inbox?.link === true);
}

export const GET = withApiErrorHandling({
  source: "api-financial",
  operation: "get-financial-inbox-automation-settings",
  routeOrJob: "/api/financial/inbox/settings",
}, async (request: NextRequest) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!canViewInbox(actor)) {
    throw new AppError({
      code: "FINANCIAL_INBOX_SETTINGS_VIEW_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para visualizar a configuração da caixa de cobranças.",
    });
  }
  const settings = await getFinancialInboxAutomationSettings(actor.workspace_id);
  return NextResponse.json({ settings }, { headers: { "Cache-Control": "private, no-store" } });
});

export const PUT = withApiErrorHandling({
  source: "api-financial",
  operation: "update-financial-inbox-automation-settings",
  routeOrJob: "/api/financial/inbox/settings",
}, async (request: NextRequest) => {
  const actor = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  if (!canManageInboxAutomation(actor)) {
    throw new AppError({
      code: "FINANCIAL_INBOX_SETTINGS_UPDATE_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para alterar a vinculação automática.",
    });
  }
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch (cause) {
    throw new AppError({
      code: "FINANCIAL_INBOX_SETTINGS_INVALID_JSON",
      kind: "VALIDATION",
      safeMessage: "A configuração informada não é válida.",
      cause,
    });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError({
      code: "FINANCIAL_INBOX_SETTINGS_INVALID",
      kind: "VALIDATION",
      safeMessage: "Escolha vinculação manual ou automática por identidade documental.",
      cause: parsed.error,
    });
  }
  const settings = await updateFinancialInboxAutomationSettings({
    workspaceId: actor.workspace_id,
    mode: parsed.data.mode,
    actorId: actor.decoded.uid,
    actorEmail: actor.decoded.email,
  });
  return NextResponse.json({ settings }, { headers: { "Cache-Control": "private, no-store" } });
});
