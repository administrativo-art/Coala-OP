import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { collectPersonSource, preparePersonInventory } from "@/features/privacy/person-inventory.server";
import { type SubjectRef } from "@/features/privacy/person-subject";
import { type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { authenticatePrivacyUser, requirePrivacyView } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<Record<string, never>> };
const schema = z.object({
  namespace: z.enum(["main.users", "hr.employees", "hr.candidates", "hr.onboardingPersons"]), id: z.string().trim().min(1).max(180).refine((id) => !id.includes("/")),
  source: z.string().trim().max(80).optional(), cursor: z.string().max(600).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
type Input = z.infer<typeof schema>;
const contract = defineSecurityContract({ schemaVersion: 1, id: "privacy.person-inventory.read", version: 1,
  surface: { method: "GET", path: "/api/privacy/person-inventory" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "privacy.request.view" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "privacy.person-inventory.query", unknownFields: "reject" },
  effects: { mode: "write", audit: "none" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, Input, { workspaceId: string }>(contract, {
  authenticate: ({ request }) => authenticatePrivacyUser(request),
  parseInput({ request }) {
    const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "PERSON_INVENTORY_QUERY_INVALID", kind: "VALIDATION" });
    return parsed.data;
  },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => requirePrivacyView(actor),
  assertScope: ({ actor, resource }) => { if (resource.workspaceId !== actor.workspace_id) throw new AppError({ code: "PERSON_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" }); },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { input, actor } = security;
  const ref: SubjectRef = { namespace: input.namespace, id: input.id };
  if (!input.source) {
    if (input.cursor) throw new AppError({ code: "PERSON_CURSOR_INVALID", kind: "VALIDATION" });
    const prepared = await preparePersonInventory(actor, ref);
    return NextResponse.json({ ref, equivalents: prepared.resolution.refs, conflicts: prepared.resolution.conflicts,
      sources: prepared.sources });
  }
  return NextResponse.json(await collectPersonSource({ actor, sourceId: input.source, ref, limit: input.limit, cursor: input.cursor }));
});
