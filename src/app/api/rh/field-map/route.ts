import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { requireUser } from "@/lib/auth-server";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { DEFAULT_COMPLEMENTARY_FIELDS, DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";
import type { FieldMapEntry, ProfileBlockConfig } from "@/types/rh";

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

function cleanEntry(entry: FieldMapEntry): FieldMapEntry {
  const clean: FieldMapEntry = {
    bizneo_id: entry.bizneo_id || "coala_internal",
    label: entry.label,
    section: entry.section,
    type: entry.type,
    visibility: entry.visibility,
    employee_visible: entry.employee_visible === true,
    employee_editable: entry.employee_editable === true,
    order: Number.isFinite(entry.order) ? entry.order : 0,
  };
  if (entry.required !== undefined) clean.required = entry.required === true;
  if (entry.help_text) clean.help_text = entry.help_text;
  if (entry.options?.length) clean.options = entry.options.filter(Boolean);
  if (entry.lgpd) {
    clean.lgpd = {
      category: entry.lgpd.category,
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

function canConfigureRhFields(actor: Awaited<ReturnType<typeof requireUser>>) {
  return Boolean(
    actor.isDefaultAdmin ||
      actor.permissions.settings?.manageUsers === true ||
      actor.permissions.dp?.collaborators?.edit === true
  );
}

async function loadOrCreateFieldMap(actor: Awaited<ReturnType<typeof requireUser>>) {
  const ref = hrDbAdmin.collection("schema").doc("field_map");
  const snap = await ref.get();
  if (snap.exists) {
    const current = snap.data() ?? {};
    const currentFields =
      current.fields && typeof current.fields === "object"
        ? current.fields as Record<string, FieldMapEntry>
        : {};
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
          const changed =
            nextEntry.group !== currentEntry.group ||
            nextEntry.subgroup !== currentEntry.subgroup ||
            nextEntry.repeatable !== currentEntry.repeatable ||
            nextEntry.conditionals !== currentEntry.conditionals;
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

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    if (!canConfigureRhFields(actor)) {
      return NextResponse.json({ error: "Sem permissão para configurar campos." }, { status: 403 });
    }

    const { snap } = await loadOrCreateFieldMap(actor);
    const data = snap.data() ?? {};
    return NextResponse.json({
      fieldMap: {
        version: data.version ?? "coala-rh-v1.3",
        fields: data.fields ?? {},
        section_order: data.section_order ?? {},
        profile_blocks: data.profile_blocks ?? DEFAULT_PROFILE_BLOCKS,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar campos.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    if (!canConfigureRhFields(actor)) {
      return NextResponse.json({ error: "Sem permissão para configurar campos." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const fields = body?.fields;
    const profileBlocks = body?.profile_blocks;
    const sectionOrder = cleanSectionOrder(body?.section_order);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ error: "fields inválido." }, { status: 400 });
    }

    const ref = hrDbAdmin.collection("schema").doc("field_map");
    const currentSnap = await ref.get();
    const currentFields = (currentSnap.data()?.fields ?? {}) as Record<string, FieldMapEntry>;
    const nextFields = Object.fromEntries(
      Object.entries(fields as Record<string, FieldMapEntry>).map(([key, entry]) => [key, cleanEntry(entry)])
    ) as Record<string, FieldMapEntry>;
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
}
