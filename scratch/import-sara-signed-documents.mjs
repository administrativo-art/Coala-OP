import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "smart-converter-752gf.firebasestorage.app";
const apply = process.argv.includes("--apply");

const PROCESS_ID = "AuN2P9qU5GMQRGvVLc86";
const EXPECTED_EMAIL = "sara17ferreira2004@gmail.com";
const SOURCE_DIRECTORY = "/Users/imated/Desktop/Sara";
const ACTOR_ID = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";
const ACTOR_NAME = "Tiago Brasil";
const ACTOR_EMAIL = "tiagobrasilll@gmail.com";

const EXPECTED_HASHES = {
  admission: "0067634a70778c7b8e092077feeb1162fd4e951304dcb278fd404ea418605e60",
  registry: "aeb3b6d724c5d6a6cc1317257f7c4ecd4d6a7a48814eda3d8d32c201195cbbda",
};

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function normalized(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function findPdf(predicate) {
  const file = readdirSync(SOURCE_DIRECTORY).find((entry) => entry.toLowerCase().endsWith(".pdf") && predicate(normalized(entry)));
  if (!file) throw new Error(`PDF não encontrado em ${SOURCE_DIRECTORY}.`);
  return join(SOURCE_DIRECTORY, file);
}

function readVerifiedPdf(filePath, expectedHash) {
  const buffer = readFileSync(filePath);
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`${basename(filePath)} não é um PDF válido.`);
  const hashSha256 = createHash("sha256").update(buffer).digest("hex");
  if (hashSha256 !== expectedHash) throw new Error(`Hash inesperado para ${basename(filePath)}: ${hashSha256}`);
  return { buffer, hashSha256, size: buffer.byteLength, originalName: basename(filePath) };
}

const admissionPath = findPdf((name) => name.includes("admissao") && name.includes("assinado"));
const registryPath = findPdf((name) => name.includes("ficha registro") && name.includes("assinado"));
const admission = readVerifiedPdf(admissionPath, EXPECTED_HASHES.admission);
const registry = readVerifiedPdf(registryPath, EXPECTED_HASHES.registry);

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId, storageBucket });
const hrDb = getFirestore(app, "coala-rh");
const bucket = getStorage(app).bucket(storageBucket);
const processRef = hrDb.collection("onboardingProcesses").doc(PROCESS_ID);
const processSnapshot = await processRef.get();
if (!processSnapshot.exists) throw new Error("Integração da Sara não encontrada.");
const processData = processSnapshot.data();
if (String(processData.candidateEmail || "").toLowerCase() !== EXPECTED_EMAIL) {
  throw new Error("O processo encontrado não pertence ao e-mail esperado da Sara.");
}

const workflowDocumentId = createHash("sha256")
  .update(`manual-signed-admission-bundle:${PROCESS_ID}`)
  .digest("hex")
  .slice(0, 40);
const registryVersionId = createHash("sha256")
  .update(`manual-accountant-registry:${PROCESS_ID}:${registry.hashSha256}`)
  .digest("hex")
  .slice(0, 40);
const admissionStoragePath = `signed-documents/${PROCESS_ID}/manual-admission-bundle/signed.pdf`;
const registryStoragePath = `hr/onboarding/${PROCESS_ID}/accountant/registry/${registryVersionId}.pdf`;
const signedAt = "2026-07-08T13:39:00.000Z";
const registrySignedAt = "2026-07-07T21:36:00.000Z";

const workflowRef = hrDb.collection("hrSignatureDocuments").doc(workflowDocumentId);
const existingWorkflow = await workflowRef.get();
const currentRegistryHash = processData.accountantWorkflow?.registryDocument?.hashSha256 ?? null;
if (existingWorkflow.exists && existingWorkflow.get("contentHash") !== admission.hashSha256) {
  throw new Error("Já existe um pacote admissional manual com conteúdo diferente.");
}
if (currentRegistryHash && currentRegistryHash !== registry.hashSha256) {
  throw new Error("Já existe outra ficha de registro vinculada; revisão manual necessária.");
}

async function storageHashMatches(path, expectedHash, shouldExist) {
  if (!shouldExist) return false;
  const [buffer] = await bucket.file(path).download();
  return createHash("sha256").update(buffer).digest("hex") === expectedHash;
}

const [admissionStorageVerified, registryStorageVerified] = await Promise.all([
  storageHashMatches(admissionStoragePath, admission.hashSha256, existingWorkflow.exists),
  storageHashMatches(registryStoragePath, registry.hashSha256, currentRegistryHash === registry.hashSha256),
]);

const plan = {
  apply,
  processId: PROCESS_ID,
  candidate: processData.candidateName,
  currentStage: processData.currentStage,
  currentStatus: processData.status,
  admission: {
    originalName: admission.originalName,
    hashSha256: admission.hashSha256,
    size: admission.size,
    storagePath: admissionStoragePath,
    alreadyImported: existingWorkflow.exists,
    storageHashVerified: admissionStorageVerified,
  },
  registry: {
    originalName: registry.originalName,
    hashSha256: registry.hashSha256,
    size: registry.size,
    storagePath: registryStoragePath,
    alreadyImported: currentRegistryHash === registry.hashSha256,
    storageHashVerified: registryStorageVerified,
  },
  stageWillRemain: processData.currentStage,
  statusWillRemain: processData.status,
};

if (!apply) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();

if (!existingWorkflow.exists) {
  await bucket.file(admissionStoragePath).save(admission.buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      metadata: {
        onboardingId: PROCESS_ID,
        workflowDocumentId,
        hashSha256: admission.hashSha256,
        source: "manual_import",
      },
    },
  });
}

