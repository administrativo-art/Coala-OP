import { createHash, randomBytes } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { EMAIL_SENDERS, sendEmail } from "@/lib/email/resend";
import { renderFirstAccessEmail } from "@/lib/email/first-access-template";
import { createFirstAccessLink } from "@/lib/first-access-links";
import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { isEmploymentRelationshipType } from "@/lib/hr/employment-relationship";
import { canDelegateUnitAccess } from "@/lib/unit-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_URL = "https://op.coalashakes.com";
const USER_DATA_FIELDS = new Set([
  "assignedKioskIds",
  "avatarUrl",
  "color",
  "operacional",
  "participatesInGoals",
  "pdvOperatorIds",
  "shiftDefinitionId",
  "needsTransportVoucher",
  "transportVoucherValue",
  "transportVoucherHistory",
  "registrationIdBizneo",
  "registrationIdPdv",
  "jobRoleId",
  "jobRoleName",
  "jobFunctionIds",
  "jobFunctionNames",
  "employmentRelationshipType",
  "responsibleUnitIds",
  "unitIds",
  "unitAccessScope",
  "unitAccessUnitIds",
  "admissionDate",
  "birthDate",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, max = 320) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeEmail(value: unknown) {
  return text(value).toLowerCase();
}

function personRecordType(userData: Record<string, unknown>) {
  const role = text(userData.jobRoleName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (role.includes("diretor") || role.includes("presidente") || role.includes("vice-presidente")) return "director";
  if (userData.employmentRelationshipType === "pj") return "pj";
  if (userData.employmentRelationshipType === "internship") return "internship";
  return "employee";
}

function dateTimestamp(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Timestamp.fromDate(new Date(`${value}T12:00:00`));
  }
  const source = record(value);
  const seconds = Number(source.seconds ?? source._seconds);
  const nanoseconds = Number(source.nanoseconds ?? source._nanoseconds ?? 0);
  if (Number.isFinite(seconds)) return new Timestamp(seconds, Number.isFinite(nanoseconds) ? nanoseconds : 0);
  return undefined;
}

function cleanUserData(value: unknown) {
  const source = record(value);
  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!USER_DATA_FIELDS.has(key) || entry === undefined) continue;
    cleaned[key] = entry;
  }
  const admissionDate = dateTimestamp(source.admissionDate);
  const birthDate = dateTimestamp(source.birthDate);
  if (admissionDate) cleaned.admissionDate = admissionDate;
  else delete cleaned.admissionDate;
  if (birthDate) cleaned.birthDate = birthDate;
  else delete cleaned.birthDate;
  return cleaned;
}

function appBaseUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;
  return request.nextUrl.origin || SYSTEM_URL;
}

function emailHash(email: string) {
  return createHash("sha256").update(email).digest("hex");
}

