import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const hrDb = getFirestore(app, "coala-rh");

const PROCESS_ID = "AuN2P9qU5GMQRGvVLc86"; // Sara Ferreira Coelho
const ACTOR_ID = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";
const ACTOR_EMAIL = "tiagobrasilll@gmail.com";

const processRef = hrDb.collection("onboardingProcesses").doc(PROCESS_ID);
const snap = await processRef.get();
const data = snap.data();
const legacyAso = (data.documents || []).find((d) => d.id === "aso_admission");

if (!legacyAso || legacyAso.status !== "approved") {
  console.log("ASO legado não está aprovado — abortando.");
  process.exit(1);
}
if (data.asoWorkflow?.asoDocument?.status === "approved") {
  console.log("asoWorkflow já está aprovado — nada a fazer.");
  process.exit(0);
}

const now = new Date().toISOString();
const reviewedAt = legacyAso.approvedAt || now;

await Promise.all([
  processRef.set({
    asoWorkflow: {
      status: "completed",
      asoDocument: {
        fileName: legacyAso.filePath?.split("/").pop() ?? null,
        storagePath: legacyAso.filePath ?? null,
        hashSha256: legacyAso.fileHashSha256 ?? null,
        mimeType: "image/png",
        uploadedAt: legacyAso.receivedAt ?? null,
        status: "approved",
        reviewedAt,
        reviewedBy: ACTOR_ID,
        rejectionReason: null,
      },
      updatedAt: now,
    },
    updatedAt: now,
  }, { merge: true }),
  processRef.collection("asoEvents").doc(randomUUID()).set({
    type: "ASO_APPROVED",
    at: now,
    actorId: ACTOR_ID,
    actorEmail: ACTOR_EMAIL,
    reason: null,
    note: "Backfill: ASO já havia sido aprovado pelo fluxo legado de documentos (aso_admission) antes da migração para asoWorkflow.",
  }),
]);

console.log("asoWorkflow.asoDocument.status = approved (backfill concluído para Sara Ferreira Coelho).");
