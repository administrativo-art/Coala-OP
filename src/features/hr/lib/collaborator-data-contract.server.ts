import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { hrDbAdmin } from "@/lib/firebase-rh-admin";

async function employeeForUser(userId: string) {
  const direct = await hrDbAdmin.collection("employees").doc(userId).get();
  if (direct.exists) return direct.ref;
  const byAuth = await hrDbAdmin.collection("employees").where("auth_uid", "==", userId).limit(1).get();
  if (!byAuth.empty) return byAuth.docs[0].ref;
  const bySource = await hrDbAdmin.collection("employees").where("source_user_id", "==", userId).limit(1).get();
  return bySource.empty ? null : bySource.docs[0].ref;
}

/**
 * Synchronizes read-only HR profile projections from the canonical VT record.
 * Values in user records are reais; currency fields in the RH profile store cents.
 */
export async function syncTransportVoucherProjection(input: {
  userId: string;
  active: boolean;
  valueReais?: number | null;
  actorId: string;
  source: string;
}) {
  const employeeRef = await employeeForUser(input.userId);
  if (!employeeRef) return { employeeId: null, synced: false };
  const now = Timestamp.now();
  const batch = hrDbAdmin.batch();
  batch.set(employeeRef.collection("field_values").doc("employee.has_vt"), {
    field_key: "employee.has_vt",
    value_boolean: input.active,
    updated_at: now,
    updated_by: input.actorId,
    source: input.source,
  }, { merge: true });
  batch.set(employeeRef.collection("field_values").doc("employee.vt_daily_value"), {
    field_key: "employee.vt_daily_value",
    value_number: input.active && input.valueReais != null ? Math.round(input.valueReais * 100) : 0,
    updated_at: now,
    updated_by: input.actorId,
    source: input.source,
  }, { merge: true });
  batch.set(employeeRef, { updated_at: now }, { merge: true });
  await batch.commit();
  return { employeeId: employeeRef.id, synced: true };
}
