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
const now = new Date().toISOString();

await Promise.all([
  processRef.set({
    accountantWorkflow: {
      status: "completed",
      updatedAt: now,
    },
    updatedAt: now,
  }, { merge: true }),
  processRef.collection("accountantEvents").doc(randomUUID()).set({
    type: "ACCOUNTANT_REGISTRY_APPROVED",
    at: now,
    actorId: ACTOR_ID,
    actorEmail: ACTOR_EMAIL,
    reason: null,
    note: "Backfill manual: etapa do contador tratada fora do sistema (sem envio de e-mail nem ficha de registro anexada). Checkpoint destravado a pedido do usuário, sem documento de lastro.",
  }),
]);

console.log("accountantWorkflow.status = completed (checkpoint destravado, sem registryDocument).");
