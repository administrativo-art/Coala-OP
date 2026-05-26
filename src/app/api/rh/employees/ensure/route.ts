import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import type { User } from "@/types";
import { DEFAULT_COMPLEMENTARY_FIELDS } from "@/features/rh/lib/default-field-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toTimestamp(value: unknown): Timestamp | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const date = (value as { toDate?: () => Date }).toDate?.();
    return date && !Number.isNaN(date.getTime()) ? Timestamp.fromDate(date) : null;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

async function ensureFieldMap() {
  const fieldMapRef = hrDbAdmin.collection("schema").doc("field_map");
  const fieldMapSnap = await fieldMapRef.get();
  const current = fieldMapSnap.exists ? fieldMapSnap.data() : null;
  const currentFields =
    current?.fields && typeof current.fields === "object"
      ? current.fields as Record<string, unknown>
      : {};
  const missingEntries = Object.entries(DEFAULT_COMPLEMENTARY_FIELDS)
    .filter(([key]) => currentFields[key] == null);

  if (!fieldMapSnap.exists) {
    await fieldMapRef.set({
      version: "coala-rh-v1.3",
      source: "coala_internal",
      fields: DEFAULT_COMPLEMENTARY_FIELDS,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    });
    return;
  }

  if (missingEntries.length === 0) return;

  await fieldMapRef.set(
    {
      version: current?.version ?? "coala-rh-v1.3",
      source: current?.source ?? "coala_internal",
      fields: Object.fromEntries(missingEntries),
      updated_at: Timestamp.now(),
    },
    { merge: true },
  );
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const canViewCollaborators =
      actor.isDefaultAdmin ||
      actor.permissions.dp?.collaborators?.view === true ||
      actor.permissions.dp?.collaborators?.edit === true;

    if (!canViewCollaborators) {
      return NextResponse.json({ error: "Sem permissão para carregar campos do colaborador." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const userId = asString(body?.userId);
    if (!userId) {
      return NextResponse.json({ error: "userId é obrigatório." }, { status: 400 });
    }

    const userSnap = await dbAdmin.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
    }

    const user = { id: userSnap.id, ...(userSnap.data() as Omit<User, "id">) } as User;
    const employeeId = asString(user.registrationIdBizneo) ?? user.id;
    const unitIds = user.unitIds ?? user.assignedKioskIds ?? [];
    const unitId = unitIds[0] ?? "sem-unidade";
    const now = Timestamp.now();
    await ensureFieldMap();

    const employeeRef = hrDbAdmin.collection("employees").doc(employeeId);
    const employeeSnap = await employeeRef.get();
    const actorUnitIds = actor.userDoc.unitIds ?? actor.userDoc.assignedKioskIds ?? [];
    const actorRhRole =
      actor.isDefaultAdmin ||
      actor.permissions.settings?.manageUsers === true ||
      actor.permissions.dp?.collaborators?.edit === true
        ? "admin"
        : "manager";

    await employeeRef.set(
      {
        bizneo_employee_id: employeeId,
        auth_uid: user.id,
        source_user_id: user.id,
        source: user.registrationIdBizneo ? "bizneo_or_manual" : "manual",
        name: user.username ?? user.email ?? employeeId,
        email: user.email ?? "",
        status: user.isActive === false ? "terminated" : "active",
        job_role_id: user.jobRoleId ?? user.profileId ?? "",
        unit_id: unitId,
        profile_completion: employeeSnap.exists ? employeeSnap.data()?.profile_completion ?? 0 : 0,
        synced_at: now,
        ...(employeeSnap.exists ? {} : { created_at: now }),
      },
      { merge: true },
    );

    const batch = hrDbAdmin.batch();
    const fieldValuesRef = employeeRef.collection("field_values");
    const directValues: Record<string, Record<string, unknown>> = {
      "employee.name": { value_text: user.username ?? user.email ?? "" },
      "employee.personal_email": { value_text: user.email ?? "" },
      "employee.job_role_id": { value_text: user.jobRoleName ?? user.jobRoleId ?? "" },
    };

    const birthDate = toTimestamp(user.birthDate);
    if (birthDate) directValues["employee.birth_date"] = { value_date: birthDate };

    const admissionDate = toTimestamp(user.admissionDate);
    if (admissionDate) directValues["employee.aso_admission_date"] = { value_date: admissionDate };

    for (const [fieldKey, value] of Object.entries(directValues)) {
      batch.set(
        fieldValuesRef.doc(fieldKey),
        {
          field_key: fieldKey,
          ...value,
          updated_at: now,
          updated_by: actor.userDoc.id,
          source: "coala_user_shadow",
        },
        { merge: true },
      );
    }

    await batch.commit();

    await hrDbAdmin.collection("rh_access_cache").doc(actor.decoded.uid).set(
      {
        auth_uid: actor.decoded.uid,
        rh_role: actorRhRole,
        bizneo_employee_id: actor.userDoc.registrationIdBizneo ?? actor.userDoc.id,
        unit_id: actorUnitIds[0] ?? unitId,
        updated_at: now,
        source: "coala_dp_collaborator_detail",
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, employeeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao preparar perfil RH.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