export async function POST(request: NextRequest) {
  let createdUserId: string | null = null;
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && actor.permissions.settings.manageUsers !== true) {
      return NextResponse.json({ error: "Sem permissão para criar usuários." }, { status: 403 });
    }

    const body = record(await request.json().catch(() => null));
    const email = normalizeEmail(body.email);
    const username = text(body.username, 180);
    const profileId = text(body.profileId, 160);
    if (!email || !email.includes("@") || username.length < 3 || !profileId) {
      return NextResponse.json({ error: "Informe nome, e-mail e perfil válidos." }, { status: 400 });
    }
    const rawUserData = record(body.userData);
    if (!isEmploymentRelationshipType(rawUserData.employmentRelationshipType)) {
      return NextResponse.json({ error: "Selecione o tipo de vínculo: CLT, PJ ou Estágio." }, { status: 400 });
    }
    if (!canDelegateUnitAccess(actor.userDoc, rawUserData, { isDefaultAdmin: actor.isDefaultAdmin })) {
      return NextResponse.json(
        { error: "O escopo do novo usuário não pode ultrapassar o seu próprio escopo de unidades." },
        { status: 403 },
      );
    }

    const profileSnapshot = await dbAdmin.collection("profiles").doc(profileId).get();
    if (!profileSnapshot.exists) {
      return NextResponse.json({ error: "Perfil de permissão não encontrado." }, { status: 400 });
    }
    const isDefaultAdmin = profileSnapshot.get("isDefaultAdmin") === true;
    if (isDefaultAdmin && !actor.isDefaultAdmin) {
      return NextResponse.json({ error: "Somente o administrador padrão pode atribuir esse perfil." }, { status: 403 });
    }

    try {
      await authAdmin.getUserByEmail(email);
      return NextResponse.json({ error: "Já existe um usuário com este e-mail." }, { status: 409 });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code !== "auth/user-not-found") throw error;
    }

    const authUser = await authAdmin.createUser({
      email,
      password: randomBytes(48).toString("base64url"),
      displayName: username,
      emailVerified: false,
      disabled: false,
    });
    createdUserId = authUser.uid;
    await authAdmin.setCustomUserClaims(authUser.uid, { profileId, isDefaultAdmin });

    const userData = cleanUserData(rawUserData);
    const hrEmployeeId = authUser.uid;
    const normalizedPersonRecordType = personRecordType(userData);
    await dbAdmin.collection("users").doc(authUser.uid).set({
      ...userData,
      hrEmployeeId,
      personRecordType: normalizedPersonRecordType,
      profileCompliance: {
        status: "pending",
        policyVersion: 1,
        missingFields: [],
        invalidFields: [],
        evaluatedAt: null,
        completedAt: null,
        lastConfirmedAt: null,
        nextReviewAt: null,
      },
      email,
      username,
      profileId,
      assignedKioskIds: Array.isArray(userData.assignedKioskIds) ? userData.assignedKioskIds : [],
      unitAccessScope: userData.unitAccessScope === "all" || userData.unitAccessScope === "selected"
        ? userData.unitAccessScope
        : "linked",
      unitAccessUnitIds: userData.unitAccessScope === "selected" && Array.isArray(userData.unitAccessUnitIds)
        ? userData.unitAccessUnitIds
        : [],
      avatarUrl: text(userData.avatarUrl, 2000),
      operacional: userData.operacional === true,
      isActive: true,
      mustChangePassword: true,
      source: "manual_user_creation",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actor.decoded.uid,
      createdByEmail: actor.decoded.email ?? null,
    });

    const nowTimestamp = Timestamp.now();
    const unitIds = Array.isArray(userData.unitIds)
      ? userData.unitIds.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
      : Array.isArray(userData.assignedKioskIds)
        ? userData.assignedKioskIds.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
        : [];
    await hrDbAdmin.collection("employees").doc(hrEmployeeId).set({
      bizneo_employee_id: hrEmployeeId,
      auth_uid: authUser.uid,
      source_user_id: authUser.uid,
      source: "manual_user_creation",
      name: username,
      email,
      access_email: email,
      person_record_type: normalizedPersonRecordType,
      status: "active",
      job_role_id: text(userData.jobRoleId) || profileId,
      unit_id: unitIds[0] ?? "sem-unidade",
      profile_completion: 0,
      synced_at: nowTimestamp,
      created_at: nowTimestamp,
      updated_at: nowTimestamp,
    }, { merge: true });

    const firstAccess = await createFirstAccessLink({
      userId: authUser.uid,
      baseUrl: appBaseUrl(request),
      createdBy: actor.decoded.uid,
      createdByEmail: actor.decoded.email ?? null,
    });

    const subject = "Defina sua senha de acesso ao Coala One";
    let emailSent = false;
    let providerId: string | null = null;
    let emailError: string | null = null;
    try {
      const result = await sendEmail({
        from: EMAIL_SENDERS.access,
        to: email,
        subject,
        html: renderFirstAccessEmail({
          userName: username,
          actionUrl: firstAccess.url,
        }),
        text: `Seu acesso ao Coala One foi criado\n\nOlá, ${username}. Use este link individual para definir sua senha: ${firstAccess.url}\n\nO link expira em 7 dias.\n\nEssa é uma mensagem automática, não responda este e-mail.`,
      });
      emailSent = true;
      providerId = result.id;
    } catch (error) {
      emailError = error instanceof Error ? error.message : "Falha no envio do e-mail.";
      console.error("[users.create] Cadastro criado, mas o primeiro acesso não foi enviado.", error);
    }

    const now = new Date().toISOString();
    await dbAdmin.collection("emailCommunications").doc(`user_first_access_${authUser.uid}_${firstAccess.tokenId}`).set({
      event: "user_first_access",
      userId: authUser.uid,
      recipientHash: emailHash(email),
      sender: EMAIL_SENDERS.access,
      subject,
      status: emailSent ? "accepted" : "failed",
      providerId,
      lastError: emailError,
      acceptedAt: emailSent ? now : null,
      createdAt: now,
      createdBy: actor.decoded.uid,
    }).catch((error) => {
      console.error("[users.create] Falha ao registrar auditoria do e-mail de primeiro acesso.", error);
    });

    return NextResponse.json({
      uid: authUser.uid,
      emailSent,
      firstAccessExpiresAt: firstAccess.expiresAt,
      ...(emailError ? { warning: "O cadastro foi criado, mas o e-mail de primeiro acesso não pôde ser enviado." } : {}),
    });
  } catch (error) {
    if (createdUserId) {
      await Promise.allSettled([
        authAdmin.deleteUser(createdUserId),
        dbAdmin.collection("users").doc(createdUserId).delete(),
        hrDbAdmin.collection("employees").doc(createdUserId).delete(),
      ]);
    }
    const message = error instanceof Error ? error.message : "Falha ao criar usuário.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
