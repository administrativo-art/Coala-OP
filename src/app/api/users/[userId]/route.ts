import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";

const MANAGE_USERS_ONLY_FIELDS = new Set([
  "profileId",
  "isActive",
  "inactivationType",
  "terminationReason",
  "terminationCause",
  "terminationNotes",
  "terminationDate",
]);

const DEFAULT_ADMIN_ONLY_FIELDS = new Set([
  "isDefaultAdmin",
]);

const SERVER_ONLY_FIELDS = new Set([
  "id",
  "email",
  "lastLoginAt",
  "passwordChangedAt",
  "createdAt",
  "updatedAt",
]);

function cleanPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanPayload);
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, cleanPayload(entry)])
    );
  }

  return value;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const actor = await requireUser(request);
    const { userId } = await context.params;
    const rawPayload = await request.json();

    if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const canManageUsers = actor.isDefaultAdmin || actor.permissions.settings.manageUsers;
    const canManageDp =
      actor.permissions.dp?.collaborators?.edit === true ||
      actor.permissions.dp?.collaborators?.terminate === true;

    if (!canManageUsers && !canManageDp) {
      return NextResponse.json({ error: "Sem permissão para editar usuário." }, { status: 403 });
    }

    const payload = cleanPayload(rawPayload) as Record<string, unknown>;
    for (const field of SERVER_ONLY_FIELDS) {
      delete payload[field];
    }

    const restrictedFields = Object.keys(payload).filter((field) =>
      MANAGE_USERS_ONLY_FIELDS.has(field)
    );
    const defaultAdminOnlyFields = Object.keys(payload).filter((field) =>
      DEFAULT_ADMIN_ONLY_FIELDS.has(field)
    );

    if (defaultAdminOnlyFields.length > 0 && !actor.isDefaultAdmin) {
      return NextResponse.json(
        { error: "Somente o administrador padrão pode alterar privilégios administrativos." },
        { status: 403 }
      );
    }

    if (restrictedFields.length > 0 && !canManageUsers) {
      return NextResponse.json(
        { error: "Sem permissão para alterar acesso, perfil ou desligamento." },
        { status: 403 }
      );
    }

    if (
      !actor.isDefaultAdmin &&
      typeof payload.profileId === "string" &&
      payload.profileId.trim()
    ) {
      if (userId === actor.decoded.uid) {
        return NextResponse.json(
          { error: "Somente o administrador padrão pode alterar o próprio perfil de acesso." },
          { status: 403 }
        );
      }
      const targetProfile = await dbAdmin
        .collection("profiles")
        .doc(payload.profileId.trim())
        .get();
      if (!targetProfile.exists) {
        return NextResponse.json({ error: "Perfil não encontrado." }, { status: 400 });
      }
      if (targetProfile.data()?.isDefaultAdmin === true) {
        return NextResponse.json(
          { error: "Somente o administrador padrão pode atribuir o perfil administrativo." },
          { status: 403 }
        );
      }
    }

    await dbAdmin.collection("users").doc(userId).set(payload, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar usuário.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
