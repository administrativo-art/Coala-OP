import type { DocumentSnapshot } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { getHrEmployeeId } from "@/lib/hr/person-link";

type AnyRecord = Record<string, unknown>;

export type ResolvedPersonLink = {
  userDocument: DocumentSnapshot | null;
  employeeDocument: DocumentSnapshot | null;
  userId: string | null;
  employeeId: string | null;
};

async function uniqueUserBy(field: "hrEmployeeId" | "registrationIdBizneo", value: string) {
  const snapshot = await dbAdmin.collection("users").where(field, "==", value).limit(2).get();
  if (snapshot.size > 1) throw new Error(`Vínculo pessoal ambíguo para ${value}.`);
  return snapshot.empty ? null : snapshot.docs[0];
}

async function uniqueEmployeeBy(field: "auth_uid" | "source_user_id", value: string) {
  const snapshot = await hrDbAdmin.collection("employees").where(field, "==", value).limit(2).get();
  if (snapshot.size > 1) throw new Error(`Vínculo RH ambíguo para ${value}.`);
  return snapshot.empty ? null : snapshot.docs[0];
}

/** Resolve tanto UID da conta quanto ID do cadastro RH sem usar e-mail como chave. */
export async function resolvePersonLink(identifier: string): Promise<ResolvedPersonLink> {
  const id = identifier.trim();
  if (!id) return { userDocument: null, employeeDocument: null, userId: null, employeeId: null };

  let userDocument = await dbAdmin.collection("users").doc(id).get();
  if (!userDocument.exists) {
    userDocument = await uniqueUserBy("hrEmployeeId", id)
      ?? await uniqueUserBy("registrationIdBizneo", id)
      ?? userDocument;
  }

  const user = userDocument.exists ? (userDocument.data() ?? {}) as AnyRecord : null;
  const userId = userDocument.exists ? userDocument.id : null;
  const preferredEmployeeId = user && userId
    ? getHrEmployeeId({
        id: userId,
        hrEmployeeId: typeof user.hrEmployeeId === "string" ? user.hrEmployeeId : null,
        registrationIdBizneo: typeof user.registrationIdBizneo === "string" ? user.registrationIdBizneo : null,
      })
    : id;

  let employeeDocument = preferredEmployeeId
    ? await hrDbAdmin.collection("employees").doc(preferredEmployeeId).get()
    : null;
  if ((!employeeDocument || !employeeDocument.exists) && userId) {
    employeeDocument = await uniqueEmployeeBy("auth_uid", userId)
      ?? await uniqueEmployeeBy("source_user_id", userId)
      ?? employeeDocument;
  }

  if ((!userDocument.exists) && employeeDocument?.exists) {
    const employee = (employeeDocument.data() ?? {}) as AnyRecord;
    const authUid = typeof employee.auth_uid === "string" && employee.auth_uid.trim()
      ? employee.auth_uid.trim()
      : typeof employee.source_user_id === "string" && employee.source_user_id.trim()
        ? employee.source_user_id.trim()
        : null;
    if (authUid) userDocument = await dbAdmin.collection("users").doc(authUid).get();
  }

  return {
    userDocument: userDocument.exists ? userDocument : null,
    employeeDocument: employeeDocument?.exists ? employeeDocument : null,
    userId: userDocument.exists ? userDocument.id : null,
    employeeId: employeeDocument?.exists ? employeeDocument.id : null,
  };
}
