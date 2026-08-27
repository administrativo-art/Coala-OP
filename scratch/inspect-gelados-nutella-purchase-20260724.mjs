import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (credentialPath && existsSync(credentialPath)) {
    return cert(JSON.parse(readFileSync(credentialPath, "utf8")));
  }
  return applicationDefault();
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clean(item)])
    );
  }
  return value;
}

const app =
  getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, "coala");
const [entities, baseProducts, products, purchaseOrders] = await Promise.all([
  db.collection("entities").get(),
  db.collection("baseProducts").get(),
  db.collection("products").get(),
  db.collection("purchase_orders").get(),
]);

const supplierMatches = entities.docs
  .map((document) => ({ id: document.id, ...clean(document.data()) }))
  .filter((entity) => {
    const searchable = normalize(
      `${entity.name || ""} ${entity.fantasyName || ""} ${entity.cnpj || ""}`
    );
    return (
      searchable.includes("gelados comestiveis") ||
      searchable.includes("gelados") ||
      searchable.includes("distribuidora")
    );
  });

const baseMatches = baseProducts.docs
  .map((document) => ({ id: document.id, ...clean(document.data()) }))
  .filter((product) => normalize(JSON.stringify(product)).includes("nutella"));

const productMatches = products.docs
  .map((document) => ({ id: document.id, ...clean(document.data()) }))
  .filter((product) => normalize(JSON.stringify(product)).includes("nutella"));

const duplicateOrders = purchaseOrders.docs
  .map((document) => ({ id: document.id, ...clean(document.data()) }))
  .filter((order) => {
    const searchable = normalize(JSON.stringify(order));
    return (
      searchable.includes("137 768") ||
      searchable.includes("140 147") ||
      searchable.includes("nutella 650")
    );
  });

console.log(
  JSON.stringify(
    { supplierMatches, baseMatches, productMatches, duplicateOrders },
    null,
    2
  )
);
