import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "smart-converter-752gf.firebasestorage.app";

const UPLOADED_BY = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";
const UPLOADED_BY_NAME = "Tiago Brasil";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function slug(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

function buildStandardizedFileName({ category, title, uploadedAt, extension }) {
  const y = uploadedAt.getFullYear();
  const m = String(uploadedAt.getMonth() + 1).padStart(2, "0");
  const d = String(uploadedAt.getDate()).padStart(2, "0");
  const categorySlug = slug(category) || "SEM-CATEGORIA";
  const titleSlug = slug(title) || "SEM-TITULO";
  return `${categorySlug}_${titleSlug}_${y}${m}${d}.${extension}`;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, databaseId);

// Recategoriza documentos já existentes (categoria mudou para "Fiscal e contábil").
const RECATEGORIZE = [
  { id: "b3aae5b6-1a18-4e64-ae85-5063a654b6b4", category: "Fiscal e contábil" },
  { id: "7c4f956d-4541-46c0-9e88-49594f2c2f77", category: "Fiscal e contábil" },
];

for (const entry of RECATEGORIZE) {
  const ref = db.collection("companyDocuments").doc(entry.id);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`Não encontrado: ${entry.id}`); continue; }
  const data = snap.data();
  const uploadedAt = data.uploadedAt?.toDate?.() ?? new Date();
  const extension = (data.standardizedName || data.originalName || "arquivo.pdf").split(".").pop();
  const standardizedName = buildStandardizedFileName({ category: entry.category, title: data.title, uploadedAt, extension });
  await ref.update({ category: entry.category, standardizedName, updatedAt: Timestamp.now() });
  console.log(`RECATEGORIZADO: ${data.title} | ${data.category} -> ${entry.category} | ${standardizedName}`);
}

// Cada entrada: { filePath, title, category, unit, expiresAt (AAAA-MM-DD ou null) }
const MANIFEST = [
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque João Paulo/Cartão CNPJ.pdf",
    title: "Cartão CNPJ",
    category: "Fiscal e contábil",
    unit: "Quiosque João Paulo",
    expiresAt: null,
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque João Paulo/Inscrição estadual.pdf",
    title: "Inscrição Estadual",
    category: "Fiscal e contábil",
    unit: "Quiosque João Paulo",
    expiresAt: null,
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque João Paulo/Inscrição municipal.pdf",
    title: "Certidão Negativa Municipal",
    category: "Fiscal e contábil",
    unit: "Quiosque João Paulo",
    expiresAt: "2026-04-21",
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Matriz - CD/Cartão CNPJ.pdf",
    title: "Cartão CNPJ",
    category: "Fiscal e contábil",
    unit: "Centro de distribuição - Matriz",
    expiresAt: null,
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Matriz - CD/Inscricao estadual.pdf",
    title: "Inscrição Estadual",
    category: "Fiscal e contábil",
    unit: "Centro de distribuição - Matriz",
    expiresAt: null,
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Matriz - CD/Inscrição municipal Matriz.pdf",
    title: "Certidão Negativa Municipal",
    category: "Fiscal e contábil",
    unit: "Centro de distribuição - Matriz",
    expiresAt: "2026-04-21",
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque Shopping do Automóvel/Cartão CNPJ.pdf",
    title: "Cartão CNPJ",
    category: "Fiscal e contábil",
    unit: "Quiosque Shopping do Automóvel",
    expiresAt: null,
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque Shopping do Automóvel/Inscrição estadual.pdf",
    title: "Inscrição Estadual",
    category: "Fiscal e contábil",
    unit: "Quiosque Shopping do Automóvel",
    expiresAt: null,
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque Shopping do Automóvel/Contrato de locação - Shopping do automóvel.pdf",
    title: "Contrato de Locação",
    category: "Contratos",
    unit: "Quiosque Shopping do Automóvel",
    expiresAt: "2027-06-12",
  },
  {
    filePath: "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque Shopping do Automóvel/Shopping do Automóvel - Regimento interno.pdf",
    title: "Regimento Interno",
    category: "Contratos",
    unit: "Quiosque Shopping do Automóvel",
    expiresAt: null,
  },
];

const existingSnap = await db.collection("companyDocuments").get();
const existingHashes = new Set(existingSnap.docs.filter((d) => !d.get("deletedAt")).map((d) => d.get("contentHash")));

for (const entry of MANIFEST) {
  const buffer = readFileSync(entry.filePath);
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  if (existingHashes.has(contentHash)) {
    console.log(`PULADO (já existe, mesmo conteúdo): ${entry.title} — ${entry.filePath}`);
    continue;
  }

  const id = randomUUID();
  const storagePath = `company-documents/${id}/versions/01/original.pdf`;
  const now = Timestamp.now();
  const standardizedName = buildStandardizedFileName({ category: entry.category, title: entry.title, uploadedAt: now.toDate(), extension: "pdf" });

  await getStorage(app).bucket(storageBucket).file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      metadata: { documentId: id, domain: "company" },
    },
  });

  const payload = {
    title: entry.title,
    category: entry.category,
    unit: entry.unit || null,
    status: "active",
    expiresAt: entry.expiresAt || null,
    originalName: entry.filePath.split("/").pop(),
    standardizedName,
    mimeType: "application/pdf",
    size: buffer.length,
    contentHash,
    hashAlgorithm: "sha256",
    version: 1,
    storagePath,
    uploadedBy: UPLOADED_BY,
    uploadedByName: UPLOADED_BY_NAME,
    uploadedAt: now,
    updatedAt: now,
    accessCount: 0,
    deletedAt: null,
  };

  const ref = db.collection("companyDocuments").doc(id);
  await ref.set(payload);
  await ref.collection("audit").add({
    action: "DOCUMENT_UPLOADED",
    actorId: UPLOADED_BY,
    actorName: UPLOADED_BY_NAME,
    at: now,
  });

  existingHashes.add(contentHash);
  console.log(`CRIADO: id=${id} | ${standardizedName}`);
}
