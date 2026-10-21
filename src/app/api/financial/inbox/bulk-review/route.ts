import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveSelectedFinancialInboxMessages,
  FinancialInboxReviewError,
  reviewFinancialInboxMessages,
} from "@/features/financial/inbox/repository.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  status: z.enum(["ignored", "archived"]),
}).strict();

export const runtime = "nodejs";
type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.inbox.bulk-review",
  version: 1,
  surface: { method: "POST", path: "/api/financial/inbox/bulk-review" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.inbox.discard" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.inbox.bulk-review", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, z.infer<typeof schema>, { workspaceId: string }>({
  id: "financial-inbox-bulk-review-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "FINANCIAL_INBOX_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || !actor.permissions.financial?.inbox?.discard
    )) {
      throw new AppError({ code: "FINANCIAL_INBOX_BULK_REVIEW_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para revisar cobranças recebidas." });
    }
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "FINANCIAL_INBOX_BULK_REVIEW_INVALID", kind: "VALIDATION", safeMessage: "Selecione entre 1 e 50 cobranças válidas.", cause: parsed.error });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input } = security;
  try {
    const result = input.status === "ignored"
      ? await reviewFinancialInboxMessages({
          ids: input.ids, status: "ignored", workspaceId: actor.workspace_id,
          actorId: actor.decoded.uid, actorEmail: actor.decoded.email,
        })
      : await archiveSelectedFinancialInboxMessages({
          ids: input.ids, workspaceId: actor.workspace_id,
          actorId: actor.decoded.uid, actorEmail: actor.decoded.email,
        });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof FinancialInboxReviewError && cause.code === "NOT_FOUND") {
      throw new AppError({ code: "FINANCIAL_INBOX_MESSAGE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Uma das cobranças selecionadas não foi encontrada.", cause });
    }
    if (cause instanceof FinancialInboxReviewError) {
      throw new AppError({ code: "FINANCIAL_INBOX_BULK_REVIEW_CONFLICT", kind: "CONFLICT", safeMessage: "A seleção contém cobrança em estado incompatível com a ação.", cause });
    }
    throw cause;
  }
});
