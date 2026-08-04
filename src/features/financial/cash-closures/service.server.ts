import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import {
  fetchAllCouponsForDay,
  fetchPdvLegalUsers,
  getAccessToken,
} from "@/lib/integrations/pdv-legal-admin";
import { buildCashClosureFromPdv } from "./build-cash-closure";
import { recordCashClosureSyncError, upsertClosureFromPdv } from "./repository.server";
import type { CashClosureActor } from "./types";

async function resolveKiosk(kioskId: string) {
  const [kioskSnapshot, unitSnapshot] = await Promise.all([
    dbAdmin.collection("kiosks").doc(kioskId).get(),
    dbAdmin.collection("dp_units").doc(kioskId).get(),
  ]);
  const snapshot = kioskSnapshot.exists ? kioskSnapshot : unitSnapshot;
  if (!snapshot.exists) throw new Error("Unidade não encontrada.");
  const data = snapshot.data() ?? {};
  const pdvFilialId = resolvePdvFilialId({
    id: snapshot.id,
    pdvFilialId: typeof data.pdvFilialId === "string" ? data.pdvFilialId : null,
  });
  if (!pdvFilialId) throw new Error("A unidade não possui filial do PDV Legal configurada.");
  return {
    id: snapshot.id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : snapshot.id,
    pdvFilialId,
  };
}

export async function syncCashClosure(input: {
  workspaceId: string;
  kioskId: string;
  date: string;
  actor: CashClosureActor;
}) {
  const kiosk = await resolveKiosk(input.kioskId);
  try {
    const token = await getAccessToken();
    const [coupons, users] = await Promise.all([
      fetchAllCouponsForDay(token, input.date, kiosk.pdvFilialId),
      fetchPdvLegalUsers(),
    ]);
    const operatorNameById = Object.fromEntries(users.map((user) => [user.id, user.name]));
    const built = buildCashClosureFromPdv(coupons, {
      workspaceId: input.workspaceId,
      kioskId: kiosk.id,
      kioskName: kiosk.name,
      pdvFilialId: kiosk.pdvFilialId,
      date: input.date,
      operatorNameById,
    });
    return upsertClosureFromPdv(built, input.actor);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida ao sincronizar o PDV.";
    await recordCashClosureSyncError({
      workspaceId: input.workspaceId,
      kioskId: kiosk.id,
      kioskName: kiosk.name,
      pdvFilialId: kiosk.pdvFilialId,
      date: input.date,
      error: message,
    });
    throw error;
  }
}
