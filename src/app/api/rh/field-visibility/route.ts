import { Timestamp } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { systemFieldsRepresentedByProfileBlocks, defaultFieldLgpd } from "@/features/hr/lib/collaborator-system-fields";
import { DEFAULT_COMPLEMENTARY_FIELDS, DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";
import { canConfigureFieldVisibility, FIELD_VISIBILITY_LEVELS } from "@/features/rh/lib/field-visibility";
import { RETIRED_FIELD_KEYS, withoutRetiredFields } from "@/features/rh/lib/retired-field-keys";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { buildActionLogRecord } from "@/lib/log-action";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { normalizeFieldVisibility, type FieldMapEntry, type NormalizedFieldVisibility, type ProfileBlockConfig } from "@/types/rh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StaticRouteContext = { params: Promise<Record<string, never>> };
type Actor = Awaited<ReturnType<typeof requireUser>>;
type WorkspaceResource = { workspaceId: string };

const MAX_CHANGES_PER_REQUEST = 500;

const updateInputSchema = z
  .object({
    changes: z
      .record(z.string().min(1).max(200), z.enum(FIELD_VISIBILITY_LEVELS as [NormalizedFieldVisibility, ...NormalizedFieldVisibility[]]))
      .refine((value) => Object.keys(value).length > 0, "Nenhuma alteração informada.")
      .refine((value) => Object.keys(value).length <= MAX_CHANGES_PER_REQUEST, "Alterações demais em uma única gravação."),
  })
  .strict();

const readContract = defineSecurityContract({
  schemaVersion: 1,
  id: "rh.field-visibility.read",
  version: 1,
  surface: { method: "GET", path: "/api/rh/field-visibility" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "rh.fields.visibility.configure" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const updateContract = defineSecurityContract({
  schemaVersion: 1,
  id: "rh.field-visibility.update",
  version: 1,
  surface: { method: "PATCH", path: "/api/rh/field-visibility" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "rh.fields.visibility.configure" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "rh-field-visibility-update", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" },
  errorExposure: "sanitized",
});

function authenticate(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw new AppError({ code: "RH_FIELD_VISIBILITY_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", safeMessage: "Autenticação necessária.", cause, reportable: false });
  });
}

function authorize(actor: Actor) {
  if (!canConfigureFieldVisibility(actor)) {
    throw new AppError({ code: "RH_FIELD_VISIBILITY_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para configurar a visibilidade dos campos.", reportable: false });
  }
}

function assertWorkspace(actor: Actor, resource: WorkspaceResource) {
  if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) {
    throw new AppError({ code: "RH_FIELD_VISIBILITY_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
  }
}

const readEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, Actor, undefined, WorkspaceResource>(readContract, {
  authenticate: ({ request }) => authenticate(request),
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => authorize(actor),
  assertScope: ({ actor, resource }) => assertWorkspace(actor, resource),
});

const updateEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, Actor, z.infer<typeof updateInputSchema>, WorkspaceResource>(updateContract, {
  authenticate: ({ request }) => authenticate(request),
  async parseInput({ request }) {
    const parsed = updateInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "RH_FIELD_VISIBILITY_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Alterações de visibilidade inválidas.", reportable: false });
    }
    return parsed.data;
  },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => authorize(actor),
  assertScope: ({ actor, resource }) => assertWorkspace(actor, resource),
});

/** Campos cuja visibilidade esta tela pode configurar: fora os aposentados e os cobertos por blocos do sistema. */
function configurableFields(data: FirebaseFirestore.DocumentData | undefined) {
  const fields = withoutRetiredFields((data?.fields ?? {}) as Record<string, FieldMapEntry>);
  const blocks = (data?.profile_blocks ?? DEFAULT_PROFILE_BLOCKS) as Record<string, ProfileBlockConfig>;
  const represented = systemFieldsRepresentedByProfileBlocks(Object.keys(blocks));
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !represented.has(key))) as Record<string, FieldMapEntry>;
}

export const GET = secureRoute({ contract: readContract, enforcer: readEnforcer }, async () => {
  const snap = await hrDbAdmin.collection("schema").doc("field_map").get();
  const data = snap.exists ? snap.data() : { fields: DEFAULT_COMPLEMENTARY_FIELDS, profile_blocks: DEFAULT_PROFILE_BLOCKS };
  const fields = configurableFields(data);
  return NextResponse.json({
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, entry]) => [
        key,
        { label: entry.label, section: entry.section || "Sem seção", order: entry.order ?? 0, visibility: normalizeFieldVisibility(entry.visibility) },
      ]),
    ),
    section_order: data?.section_order ?? {},
  });
});

export const PATCH = secureRoute({ contract: updateContract, enforcer: updateEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const ref = hrDbAdmin.collection("schema").doc("field_map");

  const applied = await hrDbAdmin.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new AppError({ code: "RH_FIELD_VISIBILITY_MAP_MISSING", kind: "CONFLICT", safeMessage: "O catálogo de campos ainda não foi criado. Abra Campos do perfil antes de configurar a visibilidade.", reportable: false });
    }
    const current = configurableFields(snap.data());
    const applied: Array<{ key: string; from: NormalizedFieldVisibility; to: NormalizedFieldVisibility }> = [];
    const patch: Record<string, { visibility: NormalizedFieldVisibility; lgpd: NonNullable<FieldMapEntry["lgpd"]> }> = {};

    for (const [key, to] of Object.entries(input.changes)) {
      const entry = current[key];
      if (!entry || RETIRED_FIELD_KEYS.has(key)) {
        throw new AppError({ code: "RH_FIELD_VISIBILITY_FIELD_UNKNOWN", kind: "VALIDATION", safeMessage: "Um dos campos informados não existe ou não pode ser configurado aqui.", reportable: false });
      }
      const from = normalizeFieldVisibility(entry.visibility);
      if (from === to) continue;
      const fallbackLgpd = defaultFieldLgpd(entry.section, to);
      patch[key] = { visibility: to, lgpd: { ...fallbackLgpd, ...(entry.lgpd ?? {}), category: entry.lgpd?.category ?? fallbackLgpd.category } };
      applied.push({ key, from, to });
    }

    if (applied.length === 0) return applied;
    // `set` com merge trata a chave do campo como nome, não como caminho: chaves como "employee.cpf" têm pontos.
    transaction.set(ref, { fields: patch, updated_at: Timestamp.now(), updated_by: actor.userDoc.id }, { merge: true });
    return applied;
  });

  if (applied.length > 0) {
    // O catálogo e os logs ficam em bancos diferentes: a auditoria é gravada depois do commit e uma falha dela não desfaz a mudança.
    try {
      await dbAdmin.collection("actionLogs").add(
        buildActionLogRecord({
          workspace_id: resource.workspaceId,
          user_id: actor.userDoc.id,
          username: actor.userDoc.username,
          module: "rh.field-visibility",
          action: "field_visibility_changed",
          metadata: { target_type: "field_map", changed: applied.length, changes: applied.slice(0, 100) },
          ttl_days: 365,
          trust_source: "server-authoritative",
          event_namespace: "rh",
        }),
      );
    } catch {
      /* auditoria complementar; a falha não pode substituir o resultado da gravação */
    }
  }

  return NextResponse.json({ ok: true, changed: applied.length });
});
