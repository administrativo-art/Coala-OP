import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "smart-converter-752gf.firebasestorage.app";

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

const filePath = "/Users/imated/Library/CloudStorage/GoogleDrive-tiagobrasilll@gmail.com/.shortcut-targets-by-id/1HxFjyA-LTqysdzUJzsMEQ4kPC9qRoY_i/02 - Coala Shakes (Financeiro)/00 - Documentos Gerais/00 - Documentos Empresa/Quiosque Tirirical/Cartão CNPJ.pdf";
const buffer = readFileSync(filePath);

const title = "Cartão CNPJ";
const category = "Fiscal e contábil";
const unit = "Quiosque Tirirical";
const uploadedBy = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";
const uploadedByName = "Tiago Brasil";

const id = randomUUID();
const contentHash = createHash("sha256").update(buffer).digest("hex");
const storagePath = `company-documents/${id}/versions/01/original.pdf`;
const now = Timestamp.now();
const standardizedName = buildStandardizedFileName({ category, title, uploadedAt: now.toDate(), extension: "pdf" });

await getStorage(app).bucket(storageBucket).file(storagePath).save(buffer, {
  resumable: false,
  metadata: {
    contentType: "application/pdf",
    cacheControl: "private, max-age=0, no-store",
    metadata: { documentId: id, domain: "company" },
  },
});

const payload = {
  title,
  category,
  unit,
  status: "active",
  expiresAt: null,
  originalName: "Cartão CNPJ.pdf",
  standardizedName,
  mimeType: "application/pdf",
  size: buffer.length,
  contentHash,
  hashAlgorithm: "sha256",
  version: 1,
  storagePath,
  uploadedBy,
  uploadedByName,
  uploadedAt: now,
  updatedAt: now,
  accessCount: 0,
  deletedAt: null,
};

const ref = db.collection("companyDocuments").doc(id);
await ref.set(payload);
await ref.collection("audit").add({
  action: "DOCUMENT_UPLOADED",
  actorId: uploadedBy,
  actorName: uploadedByName,
  at: now,
});

console.log(`Documento criado: id=${id}`);
console.log(`standardizedName=${standardizedName}`);
console.log(`storagePath=${storagePath}`);
