import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { readSubjectRef, type PersonLookup, type SubjectRef } from "./person-subject";
import { validatedPersonKeys } from "./signature-person-history";
import { preflightPersonKeys, preflightIdentifierKeys, preflightDocumentKeys } from "./person-preflight";

const user = (snapshot: FirebaseFirestore.DocumentSnapshot) => snapshot.exists ? {
  id: snapshot.id, hrEmployeeId: snapshot.get("hrEmployeeId") as string | undefined,
  recruitmentCandidateId: snapshot.get("recruitmentCandidateId") as string | undefined,
  onboardingId: snapshot.get("onboardingId") as string | undefined, source: snapshot.get("source") as string | undefined,
  onboardingPersonRef: readSubjectRef(snapshot.get("onboardingPersonRef")), onboardingProvisioningId: snapshot.get("onboardingProvisioningId") as string | undefined,
} : null;
const employee = (snapshot: FirebaseFirestore.DocumentSnapshot) => snapshot.exists ? {
  id: snapshot.id, auth_uid: snapshot.get("auth_uid") as string | undefined,
  source_user_id: snapshot.get("source_user_id") as string | undefined,
  onboardingId: snapshot.get("onboardingId") as string | undefined, onboardingPersonRef: readSubjectRef(snapshot.get("onboardingPersonRef")), onboardingProvisioningId: snapshot.get("onboardingProvisioningId") as string | undefined,
} : null;

export const firestorePersonLookup: PersonLookup = {
  async processById(id) { const row = await hrDbAdmin.collection("onboardingProcesses").doc(id).get(); return row.exists ? { ...row.data(), id: row.id } : null; },
  async onboardingPerson(id) {
    const rows = await hrDbAdmin.collection("onboardingProcesses").where("personIdentity.ref.id", "==", id).limit(2).select("workspaceId", "workspace_id", "unitId", "source", "applicationId", "jobOpeningId", "jobRoleId", "functionId", "employerUnitId", "employmentRelationshipType", "integrationV2.snapshot.schemaVersion", "personIdentity", "personProvisioning", "collaboratorUserId", "employeeId", "candidateId").get();
    if (rows.size !== 1) return null;
    const row = rows.docs[0]; return { id, processId: row.id, process: { ...row.data(), id: row.id } };
  },
  async user(id) { return user(await dbAdmin.collection("users").doc(id).get()); },
  async employee(id) { return employee(await hrDbAdmin.collection("employees").doc(id).get()); },
  async candidate(id) { const row = await hrDbAdmin.collection("candidates").doc(id).get(); return row.exists ? { id: row.id } : null; },
  async processesByUser(id) {
    const rows = await hrDbAdmin.collection("onboardingProcesses").where("collaboratorUserId", "==", id).limit(21).get();
    if (rows.size === 21) throw new Error("Processos demais para confirmar vínculo de candidato.");
    return rows.docs.map((row) => ({ ...row.data(), id: row.id }));
  },
  async processesByCandidate(id) {
    const rows = await hrDbAdmin.collection("onboardingProcesses").where("candidateId", "==", id).limit(21).get();
    if (rows.size === 21) throw new Error("Processos demais para confirmar vínculo de candidato.");
    return rows.docs.map((row) => ({ ...row.data(), id: row.id }));
  },
  async usersByEmployee(id) {
    const rows = await dbAdmin.collection("users").where("hrEmployeeId", "==", id).limit(2).get();
    return rows.docs.map((row) => user(row)!);
  },
  async employeesByUser(id) {
    const [auth, source] = await Promise.all([
      hrDbAdmin.collection("employees").where("auth_uid", "==", id).limit(2).get(),
      hrDbAdmin.collection("employees").where("source_user_id", "==", id).limit(2).get(),
    ]);
    return [...new Map([...auth.docs, ...source.docs].map((row) => [row.id, employee(row)!])).values()];
  },
};

/** New writes must not freeze an unresolved or contradictory equivalence. */
export async function confirmedSubjectKeys(ref: SubjectRef): Promise<string[]> {
  return preflightPersonKeys(ref, firestorePersonLookup);
}

/** Legacy argument has no namespace. Resolve it only when a single direct record exists. */
export async function confirmedSubjectKeysForIdentifier(id: string): Promise<string[]> {
  return preflightIdentifierKeys(id, firestorePersonLookup);
}

export async function confirmedSubjectKeysForDocument(employeeId?: string | null, onboardingId?: string | null): Promise<string[]> {
  let process: Record<string, unknown> | null = null;
  if (onboardingId) {
    const snapshot = await hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).get();
    if (!snapshot.exists) throw new Error("Processo de integração não encontrado para vínculo pessoal.");
    process = { ...snapshot.data(), id: snapshot.id };
  }
  return preflightDocumentKeys({ employeeId, process }, firestorePersonLookup);
}

/** A new signature must preflight its saved subject refs, rather than union stale aliases. */
export async function confirmedStoredSubjectKeys(value: unknown): Promise<string[]> {
  const keys = validatedPersonKeys(value);
  for (const key of keys) {
    const index = key.indexOf(":");
    const ref = readSubjectRef({ namespace: key.slice(0, index), id: key.slice(index + 1) })!;
    const confirmed = await confirmedSubjectKeys(ref);
    if (keys.some((candidate) => !confirmed.includes(candidate))) throw new Error("Documento contém titulares incompatíveis.");
  }
  return keys;
}
