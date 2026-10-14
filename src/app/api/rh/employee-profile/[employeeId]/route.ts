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
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

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

type RouteContext = { params: Promise<{ employeeId: string }> };
type ProfileResource = { employeeId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "rh.employee-profile.read",
  version: 1,
  surface: { method: "GET", path: "/api/rh/employee-profile/[employeeId]" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "rh-profile-read" },
  resourceScope: { kind: "custom", strategy: "employee-profile" },
  input: { kind: "schema", schema: "rh-employee-profile-route", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, Awaited<ReturnType<typeof requireUser>>, { employeeId: string }, ProfileResource>({
  id: "rh-employee-profile-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:rh-profile-read", "scope:employee-profile", "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: "RH_PROFILE_AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", safeMessage: "Autenticação necessária.", cause, reportable: false });
    });
    const params = await routeContext.params;
    const employeeId = decodeURIComponent(params.employeeId ?? "").trim();
    if (!employeeId || employeeId.length > 250) {
      throw new AppError({ code: "RH_PROFILE_EMPLOYEE_ID_INVALID", kind: "VALIDATION", safeMessage: "Colaborador obrigatório.", reportable: false });
    }
    if (!canReadRhProfile(actor, employeeId)) {
      throw new AppError({ code: "RH_PROFILE_READ_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para visualizar perfil RH.", reportable: false });
    }
    await assertEmployeeUnitAccess(actor, employeeId).catch((cause) => {
      throw new AppError({ code: "RH_PROFILE_UNIT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem acesso à unidade deste colaborador.", cause, reportable: false });
    });
    return { actor, input: { employeeId }, resource: { employeeId } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  try {
    const actor = security.actor;
    const normalizedEmployeeId = security.resource.employeeId;

    const [fieldMap, personLink] = await Promise.all([
      loadFieldMap(actor),
      resolvePersonLink(normalizedEmployeeId),
    ]);
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
    const employeeEmail = typeof employee.email === "string" ? employee.email.trim().toLowerCase() : "";
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

    // As fontes independentes são carregadas juntas para evitar uma cascata de consultas.
    const fieldValueRefs = readableKeys.map((key) => employeeSnap.ref.collection("field_values").doc(key));
    const onboardingByEmployeePromise = hrDbAdmin
      .collection("onboardingProcesses")
      .where("employeeId", "==", resolvedEmployeeId)
      .limit(1)
      .get();
    const onboardingByEmailPromise = employeeEmail
      ? hrDbAdmin
          .collection("onboardingProcesses")
          .where("candidateEmail", "==", employeeEmail)
          .limit(1)
          .get()
      : Promise.resolve(null);
    const fieldValuesPromise = fieldValueRefs.length > 0
      ? hrDbAdmin.getAll(...fieldValueRefs)
      : Promise.resolve([]);
    const changeRequestsPromise = hrDbAdmin
      .collection("hrProfileUpdateRequests")
      .where("employeeId", "==", resolvedEmployeeId)
      .limit(100)
      .get();
    const [onboardingByEmployee, onboardingByEmail, fieldValueSnaps, changeRequestSnapshot] = await Promise.all([
      onboardingByEmployeePromise,
      onboardingByEmailPromise,
      fieldValuesPromise,
      changeRequestsPromise,
    ]);

    const onboardingSnap = !onboardingByEmployee.empty ? onboardingByEmployee : onboardingByEmail;
    const onboarding = onboardingSnap && !onboardingSnap.empty ? onboardingSnap.docs[0].data() : null;
    const onboardingId = onboardingSnap && !onboardingSnap.empty ? onboardingSnap.docs[0].id : null;
    let imageVoiceConsent = employee.consentimento_imagem_voz ?? null;
    let privacyAcknowledgement = employee.ciencia_privacidade_onboarding ?? null;
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
    const changeRequests = changeRequestSnapshot.docs
      .filter((document) => (
        document.get("type") === "self_service_profile_update"
        && document.get("status") === "pending_approval"
        && readableKeys.includes(String(document.get("fieldKey") ?? ""))
      ))
      .map((document) => {
        const value = document.data();
        const requestedAt = value.requestedAt;
        return {
          id: document.id,
          status: "pending_approval" as const,
          employeeId: resolvedEmployeeId,
          fieldKey: String(value.fieldKey ?? ""),
          fieldLabel: String(value.fieldLabel ?? value.fieldKey ?? "Campo"),
          oldValue: value.oldValue ?? null,
          proposedValue: value.proposedValue ?? null,
          requestedBy: String(value.requestedBy ?? ""),
          requestedAt: typeof requestedAt?.toDate === "function" ? requestedAt.toDate().toISOString() : String(requestedAt ?? ""),
        };
      })
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));

    return NextResponse.json(
      {
        employee,
        fieldValues,
        fieldMap,
        cache,
        consentimento_imagem_voz: imageVoiceConsent,
        ciencia_privacidade_onboarding: privacyAcknowledgement,
        periodo_experiencia: probation,
        changeRequests,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar perfil RH." },
      { status: 400 },
    );
  }
});
