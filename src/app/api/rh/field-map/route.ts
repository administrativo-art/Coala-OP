import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { requireUser } from "@/lib/auth-server";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { canConfigureFieldVisibility } from "@/features/rh/lib/field-visibility";
import { withoutRetiredFields } from "@/features/rh/lib/retired-field-keys";
import { DEFAULT_COMPLEMENTARY_FIELDS, DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";
import {
  DEFAULT_PROFILE_ACCESS_MATRIX,
  normalizeFieldVisibility,
  normalizeProfileAccessMatrix,
  normalizeProfileAccessPermission,
  type FieldAccessBinding,
  type FieldMapEntry,
  type ProfileAccessActor,
  type ProfileAccessMatrix,
  type ProfileBlockConfig,
} from "@/types/rh";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanConditionals(conditionals: FieldMapEntry["conditionals"]) {
  return (conditionals ?? [])
    .filter((rule) => rule && typeof rule.field === "string" && typeof rule.kind === "string")
    .map((rule) => ({
      kind: rule.kind,
      field: rule.field,
      operator: rule.operator,
      ...(rule.value !== undefined ? { value: rule.value } : {}),
    })) as FieldMapEntry["conditionals"];
}

function cleanRepeatable(repeatable: FieldMapEntry["repeatable"]) {
  if (!repeatable) return undefined;
  return {
    enabled: repeatable.enabled === true,
    ...(repeatable.add_label ? { add_label: repeatable.add_label } : {}),
    ...(repeatable.item_label ? { item_label: repeatable.item_label } : {}),
    ...(Number.isFinite(repeatable.max_items) ? { max_items: repeatable.max_items } : {}),
  };
}

function cleanGroup(group: FieldMapEntry["group"]) {
  if (!group?.id || !group.label) return undefined;
  const conditionals = cleanConditionals(group.conditionals);
  const repeatable = cleanRepeatable(group.repeatable);
  return {
    id: group.id,
    label: group.label,
    ...(Number.isFinite(group.order) ? { order: group.order } : {}),
    ...(conditionals?.length ? { conditionals } : {}),
    ...(repeatable ? { repeatable } : {}),
  };
}

function cleanSubgroup(subgroup: FieldMapEntry["subgroup"]) {
  if (!subgroup?.id || !subgroup.label) return undefined;
  const conditionals = cleanConditionals(subgroup.conditionals);
  return {
    id: subgroup.id,
    label: subgroup.label,
    ...(Number.isFinite(subgroup.order) ? { order: subgroup.order } : {}),
    ...(subgroup.group_id ? { group_id: subgroup.group_id } : {}),
    ...(conditionals?.length ? { conditionals } : {}),
  };
}

function cleanAccessList(values: unknown) {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

function cleanAccessBinding(binding: FieldAccessBinding | undefined) {
  if (!binding || typeof binding !== "object") return undefined;

  const roleIds = cleanAccessList(binding.roleIds);
  const functionIds = cleanAccessList(binding.functionIds);
  const userIds = cleanAccessList(binding.userIds);

  if (roleIds.length === 0 && functionIds.length === 0 && userIds.length === 0) {
    return undefined;
  }

  return {
    ...(roleIds.length ? { roleIds } : {}),
    ...(functionIds.length ? { functionIds } : {}),
    ...(userIds.length ? { userIds } : {}),
  };
}

function cleanAccess(access: FieldMapEntry["access"]) {
  const allowed = cleanAccessBinding(access?.allowed);
  return allowed ? { allowed } : undefined;
}

function cleanEntry(entry: FieldMapEntry): FieldMapEntry {
  const selfServicePolicy = ['inherit', 'blocked', 'direct', 'approval'].includes(String(entry.self_service_policy))
    ? entry.self_service_policy
    : undefined;
  const clean: FieldMapEntry = {
    bizneo_id: entry.bizneo_id || "coala_internal",
    label: entry.label,
    section: entry.section,
    type: entry.type,
    visibility: entry.visibility,
    employee_visible: entry.employee_visible === true,
    employee_editable: entry.employee_editable === true,
    ...(selfServicePolicy ? { self_service_policy: selfServicePolicy } : {}),
    order: Number.isFinite(entry.order) ? entry.order : 0,
  };
  if (entry.required !== undefined) clean.required = entry.required === true;
  if (entry.help_text) clean.help_text = entry.help_text;
  if (entry.options?.length) clean.options = entry.options.filter(Boolean);
  if (entry.lgpd) {
    clean.lgpd = {
      // Valores legados "confidential" pertencem à dimensão de acesso,
      // não à natureza do dado definida pela LGPD.
      category: entry.lgpd.category === "sensitive" ? "sensitive" : "personal",
      legal_basis: entry.lgpd.legal_basis,
      retention: entry.lgpd.retention,
      requires_consent: entry.lgpd.requires_consent === true,
    };
  }
  if (entry.triggers?.length) clean.triggers = entry.triggers;
  if (entry.validation?.length) clean.validation = entry.validation;
  const conditionals = cleanConditionals(entry.conditionals);
  if (conditionals?.length) clean.conditionals = conditionals;
  const group = cleanGroup(entry.group);
  if (group) clean.group = group;
  const subgroup = cleanSubgroup(entry.subgroup);
  if (subgroup) clean.subgroup = subgroup;
  const repeatable = cleanRepeatable(entry.repeatable);
  if (repeatable) clean.repeatable = repeatable;
  const access = cleanAccess(entry.access);
  if (access) clean.access = access;
  return clean;
}

function cleanProfileBlock(block: ProfileBlockConfig): ProfileBlockConfig {
  return {
    id: block.id,
    label: block.label,
    order: Number.isFinite(block.order) ? block.order : 0,
    employee_visible: block.employee_visible === true,
    employee_editable: block.employee_editable === true,
    ...(block.locked !== undefined ? { locked: block.locked === true } : {}),
  };
}

function cleanSectionOrder(sectionOrder: unknown) {
  if (!sectionOrder || typeof sectionOrder !== "object" || Array.isArray(sectionOrder)) return {};
  return Object.fromEntries(
    Object.entries(sectionOrder as Record<string, unknown>)
      .filter(([section, order]) => section.trim() && Number.isFinite(Number(order)))
      .map(([section, order]) => [section, Number(order)])
  );
}

function cleanAccessMatrix(matrix: unknown): ProfileAccessMatrix {
  const normalized = normalizeProfileAccessMatrix(
    matrix && typeof matrix === "object" && !Array.isArray(matrix)
      ? matrix as ProfileAccessMatrix
      : DEFAULT_PROFILE_ACCESS_MATRIX,
  );
  const actors: ProfileAccessActor[] = ["authenticated", "owner", "manager", "admin", "explicit"];
  return {
    version: normalized.version || DEFAULT_PROFILE_ACCESS_MATRIX.version,
    visibility: Object.fromEntries(
      (["public", "restricted_partial", "restricted_total", "confidential"] as const).map((visibility) => {
        const bindings = cleanAccessBinding(normalized.visibility[visibility]?.bindings);
        return [
          normalizeFieldVisibility(visibility),
          {
            ...Object.fromEntries(
              actors.map((actor) => [
                actor,
                normalizeProfileAccessPermission(normalized.visibility[visibility]?.[actor]),
              ]),
            ),
            ...(bindings ? { bindings } : {}),
          },
        ];
      }),
    ) as ProfileAccessMatrix["visibility"],
  };
}

function canConfigureRhFields(actor: Awaited<ReturnType<typeof requireUser>>) {
  return Boolean(
    actor.isDefaultAdmin ||
      actor.permissions.settings?.manageUsers === true ||
      actor.permissions.dp?.collaborators?.edit === true
  );
}

const DEPENDENTS_FAMILY_SECTION = "Salário-família";
const DEPENDENTS_FAMILY_SECTION_MIGRATIONS: Record<string, string[]> = {
  "employee.children_under_14": ["Dados pessoais"],
  "employee.children": ["Dependentes", "Dependentes e salário-família", "Salário-família", "Salario Familia"],
  "employee.dependent_name": ["Dependentes"],
  "employee.dependent_relation": ["Dependentes"],
  "employee.dependent_cpf": ["Dependentes"],
  "employee.dependent_rg": ["Dependentes"],
  "employee.has_family_salary": ["Salário-família", "Salario Familia"],
  "employee.family_salary_end_1": ["Salário-família", "Salario Familia"],
  "employee.family_salary_birth_1": ["Salário-família", "Salario Familia"],
  "employee.family_salary_name_1": ["Salário-família", "Salario Familia"],
};

async function loadOrCreateFieldMap(actor: Awaited<ReturnType<typeof requireUser>>) {
  const ref = hrDbAdmin.collection("schema").doc("field_map");
  const snap = await ref.get();
  if (snap.exists) {
    const current = snap.data() ?? {};
    const currentFields = withoutRetiredFields(
      current.fields && typeof current.fields === "object"
        ? current.fields as Record<string, FieldMapEntry>
        : {}
    );
    const currentBlocks =
      current.profile_blocks && typeof current.profile_blocks === "object"
        ? current.profile_blocks as Record<string, ProfileBlockConfig>
        : {};
    const defaultUpdates = Object.fromEntries(
      Object.entries(DEFAULT_COMPLEMENTARY_FIELDS)
        .map(([key, defaultEntry]) => {
          const currentEntry = currentFields[key];
          if (!currentEntry) return [key, cleanEntry(defaultEntry)] as const;
          const nextEntry: FieldMapEntry = { ...currentEntry };
          if (!nextEntry.group && defaultEntry.group) nextEntry.group = defaultEntry.group;
          if (!nextEntry.subgroup && defaultEntry.subgroup) nextEntry.subgroup = defaultEntry.subgroup;
          if (!nextEntry.repeatable && defaultEntry.repeatable) nextEntry.repeatable = defaultEntry.repeatable;
          if ((!nextEntry.conditionals || nextEntry.conditionals.length === 0) && defaultEntry.conditionals?.length) {
            nextEntry.conditionals = defaultEntry.conditionals;
          }
          if (
            DEPENDENTS_FAMILY_SECTION_MIGRATIONS[key]?.includes(String(nextEntry.section ?? "").trim())
          ) {
            nextEntry.section = DEPENDENTS_FAMILY_SECTION;
            nextEntry.order = defaultEntry.order;
          }
          const changed =
            nextEntry.group !== currentEntry.group ||
            nextEntry.subgroup !== currentEntry.subgroup ||
            nextEntry.repeatable !== currentEntry.repeatable ||
            nextEntry.conditionals !== currentEntry.conditionals ||
            nextEntry.section !== currentEntry.section ||
            nextEntry.order !== currentEntry.order;
          return changed ? [key, cleanEntry(nextEntry)] as const : null;
        })
        .filter((entry): entry is readonly [string, FieldMapEntry] => entry !== null)
    );
    const blockUpdates = Object.fromEntries(
      Object.entries(DEFAULT_PROFILE_BLOCKS)
        .filter(([key]) => !currentBlocks[key])
        .map(([key, block]) => [key, cleanProfileBlock(block)])
    );

    if (Object.keys(defaultUpdates).length > 0 || Object.keys(blockUpdates).length > 0) {
      await ref.set(
        {
          version: current.version ?? "coala-rh-v1.3",
          source: current.source ?? "coala_internal",
          ...(Object.keys(defaultUpdates).length > 0 ? { fields: defaultUpdates } : {}),
          ...(Object.keys(blockUpdates).length > 0 ? { profile_blocks: blockUpdates } : {}),
          updated_at: Timestamp.now(),
          updated_by: actor.userDoc.id,
        },
        { merge: true },
      );
      return { ref, snap: await ref.get() };
    }

    return { ref, snap };
  }

  const fields = Object.fromEntries(
    Object.entries(DEFAULT_COMPLEMENTARY_FIELDS).map(([key, entry]) => [key, cleanEntry(entry)])
  );

  await ref.set({
    version: "coala-rh-v1.3",
    source: "coala_internal",
    fields,
    profile_blocks: DEFAULT_PROFILE_BLOCKS,
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
    updated_by: actor.userDoc.id,
  });

  return { ref, snap: await ref.get() };
}

type StaticRouteContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

const updateInputSchema = z.object({
  version: z.string().trim().max(120).optional(),
  fields: z.record(z.string(), z.unknown()),
  profile_blocks: z.record(z.string(), z.unknown()).optional(),
  section_order: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  access_matrix: z.unknown().optional(),
}).strict();

const getContract = defineSecurityContract({
  schemaVersion: 1,
  id: "rh.field-map.read",
  version: 1,
  surface: { method: "GET", path: "/api/rh/field-map" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "rh.fields.configure" },
  resourceScope: { kind: "workspace" },
  input: { kind: "none" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

const putContract = defineSecurityContract({
  schemaVersion: 1,
  id: "rh.field-map.update",
  version: 1,
  surface: { method: "PUT", path: "/api/rh/field-map" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "rh.fields.configure" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "rh-field-map-update", unknownFields: "reject" },
  effects: { mode: "write", audit: "none" },
  errorExposure: "sanitized",
});

async function authenticateFieldMapUser(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw new AppError({ code: "RH_FIELD_MAP_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", safeMessage: "Autenticação necessária.", cause, reportable: false });
  });
}

function authorizeFieldMapUser(actor: Awaited<ReturnType<typeof requireUser>>) {
  if (!canConfigureRhFields(actor)) {
    throw new AppError({ code: "RH_FIELD_MAP_CONFIGURE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para configurar campos.", reportable: false });
  }
}

function assertFieldMapWorkspace(actor: Awaited<ReturnType<typeof requireUser>>, resource: WorkspaceResource) {
  if (!resource.workspaceId || resource.workspaceId !== actor.workspace_id) {
    throw new AppError({ code: "RH_FIELD_MAP_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
  }
}

const getEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, Awaited<ReturnType<typeof requireUser>>, undefined, WorkspaceResource>(getContract, {
  authenticate: ({ request }) => authenticateFieldMapUser(request),
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => authorizeFieldMapUser(actor),
  assertScope: ({ actor, resource }) => assertFieldMapWorkspace(actor, resource),
});

const putEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, Awaited<ReturnType<typeof requireUser>>, z.infer<typeof updateInputSchema>, WorkspaceResource>(putContract, {
  authenticate: ({ request }) => authenticateFieldMapUser(request),
  async parseInput({ request }) {
    const parsed = updateInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: "RH_FIELD_MAP_INPUT_INVALID", kind: "VALIDATION", safeMessage: parsed.error.issues[0]?.message ?? "Configuração de campos inválida.", reportable: false });
    return parsed.data;
  },
  loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
  authorize: ({ actor }) => authorizeFieldMapUser(actor),
  assertScope: ({ actor, resource }) => assertFieldMapWorkspace(actor, resource),
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  try {
    const actor = security.actor;

    const { snap } = await loadOrCreateFieldMap(actor);
    const data = snap.data() ?? {};
    return NextResponse.json({
      fieldMap: {
        version: data.version ?? "coala-rh-v1.3",
        fields: withoutRetiredFields((data.fields ?? {}) as Record<string, FieldMapEntry>),
        section_order: data.section_order ?? {},
        profile_blocks: data.profile_blocks ?? DEFAULT_PROFILE_BLOCKS,
        access_matrix: cleanAccessMatrix(data.access_matrix),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar campos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});

export const PUT = secureRoute({ contract: putContract, enforcer: putEnforcer }, async ({ security }) => {
  try {
    const actor = security.actor;
    const body = security.input;
    const fields = body?.fields;
    const profileBlocks = body?.profile_blocks;
    const sectionOrder = cleanSectionOrder(body?.section_order);
    const accessMatrix = cleanAccessMatrix(body?.access_matrix);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ error: "fields inválido." }, { status: 400 });
    }

    const ref = hrDbAdmin.collection("schema").doc("field_map");
    const currentSnap = await ref.get();
    const currentFields = (currentSnap.data()?.fields ?? {}) as Record<string, FieldMapEntry>;
    const nextFields = Object.fromEntries(
      Object.entries(withoutRetiredFields(fields as Record<string, FieldMapEntry>)).map(([key, entry]) => [key, cleanEntry(entry)])
    ) as Record<string, FieldMapEntry>;
    if (!canConfigureFieldVisibility(actor)) {
      const changedVisibility = Object.entries(nextFields).some(([key, next]) => {
        const previous = currentFields[key];
        return Boolean(previous) && normalizeFieldVisibility(previous.visibility) !== normalizeFieldVisibility(next.visibility);
      });
      if (changedVisibility) {
        return NextResponse.json({ error: "Sem permissão para alterar a visibilidade dos campos." }, { status: 403 });
      }
    }
    const currentBlocks = (currentSnap.data()?.profile_blocks ?? DEFAULT_PROFILE_BLOCKS) as Record<string, ProfileBlockConfig>;
    const nextProfileBlocks = profileBlocks && typeof profileBlocks === "object" && !Array.isArray(profileBlocks)
      ? Object.fromEntries(
          Object.entries(profileBlocks as Record<string, ProfileBlockConfig>).map(([key, block]) => [key, cleanProfileBlock({ ...block, id: block.id || key })])
        ) as Record<string, ProfileBlockConfig>
      : currentBlocks;

    for (const [key, next] of Object.entries(nextFields)) {
      const previous = currentFields[key];
      if (!previous || previous.type === next.type) continue;
      const existingValue = await hrDbAdmin
        .collectionGroup("field_values")
        .where("field_key", "==", key)
        .limit(1)
        .get();
      if (!existingValue.empty) {
        return NextResponse.json(
          { error: `Não é possível alterar o tipo de "${next.label}" porque já existem valores salvos.` },
          { status: 400 },
        );
      }
    }

    await ref.set(
      {
        version: body?.version || currentSnap.data()?.version || "coala-rh-v1.3",
        source: "coala_internal",
        fields: nextFields,
        section_order: sectionOrder,
        profile_blocks: nextProfileBlocks,
        access_matrix: accessMatrix,
        updated_at: Timestamp.now(),
        updated_by: actor.userDoc.id,
        ...(currentSnap.exists ? {} : { created_at: Timestamp.now() }),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, fieldCount: Object.keys(nextFields).length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar campos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
