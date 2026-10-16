import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { assertCashClosureAccess, cashClosureActor } from "@/features/financial/cash-closures/access.server";
import {
  classifyCashSupply,
  getCashClosure,
} from "@/features/financial/cash-closures/repository.server";
import { classifyCashSupplySchema } from "@/features/financial/cash-closures/schemas";
import { AppError } from "@/lib/observability";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

type RouteContext = { params: Promise<{ closureId: string }> };
type Input = {
  lineId: string;
  movementId: string;
  classification: "cash_fund" | "supply";
};

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.cash-closure.supply-classification",
  version: 1,
  surface: { method: "PATCH", path: "/api/financial/cash-closures/[closureId]/supplies" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.cash-closures.approve" },
  resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "financial.cash-closure.supply-classification", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<
  NextRequest,
  RouteContext,
  unknown,
  ServerUserContext,
  Input,
  { workspaceId: string; unitId: string; closureId: string }
>({
  id: "financial-cash-closure-supply-classification-v1",
  guarantees: [
    "authenticated-user",
    "active-user",
    "permission-checked",
    "workspace-scoped",
    "unit-scoped",
    "input-validated",
    "fields-allowlisted",
  ],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "CASH_SUPPLY_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    const parsed = classifyCashSupplySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({
        code: "CASH_SUPPLY_CLASSIFICATION_INVALID",
        kind: "VALIDATION",
        safeMessage: "Selecione Fundo de caixa ou Suprimento para um movimento válido.",
        cause: parsed.error,
      });
    }
    const { closureId } = await routeContext.params;
    const current = await getCashClosure(closureId);
    if (!current) throw new AppError({ code: "CASH_CLOSURE_NOT_FOUND", kind: "NOT_FOUND" });
    try {
      assertCashClosureAccess(actor, "approve", current.closure.kioskId);
    } catch (cause) {
      throw new AppError({ code: "CASH_SUPPLY_CLASSIFICATION_FORBIDDEN", kind: "AUTHORIZATION", cause });
    }
    if (current.closure.workspaceId !== actor.workspace_id) {
      throw new AppError({ code: "CASH_SUPPLY_CLASSIFICATION_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    return {
      actor,
      input: parsed.data,
      resource: {
        workspaceId: current.closure.workspaceId,
        unitId: current.closure.kioskId,
        closureId,
      },
    };
  },
});

function mapClassificationError(cause: unknown): never {
  if (cause instanceof AppError) throw cause;
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("não encontrado")) {
    throw new AppError({ code: "CASH_SUPPLY_NOT_FOUND", kind: "NOT_FOUND", cause });
  }
  if (message.includes("01/11/2026") || message.includes("classificação")) {
    throw new AppError({
      code: "CASH_SUPPLY_CLASSIFICATION_INVALID",
      kind: "VALIDATION",
      safeMessage: message || "Não foi possível classificar este suprimento.",
      cause,
    });
  }
  if (message.includes("finalizado") || message.includes("editados")) {
    throw new AppError({
      code: "CASH_SUPPLY_CLASSIFICATION_CONFLICT",
      kind: "CONFLICT",
      safeMessage: "Reabra a contagem do operador antes de alterar a classificação do suprimento.",
      cause,
    });
  }
  if (message.includes("workspace")) {
    throw new AppError({ code: "CASH_SUPPLY_CLASSIFICATION_FORBIDDEN", kind: "AUTHORIZATION", cause });
  }
  throw cause;
}

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await classifyCashSupply(
    security.resource.closureId,
    {
      ...security.input,
      workspaceId: security.resource.workspaceId,
    },
    cashClosureActor(security.actor),
  ).catch(mapClassificationError);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
