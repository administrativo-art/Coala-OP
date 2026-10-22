import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  correctFinancialInboxCharge,
  getFinancialInboxChargeCaseForMessage,
} from "@/features/financial/inbox/charge-case.server";
import { getFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import type { FinancialInboxMessage } from "@/features/financial/inbox/types";
import { requireUser } from "@/lib/auth-server";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type Actor = Awaited<ReturnType<typeof requireUser>>;
type Resource = { id: string; message: FinancialInboxMessage };

const routeSchema = z.object({ id: z.string().trim().min(1).max(250) }).strict();
const correctionSchema = z.object({
  supplierName: z.string().trim().min(1).max(200).nullable(),
  supplierTaxId: z.string().transform((value) => value.replace(/\D/g, "")).pipe(
    z.string().length(14).refine((value) => CnpjValidator.validate(value).valid, "CNPJ inválido."),
  ).nullable(),
  documentReference: z.string().trim().min(1).max(120).nullable(),
  competence: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  amountCents: z.number().int().positive().max(1_000_000_000).nullable(),
}).strict();

function canView(actor: Actor) {
  return actor.isDefaultAdmin || (actor.permissions.financial?.view === true
    && actor.permissions.financial?.inbox?.view === true);
}

function canCorrect(actor: Actor) {
  return canView(actor) && (actor.isDefaultAdmin || actor.permissions.financial?.inbox?.link === true);
}

async function authenticate(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
}

async function loadResource(routeContext: RouteContext, actor: Actor) {
  const parsed = routeSchema.safeParse(await routeContext.params);
  if (!parsed.success) {
    throw new AppError({ code: "FINANCIAL_INBOX_CASE_ID_INVALID", kind: "VALIDATION", safeMessage: "Cobrança inválida." });
  }
  const message = await getFinancialInboxMessage(parsed.data.id).catch((cause) => {
    throw new AppError({ code: "FINANCIAL_INBOX_CASE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Cobrança não encontrada.", cause });
  });
  if (message.workspaceId !== actor.workspace_id) {
    throw new AppError({ code: "FINANCIAL_INBOX_CASE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Cobrança não encontrada." });
  }
  return { id: parsed.data.id, message };
}

const readContract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.charge-case.read",
  version: 1,
  surface: { method: "GET", path: "/api/financial/inbox/[id]/case" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.inbox.view" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.charge-case-route", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const readEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, Actor, { id: string }, Resource>({
  id: "financial-inbox-charge-case-read-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await authenticate(request);
    if (!canView(actor)) {
      throw new AppError({ code: "FINANCIAL_INBOX_CASE_VIEW_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar cobranças recebidas." });
    }
    const resource = await loadResource(routeContext, actor);
    return { actor, input: { id: resource.id }, resource };
  },
});

const updateContract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.charge-case.correct",
  version: 1,
  surface: { method: "PATCH", path: "/api/financial/inbox/[id]/case" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.inbox.link" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.charge-correction", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const updateEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, Actor, z.infer<typeof correctionSchema>, Resource>({
  id: "financial-inbox-charge-case-correct-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await authenticate(request);
    if (!canCorrect(actor)) {
      throw new AppError({ code: "FINANCIAL_INBOX_CASE_CORRECT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para corrigir a leitura da cobrança." });
    }
    const parsed = correctionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "FINANCIAL_INBOX_CASE_CORRECTION_INVALID", kind: "VALIDATION", safeMessage: "Revise os dados informados para a cobrança.", cause: parsed.error });
    }
    const resource = await loadResource(routeContext, actor);
    return { actor, input: parsed.data, resource };
  },
});

export const GET = secureRoute({ contract: readContract, enforcer: readEnforcer }, async ({ security }) => {
  const result = await getFinancialInboxChargeCaseForMessage(security.resource.message, security.actor.workspace_id);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});

export const PATCH = secureRoute({ contract: updateContract, enforcer: updateEnforcer }, async ({ security }) => {
  const result = await correctFinancialInboxCharge({
    id: security.resource.id,
    workspaceId: security.actor.workspace_id,
    actorId: security.actor.decoded.uid,
    actorEmail: security.actor.decoded.email,
    correction: security.input,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
