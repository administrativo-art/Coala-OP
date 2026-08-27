import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import {
  evaluateProfileCompliance,
  PROFILE_COMPLIANCE_POLICY_VERSION,
  profileReviewCycle,
  type ProfileComplianceFormValues,
} from "@/features/hr/profile-compliance";
import { evaluateUserProfileCompliance } from "@/features/hr/profile-compliance.server";
import { resolvePersonLink } from "@/features/hr/lib/person-link.server";
import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const compliance = await evaluateUserProfileCompliance(actor.decoded.uid);
    return NextResponse.json(compliance, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao verificar cadastro obrigatório." },
      { status: 400 },
    );
  }
}

function cleanText(value: unknown, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeBody(value: unknown): ProfileComplianceFormValues {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    birthDate: cleanText(body.birthDate, 10),
    accessEmail: "",
    mobilePhone: cleanText(body.mobilePhone, 30),
    pixKeyType: cleanText(body.pixKeyType, 20).toLowerCase(),
    pixKey: cleanText(body.pixKey, 150),
    addressZipcode: cleanText(body.addressZipcode, 12),
    addressStreet: cleanText(body.addressStreet),
    addressNumber: cleanText(body.addressNumber, 30),
    addressNoNumber: body.addressNoNumber === true,
    addressNeighborhood: cleanText(body.addressNeighborhood),
    addressCity: cleanText(body.addressCity, 120),
    addressState: cleanText(body.addressState, 2).toUpperCase(),
    emergencyName: cleanText(body.emergencyName),
    emergencyRelation: cleanText(body.emergencyRelation, 80),
    emergencyPhone: cleanText(body.emergencyPhone, 30),
  };
}

function asFieldValues(values: ProfileComplianceFormValues) {
  return {
    "employee.birth_date": { value_date: values.birthDate },
    "employee.phone": { value_text: values.mobilePhone },
    "employee.pix_key_type": { value_text: values.pixKeyType },
    "employee.pix_key": { value_text: values.pixKey },
    "employee.address_zipcode": { value_text: values.addressZipcode },
    "employee.address_street": { value_text: values.addressStreet },
    "employee.address_number": { value_text: values.addressNumber },
    "employee.address_no_number": { value_boolean: values.addressNoNumber },
    "employee.address_neighborhood": { value_text: values.addressNeighborhood },
    "employee.city": { value_text: values.addressCity },
    "employee.state": { value_text: values.addressState },
    "employee.emergency_name": { value_text: values.emergencyName },
    "employee.emergency_relation": { value_text: values.emergencyRelation },
    "employee.emergency_phone": { value_text: values.emergencyPhone },
  };
}

function fieldValueDocument(fieldKey: string, value: unknown, actorId: string, now: Timestamp) {
  const base = { field_key: fieldKey, updated_at: now, updated_by: actorId };
  if (fieldKey === "employee.birth_date") {
    return {
      ...base,
      value_date: Timestamp.fromDate(new Date(`${String(value)}T12:00:00.000Z`)),
    };
  }
  if (fieldKey === "employee.address_no_number") return { ...base, value_boolean: value === true };
  return { ...base, value_text: String(value ?? "") };
}

function comparableStoredValue(data: Record<string, unknown> | undefined) {
  if (!data) return "";
  if (typeof data.value_boolean === "boolean") return String(data.value_boolean);
  if (typeof data.value_text === "string") return data.value_text.trim();
  const dateValue = data.value_date as { toDate?: unknown } | undefined;
  if (dateValue && typeof dateValue.toDate === "function") {
    return (dateValue.toDate as () => Date)().toISOString().slice(0, 10);
  }
  return "";
}

