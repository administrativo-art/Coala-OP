import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { updateProvisionSeriesAmount } from "@/features/financial/provision-series-amount.server";
import { requireUser } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<Record<string, never>> };
type Actor = Awaited<ReturnType<typeof requireUser>>;

const schema = z.object({
  seriesKey: z.string().trim().min(10).max(180),
  customerAccount: z.string().regex(/^\d{5,20}$/),
  serviceNumber: z.string().trim().min(10).max(24),
  fromCompetence: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  expectedAmountCents: z.number().int().positive().max(1_000_000_000),
  newAmountCents: z.number().int().positive().max(1_000_000_000),
  dryRun: z.boolean().optional(),
}).strict().refine((input) => input.seriesKey.endsWith(`:${input.customerAccount}`)
  && input.expectedAmountCents !== input.newAmountCents, "Série e valores inválidos.");

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "financial.expenses.provision-series-amount.update",
  version: 1,
  surface: { method: "PATCH", path: "/api/financial/expenses/provision-series" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "financial.expenses.edit" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "financial.provision-series-amount", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, Actor, z.infer<typeof schema>, { workspaceId: string }>({
  id: "financial-provision-series-amount-update-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "PROVISION_SERIES_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
    });
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.expenses?.edit)) {
      throw new AppError({ code: "PROVISION_SERIES_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para ajustar provisões." });
    }
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "PROVISION_SERIES_INVALID", kind: "VALIDATION", safeMessage: "Revise a série e os valores informados.", cause: parsed.error });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await updateProvisionSeriesAmount({
    ...security.input,
    workspaceId: security.resource.workspaceId,
    actorId: security.actor.decoded.uid,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
