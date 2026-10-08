import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  consumeFirstAccessLink,
  getFirstAccessLinkStatus,
  provisionPdvFirstAccess,
} from "@/lib/first-access-links";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FirstAccessRouteContext = { params: Promise<{ token: string }> };

const firstAccessInputSchema = z.object({
  action: z.enum(["pdv_password", "coala_password"]).default("coala_password"),
  password: z.string(),
}).strict().superRefine((input, context) => {
  if (input.action === "pdv_password" && !/^[1-9]\d{3}$/.test(input.password)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "A senha do PDV deve ter exatamente 4 números e não pode começar com zero." });
  }
  if (input.action === "coala_password" && input.password.length < 8) {
    context.addIssue({ code: z.ZodIssueCode.too_small, minimum: 8, inclusive: true, type: "string", path: ["password"], message: "A senha deve ter pelo menos 8 caracteres." });
  }
});

function cleanToken(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
}

function errorMessage(reason: string) {
  if (reason === "used") return "Este link já foi usado.";
  if (reason === "expired") return "Este link expirou. Solicite um novo link ao RH.";
  if (reason === "revoked") return "Este link foi substituído por um link mais recente.";
  if (reason === "inactive") return "Este acesso não está disponível para uma conta inativa.";
  if (reason === "in_progress") return "Este link já está sendo processado. Aguarde e tente novamente.";
  return "Link de primeiro acesso inválido.";
}

function statusCode(reason: string) {
  if (reason === "in_progress") return 409;
  if (reason === "inactive") return 403;
  if (["not_found", "invalid", "used", "expired", "revoked"].includes(reason)) return 404;
  return 400;
}

async function authenticateFirstAccess(routeContext: FirstAccessRouteContext) {
  const { token } = await routeContext.params;
  const clean = cleanToken(token);
  if (!clean) {
    throw new AppError({ code: "FIRST_ACCESS_TOKEN_INVALID", kind: "VALIDATION", safeMessage: "Token inválido." });
  }
  const status = await getFirstAccessLinkStatus(clean);
  if (!status.ok) {
    throw new AppError({
      code: "FIRST_ACCESS_LINK_UNAVAILABLE",
      kind: status.reason === "in_progress" ? "CONFLICT" : status.reason === "inactive" ? "AUTHORIZATION" : "NOT_FOUND",
      safeMessage: errorMessage(status.reason),
      httpStatus: statusCode(status.reason),
    });
  }
  return { token: clean, status };
}

const getContract = defineSecurityContract({
  schemaVersion: 1,
  id: "auth.first-access.status",
  version: 1,
  surface: { method: "GET", path: "/api/auth/first-access/[token]" },
  exposure: "public",
  identity: { kind: "public-token", purpose: "first-access" },
  authorization: { kind: "none" },
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const postContract = defineSecurityContract({
  schemaVersion: 1,
  id: "auth.first-access.complete",
  version: 1,
  surface: { method: "POST", path: "/api/auth/first-access/[token]" },
  exposure: "public",
  identity: { kind: "public-token", purpose: "first-access" },
  authorization: { kind: "none" },
  resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "auth.first-access.complete-input", unknownFields: "reject" },
  effects: { mode: "external", audit: "none" },
  errorExposure: "sanitized",
});

const getEnforcer = createStandardSecurityEnforcer<NextRequest, FirstAccessRouteContext, unknown, Awaited<ReturnType<typeof authenticateFirstAccess>>>(
  getContract,
  { authenticate: ({ routeContext }) => authenticateFirstAccess(routeContext) },
);

const postEnforcer = createStandardSecurityEnforcer<NextRequest, FirstAccessRouteContext, unknown, Awaited<ReturnType<typeof authenticateFirstAccess>>, z.infer<typeof firstAccessInputSchema>>(
  postContract,
  {
    authenticate: ({ routeContext }) => authenticateFirstAccess(routeContext),
    async parseInput({ request }) {
      const parsed = firstAccessInputSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError({
          code: "FIRST_ACCESS_INPUT_INVALID",
          kind: "VALIDATION",
          safeMessage: parsed.error.issues[0]?.message ?? "Dados de primeiro acesso inválidos.",
        });
      }
      return parsed.data;
    },
  },
);

export const GET = secureRoute(
  { contract: getContract, enforcer: getEnforcer },
  async ({ security }) => NextResponse.json({
    ok: true,
    email: security.actor.status.email,
    username: security.actor.status.username,
    expiresAt: security.actor.status.expiresAt,
    pdvAccess: security.actor.status.pdvAccess,
  }),
);

export const POST = secureRoute(
  { contract: postContract, enforcer: postEnforcer },
  async ({ security }) => {
    const { token, status } = security.actor;
    const { action, password } = security.input;
    if (action === "pdv_password") {
      try {
        const result = await provisionPdvFirstAccess(token, password);
        if (!result.ok) return NextResponse.json({ error: errorMessage(result.reason) }, { status: statusCode(result.reason) });
        return NextResponse.json({ ok: true, nextStep: "coala_password" });
      } catch (cause) {
        throw new AppError({
          code: "FIRST_ACCESS_PDV_PROVISION_FAILED",
          kind: "PERMANENT_EXTERNAL",
          safeMessage: "Não foi possível criar o acesso no PDV Legal.",
          cause,
        });
      }
    }

    if (status.pdvAccess.required && !status.pdvAccess.completed) {
      throw new AppError({ code: "FIRST_ACCESS_PDV_REQUIRED", kind: "CONFLICT", safeMessage: "Crie primeiro a senha do PDV Legal." });
    }
    const result = await consumeFirstAccessLink(token, password);
    if (!result.ok) return NextResponse.json({ error: errorMessage(result.reason) }, { status: statusCode(result.reason) });
    return NextResponse.json({ ok: true, email: result.email, username: result.username });
  },
);