function comparableSubmittedValue(entry: Record<string, unknown>) {
  if (typeof entry.value_boolean === "boolean") return String(entry.value_boolean);
  if (typeof entry.value_date === "string") return entry.value_date;
  return typeof entry.value_text === "string" ? entry.value_text.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const values = normalizeBody(await request.json().catch(() => ({})));
    values.accessEmail = cleanText(actor.userDoc.email, 320).toLowerCase();

    const validation = evaluateProfileCompliance({
      user: {
        email: values.accessEmail,
        phone: values.mobilePhone,
        birthDate: values.birthDate,
      },
      fieldValues: asFieldValues(values),
      reviewDue: false,
    });
    if (!validation.complete) {
      return NextResponse.json(
        { error: "Revise os campos obrigatórios antes de confirmar.", validation },
        { status: 422 },
      );
    }

    const link = await resolvePersonLink(actor.decoded.uid);
    if (!link.employeeDocument?.exists) {
      return NextResponse.json({ error: "Cadastro pessoal não vinculado ao RH." }, { status: 409 });
    }

    const now = Timestamp.now();
    const nowIso = now.toDate().toISOString();
    const cycle = profileReviewCycle(now.toDate());
    const employeeData = link.employeeDocument.data() ?? {};
    const rhRole = actor.isDefaultAdmin || actor.permissions.settings?.manageUsers === true
      ? "admin"
      : actor.permissions.dp?.collaborators?.edit === true || actor.permissions.dp?.collaborators?.view === true
        ? "manager"
        : "employee";
    const fields = asFieldValues(values);
    const currentSnaps = await Promise.all(
      Object.keys(fields).map((key) => link.employeeDocument!.ref.collection("field_values").doc(key).get()),
    );
    const changedFields = currentSnaps
      .filter((snapshot) => comparableStoredValue(snapshot.data()) !== comparableSubmittedValue(fields[snapshot.id as keyof typeof fields]))
      .map((snapshot) => snapshot.id);

    const hrBatch = hrDbAdmin.batch();
    for (const [fieldKey, entry] of Object.entries(fields)) {
      const rawValue = "value_boolean" in entry ? entry.value_boolean : "value_date" in entry ? entry.value_date : entry.value_text;
      hrBatch.set(
        link.employeeDocument.ref.collection("field_values").doc(fieldKey),
        fieldValueDocument(fieldKey, rawValue, actor.decoded.uid, now),
        { merge: true },
      );
    }
    hrBatch.set(hrDbAdmin.collection("profile_review_events").doc(), {
      user_id: actor.decoded.uid,
      employee_id: link.employeeDocument.id,
      policy_version: PROFILE_COMPLIANCE_POLICY_VERSION,
      cycle_started_at: cycle.currentStart.toISOString(),
      confirmed_at: now,
      changed_fields: changedFields,
      source: "mandatory_profile_gate",
    });
    hrBatch.set(hrDbAdmin.collection("rh_access_cache").doc(actor.decoded.uid), {
      auth_uid: actor.decoded.uid,
      bizneo_employee_id: link.employeeDocument.id,
      rh_role: rhRole,
      ...(typeof employeeData.unit_id === "string" && employeeData.unit_id ? { unit_id: employeeData.unit_id } : {}),
      ...(actor.userDoc.jobRoleId ? { job_role_id: actor.userDoc.jobRoleId } : {}),
      ...(actor.userDoc.jobFunctionIds?.length ? { job_function_ids: actor.userDoc.jobFunctionIds } : {}),
      profile_compliance_status: "complete",
      profile_compliance_policy_version: PROFILE_COMPLIANCE_POLICY_VERSION,
      profile_compliance_next_review_at: Timestamp.fromDate(cycle.nextStart),
      profile_compliance_updated_at: now,
      updated_at: now,
    }, { merge: true });
    await hrBatch.commit();

    const existing = actor.userDoc.profileCompliance;
    await dbAdmin.collection("users").doc(actor.decoded.uid).set({
      phone: values.mobilePhone,
      birthDate: values.birthDate,
      profileCompliance: {
        status: "complete",
        policyVersion: PROFILE_COMPLIANCE_POLICY_VERSION,
        missingFields: [],
        invalidFields: [],
        evaluatedAt: nowIso,
        completedAt: existing?.completedAt ?? nowIso,
        lastConfirmedAt: nowIso,
        nextReviewAt: Timestamp.fromDate(cycle.nextStart),
      },
      updatedAt: nowIso,
    }, { merge: true });

    const compliance = await evaluateUserProfileCompliance(actor.decoded.uid, now.toDate());
    return NextResponse.json(compliance, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao confirmar cadastro obrigatório." },
      { status: 400 },
    );
  }
}
