import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const apply = process.argv.includes("--apply");
const employeeId = "18688727";
const documentId = "67de6698c4c1042a1f0976c25ea0defa";
const actorId = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const hrDb = getFirestore(app, "coala-rh");
const documentRef = hrDb.collection("employeeDocuments").doc(documentId);
const employeeRef = hrDb.collection("employees").doc(employeeId);
const [documentSnap, employeeSnap] = await Promise.all([documentRef.get(), employeeRef.get()]);

if (!documentSnap.exists || documentSnap.get("employeeId") !== employeeId) throw new Error("Documento da Aliny não encontrado.");
if (!employeeSnap.exists || employeeSnap.get("bizneo_employee_id") !== employeeId) throw new Error("Cadastro RH da Aliny não encontrado.");

const plan = {
  apply,
  employeeId,
  documentId,
  before: {
    status: documentSnap.get("status"),
    documentType: documentSnap.get("documentType"),
    warning: documentSnap.get("validationWarning"),
  },
  after: {
    status: "validated",
    documentType: "ASO admissional",
    warning: null,
  },
};

if (apply) {
  const now = Timestamp.now();
  const extractedFields = { ...(documentSnap.get("extractedFields") || {}), formalAso: true };
  const batch = hrDb.batch();
  batch.set(documentRef, {
    status: "validated",
    documentType: "ASO admissional",
    displayName: "ASO admissional — 09/07/2026",
    validationWarning: null,
    extractedFields,
    validatedBy: actorId,
    validatedByName: "Tiago Brasil",
    validatedAt: now,
    updatedAt: now,
  }, { merge: true });
  batch.set(documentRef.collection("audit").doc("rh_confirmation_20260721"), {
    action: "DOCUMENT_VALIDATED",
    actorId,
    actorName: "Tiago Brasil",
    note: "RH confirmou que o arquivo apresentado corresponde ao ASO admissional da colaboradora.",
    at: now,
  }, { merge: true });
  batch.set(employeeRef.collection("field_values").doc("system.aso.summary"), {
    field_key: "system.aso.summary",
    value_text: "ASO admissional em 09/07/2026: apta — MedClinic.",
    updated_by: actorId,
    updated_at: now,
    source: "rh_document_confirmation",
    source_document_ids: [documentId],
  }, { merge: true });
  await batch.commit();
}

console.log(JSON.stringify(plan, null, 2));
