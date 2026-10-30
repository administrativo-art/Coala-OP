import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "smart-converter-752gf";
const DATABASE_ID = "coala";
const BACKUP_ID = "disable-shift-location-tracking-20261030-v1";
const APPLY = process.argv.includes("--apply");
const PRODUCTION = process.argv.includes("--production");
const CONFIRMED = process.argv.includes("--confirm-disable-shift-location");

const allowed = new Set(["--apply", "--production", "--confirm-disable-shift-location"]);
const unknown = process.argv.slice(2).filter((argument) => !allowed.has(argument));
if (unknown.length) throw new Error(`Argumento desconhecido: ${unknown.join(", ")}`);
if (APPLY && (!PRODUCTION || !CONFIRMED)) {
  throw new Error("Produção exige --apply --production --confirm-disable-shift-location.");
}

const app = getApps().find((candidate) => candidate.name === BACKUP_ID)
  ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, BACKUP_ID);
const db = getFirestore(app, DATABASE_ID);

const snapshot = await db.collection("dp_shiftDefinitions").orderBy("__name__").limit(500).get();
if (snapshot.size === 500) throw new Error("Há 500 turnos ou mais; revise a paginação antes de aplicar.");

const changes = snapshot.docs.flatMap((document) => {
  const current = document.get("locationTrackingPolicy");
  if (current === "disabled") return [];
  return [{ ref: document.ref, id: document.id, name: String(document.get("name") ?? document.id), previous: current ?? null }];
});

console.log(JSON.stringify({
  mode: APPLY ? "production-apply" : "dry-run",
  projectId: PROJECT_ID,
  databaseId: DATABASE_ID,
  scanned: snapshot.size,
  affected: changes.length,
  changes: changes.map(({ id, name, previous }) => ({ id, name, previous, next: "disabled" })),
}, null, 2));

if (!APPLY) process.exit(0);
if (!changes.length) {
  console.log("APLICADO: todos os turnos já estavam com coleta desativada.");
  process.exit(0);
}
if (changes.length > 498) throw new Error("Muitos turnos para o lote atômico.");

const backupRef = db.collection("system_migration_backups").doc(BACKUP_ID);
if ((await backupRef.get()).exists) throw new Error(`Backup ${BACKUP_ID} já existe; reaplicação bloqueada.`);

const batch = db.batch();
batch.create(backupRef, {
  migration: "disable_shift_location_tracking",
  projectId: PROJECT_ID,
  databaseId: DATABASE_ID,
  records: changes.map(({ id, name, previous }) => ({ id, name, previous })),
  createdAt: FieldValue.serverTimestamp(),
});
for (const change of changes) {
  batch.update(change.ref, {
    locationTrackingPolicy: "disabled",
    locationTrackingPolicyUpdatedAt: FieldValue.serverTimestamp(),
    locationTrackingPolicyUpdatedBy: `migration:${BACKUP_ID}`,
  });
}
await batch.commit();

const verification = await Promise.all(changes.map(({ ref }) => ref.get()));
const failed = verification.filter((document) => document.get("locationTrackingPolicy") !== "disabled");
if (failed.length) throw new Error(`Verificação falhou em ${failed.length} turno(s).`);
console.log(`APLICADO: ${changes.length} turno(s) com coleta desativada; backup ${BACKUP_ID} criado e verificado.`);