if (currentRegistryHash !== registry.hashSha256) {
  await bucket.file(registryStoragePath).save(registry.buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      metadata: {
        onboardingId: PROCESS_ID,
        versionId: registryVersionId,
        hashSha256: registry.hashSha256,
        source: "manual_import",
      },
    },
  });
}

const batch = hrDb.batch();
const registryDocument = {
  versionId: registryVersionId,
  fileName: "Ficha de registro - Sara Ferreira Coelho.pdf",
  originalName: registry.originalName,
  storagePath: registryStoragePath,
  hashSha256: registry.hashSha256,
  mimeType: "application/pdf",
  size: registry.size,
  uploadedAt: now,
  signedAt: registrySignedAt,
  status: "approved",
  reviewedAt: now,
  reviewedBy: ACTOR_ID,
  reviewedByName: ACTOR_NAME,
  rejectionReason: null,
  source: "manual_import",
  externalSignatureProvider: "autentique",
  providerDocumentId: "6b5cbf372eb9237374d487bb765e1f3ec9bb285c73acab6c5",
  providerValidationUrl: "https://valida.ae/6b5cbf372eb9237374d487bb765e1f3ec9bb285c73acab6c5",
  providerOriginalHashSha256: "2febd223f8d98afb21c6d5be71895ac75811b1f966148b49f1e07419c795d9b9",
};

batch.set(workflowRef, {
  onboardingId: PROCESS_ID,
  templateId: "manual-signed-admission-bundle",
  templateVersion: 1,
  templateName: "Pacote de documentos admissionais",
  documentName: "Pacote admissional assinado - Sara Ferreira Coelho",
  category: "Admissão",
  documentTypeCode: "PROBATION_CONTRACT",
  selected: true,
  required: true,
  order: 0,
  status: "signed_archived_pending_employee",
  signedAt,
  archivedAt: now,
  signedStoragePath: admissionStoragePath,
  signedFileUrl: "https://valida.ae/091c556e69c785a3d5f25480ce62e61ce2b87bdc729f7203c",
  provider: "autentique",
  providerDocumentId: "091c556e69c785a3d5f25480ce62e61ce2b87bdc729f7203c",
  providerOriginalHashSha256: "d3309910b4014c3f4a753ada5a5ef255d4f68cde877c4e8b8686bdd5c1ea2f8a",
  originalName: admission.originalName,
  mimeType: "application/pdf",
  size: admission.size,
  contentHash: admission.hashSha256,
  hashAlgorithm: "sha256",
  source: "manual_import",
  externalSignatureProvider: "autentique",
  importedAt: now,
  importedBy: ACTOR_ID,
  importedByName: ACTOR_NAME,
  updatedAt: now,
  bundleComponents: [
    { code: "PROBATION_CONTRACT", label: "Contrato de trabalho a título de experiência", pages: [1] },
    { code: "BANK_HOURS_AGREEMENT", label: "Acordo individual de banco de horas", pages: [2] },
    { code: "LGPD_TERM", label: "Termo LGPD", pages: [3, 4] },
    { code: "IMAGE_VOICE_CONSENT", label: "Consentimento para uso de imagem e voz", pages: [5] },
    { code: "GOALS_BONUSES_TERM", label: "Termo de metas e bonificações", pages: [6] },
    { code: "TRANSPORT_BENEFIT_TERM", label: "Termo de vale-transporte", pages: [7] },
    { code: "SIGNATURE_AUDIT", label: "Relatório de assinaturas Autentique", pages: [8] },
  ],
}, { merge: true });

batch.set(workflowRef.collection("audit").doc(`manual_import_${admission.hashSha256.slice(0, 16)}`), {
  action: "SIGNED_DOCUMENT_IMPORTED",
  actorId: ACTOR_ID,
  actorName: ACTOR_NAME,
  actorEmail: ACTOR_EMAIL,
  onboardingId: PROCESS_ID,
  workflowDocumentId,
  contentHash: admission.hashSha256,
  at: now,
  note: "Pacote admissional assinado importado de documentação histórica fornecida pelo RH.",
}, { merge: true });

batch.set(processRef.collection("accountantRegistryVersions").doc(registryVersionId), {
  ...registryDocument,
  uploader: "manual_import",
  uploaderId: ACTOR_ID,
  uploaderName: ACTOR_NAME,
}, { merge: true });

batch.set(processRef.collection("accountantEvents").doc(`manual_registry_uploaded_${registry.hashSha256.slice(0, 16)}`), {
  type: "ACCOUNTANT_REGISTRY_UPLOADED",
  at: now,
  actorId: ACTOR_ID,
  actorEmail: ACTOR_EMAIL,
  versionId: registryVersionId,
  hashSha256: registry.hashSha256,
  size: registry.size,
  source: "manual_import",
}, { merge: true });

batch.set(processRef.collection("accountantEvents").doc(`manual_registry_approved_${registry.hashSha256.slice(0, 16)}`), {
  type: "ACCOUNTANT_REGISTRY_APPROVED",
  at: now,
  actorId: ACTOR_ID,
  actorEmail: ACTOR_EMAIL,
  versionId: registryVersionId,
  hashSha256: registry.hashSha256,
  source: "manual_import",
  note: "Ficha de Registro de Empregado assinada importada e vinculada como evidência da etapa já concluída.",
}, { merge: true });

batch.set(processRef, {
  accountantWorkflow: {
    ...(processData.accountantWorkflow || {}),
    status: "completed",
    registryDocument,
    updatedAt: now,
  },
  signatureWorkflow: {
    ...(processData.signatureWorkflow || {}),
    status: "completed",
    total: 1,
    completedAt: signedAt,
    source: "manual_import",
    updatedAt: now,
  },
  updatedAt: now,
}, { merge: true });

await batch.commit();
console.log(JSON.stringify({ ...plan, appliedAt: now, ok: true }, null, 2));
