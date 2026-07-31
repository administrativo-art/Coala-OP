import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { requireUser } from "@/lib/auth-server";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { DEFAULT_COMPLEMENTARY_FIELDS, DEFAULT_PROFILE_BLOCKS } from "@/features/rh/lib/default-field-map";
import type { Employee, EmployeeFieldValue, FieldMap, RhAccessCache, RhRole } from "@/types/rh";
import { canViewField } from "@/types/rh";
import { refreshProbationProcess, type ProbationProcessState } from "@/features/hr/integration/probation-process";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import { resolvePersonLink } from "@/features/hr/lib/person-link.server";
import { isOwnHrEmployeeId } from "@/lib/hr/person-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETIRED_PROFILE_FIELD_KEYS = new Set([
  "employee.dependent_name",
  "employee.dependent_relation",
  "employee.dependent_cpf",
  "employee.dependent_rg",
  "employee.family_salary_end_1",
  "employee.family_salary_birth_1",
  "employee.family_salary_name_1",
  "employee.bank_name",
  "employee.bank_agency",
  "employee.bank_account",
]);

function withoutRetiredFields(fields: Record<string, FieldMap["fields"][string]>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !RETIRED_PROFILE_FIELD_KEYS.has(key))
  ) as FieldMap["fields"];
}

function canReadRhProfile(actor: Awaited<ReturnType<typeof requireUser>>, employeeId: string) {
  const isOwnerTarget = isOwnHrEmployeeId(actor.userDoc, employeeId);
  if (actor.permissions.dp?.collaborators?.ownProfileOnly === true) {
    return Boolean(actor.isDefaultAdmin || actor.permissions.settings?.manageUsers === true || isOwnerTarget);
  }
  return Boolean(
    actor.isDefaultAdmin ||
      actor.permissions.settings?.manageUsers === true ||
      actor.permissions.dp?.collaborators?.view === true ||
      actor.permissions.dp?.collaborators?.edit === true ||
      isOwnerTarget
  );
}

function inferRole(actor: Awaited<ReturnType<typeof requireUser>>, employee?: Employee): RhRole {
  if (actor.isDefaultAdmin || actor.permissions.settings?.manageUsers === true) return "admin";
  if (
    actor.permissions.dp?.collaborators?.ownProfileOnly === true &&
    (employee?.auth_uid === actor.userDoc.id || isOwnHrEmployeeId(actor.userDoc, employee?.bizneo_employee_id))
  ) {
    return "employee";
  }
  if (actor.permissions.dp?.collaborators?.view === true || actor.permissions.dp?.collaborators?.edit === true) return "manager";
  if (employee?.auth_uid === actor.userDoc.id || isOwnHrEmployeeId(actor.userDoc, employee?.bizneo_employee_id)) return "employee";
  return "employee";
}

