import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  deletePdvLegalUser,
  fetchPdvLegalFiliais,
  fetchPdvLegalProfiles,
  updatePdvLegalUserAccess,
} from "@/lib/integrations/pdv-legal-admin";
import type { UserPdvAccess } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function userAccesses(user: Record<string, unknown>): UserPdvAccess[] {
  const stored = Array.isArray(user.pdvAccesses)
    ? user.pdvAccesses.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        const externalUserId = clean(row.externalUserId);
        const filialId = clean(row.filialId);
        const profileId = clean(row.profileId);
        if (!externalUserId || !filialId || !profileId) return [];
        return [{
          externalUserId,
          unitId: clean(row.unitId),
          unitName: clean(row.unitName),
          filialId,
          filialName: clean(row.filialName),
          profileId,
          profileName: clean(row.profileName),
          status: row.status === "inactive" || row.status === "error" ? row.status : "active",
          updatedAt: clean(row.updatedAt),
        } satisfies UserPdvAccess];
      })
    : [];
  if (stored.length > 0) return stored;

  const legacyId = clean(user.registrationIdPdv);
  const filialId = clean(user.pdvAccessFilialId);
  const profileId = clean(user.pdvAccessProfileId);
  if (!legacyId || !filialId || !profileId) return [];
  return [{
    externalUserId: legacyId,
    filialId,
    filialName: clean(user.pdvAccessFilialName),
    profileId,
    profileName: clean(user.pdvAccessProfileName),
    status: "active",
  }];
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao gerenciar o acesso do PDV Legal.";
  return NextResponse.json({ error: message }, { status: /permissão|autenticad/i.test(message) ? 403 : 400 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await assertHrAccess(request, "manage");
    const { userId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const accessId = clean(body.accessId);
    const unitId = clean(body.unitId);
    const filialId = clean(body.filialId);
    const profileId = clean(body.profileId);
    if (!accessId || !unitId || !filialId || !profileId) throw new Error("Informe o acesso, a unidade e o perfil do PDV.");

    const [userSnap, unitSnap, profiles, filiais] = await Promise.all([
      dbAdmin.collection("users").doc(userId).get(),
      dbAdmin.collection("dp_units").doc(unitId).get(),
      fetchPdvLegalProfiles(),
      fetchPdvLegalFiliais(),
    ]);
    if (!userSnap.exists) throw new Error("Colaborador não encontrado.");
    if (!unitSnap.exists || unitSnap.data()?.isArchived === true) throw new Error("Unidade do Coala One não encontrada.");
    if (clean(unitSnap.data()?.pdvFilialId) !== filialId) throw new Error("A unidade escolhida não está vinculada a essa filial do PDV.");

    const profile = profiles.find((item) => item.id === profileId);
    const filial = filiais.find((item) => item.id === filialId);
    if (!profile || !filial) throw new Error("Filial ou perfil não localizado no catálogo atual do PDV Legal.");

    const user = userSnap.data() ?? {};
    const accesses = userAccesses(user);
    const current = accesses.find((entry) => entry.externalUserId === accessId && entry.status === "active");
    if (!current) throw new Error("Acesso ativo do PDV não localizado no colaborador.");

    await updatePdvLegalUserAccess({ userId: accessId, filialId, profileId });
    const now = new Date().toISOString();
    const nextAccesses = accesses.map((entry) => entry.externalUserId === accessId ? {
      ...entry,
      unitId,
      unitName: clean(unitSnap.data()?.name),
      filialId,
      filialName: filial.name,
      profileId,
      profileName: profile.name,
      status: "active" as const,
      updatedAt: now,
    } : entry);
    await Promise.all([
      userSnap.ref.set({
        registrationIdPdv: accessId,
        pdvAccessProfileId: profileId,
        pdvAccessProfileName: profile.name,
        pdvAccessFilialId: filialId,
        pdvAccessFilialName: filial.name,
        pdvAccesses: nextAccesses,
        updatedAt: now,
      }, { merge: true }),
      userSnap.ref.collection("systemAccessAudit").add({
        action: "pdv_access_updated",
        externalUserId: accessId,
        from: current,
        to: nextAccesses.find((entry) => entry.externalUserId === accessId),
        actorId: actor.decoded.uid,
        actorName: actor.actorName,
        at: Timestamp.now(),
      }),
    ]);
    return NextResponse.json({ ok: true, accesses: nextAccesses });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await assertHrAccess(request, "manage");
    const { userId } = await params;
    const accessId = clean(request.nextUrl.searchParams.get("accessId"));
    if (!accessId) throw new Error("Informe o código do acesso que será removido.");

    const userSnap = await dbAdmin.collection("users").doc(userId).get();
    if (!userSnap.exists) throw new Error("Colaborador não encontrado.");
    const user = userSnap.data() ?? {};
    const accesses = userAccesses(user);
    const current = accesses.find((entry) => entry.externalUserId === accessId && entry.status === "active");
    if (!current) throw new Error("Acesso ativo do PDV não localizado no colaborador.");

    await deletePdvLegalUser(accessId);
    const now = new Date().toISOString();
    const nextAccesses = accesses.map((entry) => entry.externalUserId === accessId
      ? { ...entry, status: "inactive" as const, updatedAt: now }
      : entry);
    const remaining = nextAccesses.find((entry) => entry.status === "active") ?? null;
    await Promise.all([
      userSnap.ref.set({
        registrationIdPdv: remaining?.externalUserId ?? null,
        pdvAccessProfileId: remaining?.profileId ?? null,
        pdvAccessProfileName: remaining?.profileName ?? null,
        pdvAccessFilialId: remaining?.filialId ?? null,
        pdvAccessFilialName: remaining?.filialName ?? null,
        pdvAccesses: nextAccesses,
        updatedAt: now,
      }, { merge: true }),
      userSnap.ref.collection("systemAccessAudit").add({
        action: "pdv_access_removed",
        externalUserId: accessId,
        access: current,
        actorId: actor.decoded.uid,
        actorName: actor.actorName,
        at: Timestamp.now(),
      }),
    ]);
    return NextResponse.json({ ok: true, accesses: nextAccesses });
  } catch (error) {
    return errorResponse(error);
  }
}
