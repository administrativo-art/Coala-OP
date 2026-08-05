import { existsSync, readFileSync } from "node:fs";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

import { fetchPdvLegalFiliais } from "../src/lib/integrations/pdv-legal-admin";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const MIGRATION_ID = "central-pdv-unit-links-v1-20260805";
const EXECUTE = process.argv.includes("--execute");

const LINKS = [
  { unitName: "Quiosque Tirirical", kioskId: "tirirical", pdvFilialId: "17343" },
  { unitName: "Quiosque João Paulo", kioskId: "joao-paulo", pdvFilialId: "17344" },
] as const;

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) {
    return cert(JSON.parse(readFileSync(path, "utf8")));
  }
  return applicationDefault();
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const app = getApps().find((candidate) => candidate.name === "central-pdv-unit-links")
  ?? initializeApp({ credential: credential(), projectId: PROJECT_ID }, "central-pdv-unit-links");
const db = getFirestore(app, DATABASE_ID);

const [filiais, unitsSnapshot, kiosksSnapshot] = await Promise.all([
  fetchPdvLegalFiliais(),
  db.collection("dp_units").get(),
  db.collection("kiosks").get(),
]);

const targets = LINKS.map((link) => {
  const filial = filiais.find((candidate) => candidate.id === link.pdvFilialId);
  if (!filial) throw new Error(`Filial ${link.pdvFilialId} não localizada no PDV Legal.`);

  const units = unitsSnapshot.docs.filter((document) => normalize(document.get("name")) === normalize(link.unitName));
  if (units.length !== 1) {
    throw new Error(`${link.unitName}: esperado exatamente um cadastro central; encontrados ${units.length}.`);
  }

  const kiosk = kiosksSnapshot.docs.find((document) => document.id === link.kioskId);
  if (!kiosk) throw new Error(`Quiosque legado ${link.kioskId} não encontrado.`);

  const unit = units[0];
  return {
    ...link,
    filial,
    unit,
    kiosk,
    changed:
      unit.get("pdvFilialId") !== link.pdvFilialId ||
      unit.get("externalSource") !== "kiosk" ||
      unit.get("externalId") !== link.kioskId ||
      kiosk.get("pdvFilialId") !== link.pdvFilialId ||
      kiosk.get("pdvLinkManagedByUnitId") !== unit.id,
  };
});

console.table(targets.map((target) => ({
  unidade: target.unitName,
  cadastroCentral: target.unit.id,
  quiosqueLegado: target.kioskId,
  filialPdv: target.pdvFilialId,
  nomeNoPdv: target.filial.name,
  alterar: target.changed ? "sim" : "não",
})));

if (!EXECUTE) {
  console.log(`DRY-RUN: ${targets.filter((target) => target.changed).length} vínculo(s) seriam atualizados. Use --execute para gravar.`);
  process.exit(0);
}

const backupRef = db.collection("system_migration_backups").doc(MIGRATION_ID);
if ((await backupRef.get()).exists) {
  throw new Error(`Backup ${MIGRATION_ID} já existe; aplicação duplicada bloqueada.`);
}

const now = new Date();
const batch = db.batch();
batch.create(backupRef, {
  migration: MIGRATION_ID,
  createdAt: FieldValue.serverTimestamp(),
  records: targets.map((target) => ({
    unitId: target.unit.id,
    kioskId: target.kiosk.id,
    unitBefore: {
      pdvFilialId: target.unit.get("pdvFilialId") ?? null,
      externalSource: target.unit.get("externalSource") ?? null,
      externalId: target.unit.get("externalId") ?? null,
    },
    kioskBefore: {
      pdvFilialId: target.kiosk.get("pdvFilialId") ?? null,
      pdvLinkManagedByUnitId: target.kiosk.get("pdvLinkManagedByUnitId") ?? null,
    },
  })),
});

for (const target of targets) {
  const metadata = {
    pdvFilialId: target.pdvFilialId,
    pdvFilialName: target.filial.name,
    pdvFilialCnpj: target.filial.cnpj,
    pdvFilialActive: target.filial.active,
    pdvFilialSyncedAt: FieldValue.serverTimestamp(),
  };
  batch.set(target.unit.ref, {
    ...metadata,
    externalSource: "kiosk",
    externalId: target.kioskId,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(target.kiosk.ref, {
    ...metadata,
    pdvLinkManagedByUnitId: target.unit.id,
    pdvLinkSyncedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

const auditRef = db.collection("actionLogs").doc();
batch.set(auditRef, {
  workspace_id: "coala",
  user_id: "system:codex",
  username: "Codex",
  module: "settings.units",
  action: "pdv_links_centralized",
  metadata: {
    migration: MIGRATION_ID,
    links: targets.map((target) => ({
      unitId: target.unit.id,
      unitName: target.unitName,
      kioskId: target.kioskId,
      pdvFilialId: target.pdvFilialId,
      pdvFilialName: target.filial.name,
    })),
  },
  ip_address: null,
  timestamp: Timestamp.fromDate(now),
  ttl: Timestamp.fromDate(new Date(now.getTime() + 365 * 86400000)),
});

await batch.commit();
console.log(`APLICADO: ${targets.length} vínculo(s) centralizados; backup ${MIGRATION_ID}; auditoria ${auditRef.id}.`);
