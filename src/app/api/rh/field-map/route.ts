import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { requireUser } from "@/lib/auth-server";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { DEFAULT_COMPLEMENTARY_FIELDS } from "@/features/rh/lib/default-field-map";
import type { FieldMapEntry } from "@/types/rh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (entry.conditionals?.length) clean.conditionals = entry.conditionals;
  return clean;
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
    return { ref, snap };
  }

  const fields = Object.fromEntries(
    Object.entries(DEFAULT_COMPLEMENTARY_FIELDS).map(([key, entry]) => [key, cleanEntry(entry)])
  );

  await ref.set({
    version: "coala-rh-v1.3",
    source: "coala_internal",
    fields,
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
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ error: "fields inválido." }, { status: 400 });
    }

    const ref = hrDbAdmin.collection("schema").doc("field_map");
    const currentSnap = await ref.get();
    const currentFields = (currentSnap.data()?.fields ?? {}) as Record<string, FieldMapEntry>;
    const nextFields = Object.fromEntries(
      Object.entries(fields as Record<string, FieldMapEntry>).map(([key, entry]) => [key, cleanEntry(entry)])
    ) as Record<string, FieldMapEntry>;

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