async function loadFieldMap(actor: Awaited<ReturnType<typeof requireUser>>): Promise<FieldMap> {
  const snap = await hrDbAdmin.collection("schema").doc("field_map").get();
  const data = snap.data() ?? {};
  return {
    version: data.version ?? "coala-rh-v1.3",
    fields: withoutRetiredFields({
      ...DEFAULT_COMPLEMENTARY_FIELDS,
      ...(data.fields ?? {}),
    }),
    section_order: data.section_order ?? {},
    profile_blocks: {
      ...DEFAULT_PROFILE_BLOCKS,
      ...(data.profile_blocks ?? {}),
    },
    access_matrix: data.access_matrix,
    updated_at: data.updated_at,
    updated_by: data.updated_by ?? actor.userDoc.id,
  } as FieldMap;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> },
) {
  try {
    const actor = await requireUser(request);
    const { employeeId } = await context.params;
    const normalizedEmployeeId = decodeURIComponent(employeeId ?? "").trim();

    if (!normalizedEmployeeId) {
      return NextResponse.json({ error: "Colaborador obrigatório." }, { status: 400 });
    }
    if (!canReadRhProfile(actor, normalizedEmployeeId)) {
      return NextResponse.json({ error: "Sem permissão para visualizar perfil RH." }, { status: 403 });
    }
    await assertEmployeeUnitAccess(actor, normalizedEmployeeId);

    const fieldMap = await loadFieldMap(actor);
    const personLink = await resolvePersonLink(normalizedEmployeeId);
    const employeeSnap = personLink.employeeDocument;
    if (!employeeSnap?.exists) {
      return NextResponse.json({ error: "Colaborador não encontrado no RH." }, { status: 404 });
    }

    const linkedUser = personLink.userDocument?.data() ?? {};
    const accessEmail = typeof linkedUser.email === "string" ? linkedUser.email.trim().toLowerCase() : "";
    const employee = {
      ...(employeeSnap.data() as Employee),
      ...(accessEmail ? { email: accessEmail, access_email: accessEmail } : {}),
    };
    const resolvedEmployeeId = employeeSnap.id;
    let imageVoiceConsent = employee.consentimento_imagem_voz ?? null;
    let privacyAcknowledgement = employee.ciencia_privacidade_onboarding ?? null;
    let onboardingSnap = await hrDbAdmin
      .collection("onboardingProcesses")
      .where("employeeId", "==", resolvedEmployeeId)
      .limit(1)
      .get();
    const employeeEmail = typeof employee.email === "string" ? employee.email.trim().toLowerCase() : "";
    if (onboardingSnap.empty && employeeEmail) {
      onboardingSnap = await hrDbAdmin
        .collection("onboardingProcesses")
        .where("candidateEmail", "==", employeeEmail)
        .limit(1)
        .get();
    }
    const onboarding = onboardingSnap.empty ? null : onboardingSnap.docs[0].data();
    const onboardingId = onboardingSnap.empty ? null : onboardingSnap.docs[0].id;
    imageVoiceConsent ??= onboarding?.consentimento_imagem_voz ?? null;
    privacyAcknowledgement ??= onboarding?.publicPrivacyAcceptance
      ? { ...onboarding.publicPrivacyAcceptance, onboarding_id: onboardingId }
      : null;
    const probation = onboarding?.probationV2
      ? refreshProbationProcess(
          onboarding.probationV2 as ProbationProcessState,
          new Date().toISOString().slice(0, 10),
        )
      : null;
    const role = inferRole(actor, employee);
    const cache: RhAccessCache = {
      auth_uid: actor.userDoc.id,
      bizneo_employee_id: employee.bizneo_employee_id ?? resolvedEmployeeId,
      rh_role: role,
      unit_id: employee.unit_id,
      // Admin SDK Timestamp reconciliado com o tipo declarado (client Timestamp).
      updated_at: Timestamp.now() as unknown as RhAccessCache["updated_at"],
    };
    const visibilityContext = {
      isOwner: employee.auth_uid === actor.userDoc.id || isOwnHrEmployeeId(actor.userDoc, resolvedEmployeeId),
      canViewConfidential: role === "admin",
      userId: actor.userDoc.id,
      roleIds: actor.userDoc.jobRoleId ? [actor.userDoc.jobRoleId] : [],
      functionIds: (actor.userDoc.jobFunctionIds ?? []).filter(Boolean),
    };

    const readableKeys = Object.entries(fieldMap.fields)
      .filter(([, entry]) => canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix))
      .map(([key]) => key);

    const fieldValueSnaps = await Promise.all(
      readableKeys.map((key) => employeeSnap.ref.collection("field_values").doc(key).get()),
    );
    const fieldValues = Object.fromEntries(
      fieldValueSnaps
        .filter((snap) => snap.exists)
        .map((snap) => [snap.id, snap.data() as EmployeeFieldValue]),
    );
    if (accessEmail && readableKeys.includes("employee.personal_email")) {
      fieldValues["employee.personal_email"] = {
        field_key: "employee.personal_email",
        value_text: accessEmail,
        updated_at: Timestamp.now() as unknown as EmployeeFieldValue["updated_at"],
        updated_by: "system:access-account",
      };
    }

    return NextResponse.json(
      {
        employee,
        fieldValues,
        fieldMap,
        cache,
        consentimento_imagem_voz: imageVoiceConsent,
        ciencia_privacidade_onboarding: privacyAcknowledgement,
        periodo_experiencia: probation,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar perfil RH." },
      { status: 400 },
    );
  }
}
