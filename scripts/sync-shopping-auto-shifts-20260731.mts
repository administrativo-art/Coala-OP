import { readFileSync } from "node:fs";

import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const EFFECTIVE_DATE = "2026-07-31";
const UNIT_ID = "kPRLQ14F7XpzSLUFXGyO";
const BACKUP_ID = "shopping-auto-shifts-20260731-v1";

const MODELS = {
  "4wUiYLb87bwHcdYe0U8O": {
    label: "CS - 00 AT | Domingo",
    startTime: "09:00",
    breakStart: "12:00",
    breakEnd: "12:15",
    endTime: "15:00",
  },
  UZ41D2PvwyjF1eNMkUsq: {
    label: "CS - 01 AT | Manhã",
    startTime: "09:00",
    breakStart: "12:00",
    breakEnd: "12:15",
    endTime: "15:15",
  },
  UtgP4Knyz6MFm9wXslhy: {
    label: "CS - 01 AT | Tarde",
    startTime: "14:45",
    breakStart: "17:00",
    breakEnd: "17:15",
    endTime: "21:00",
  },
  fnm6owACVWjPJh2WARlm: {
    label: "CS - 01 AT | Tarde - Intermediário",
    startTime: "12:00",
    breakStart: "15:00",
    breakEnd: "15:15",
    endTime: "18:15",
  },
} as const;

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
const app = initializeApp({ credential: cert(serviceAccount) }, `sync-auto-shifts-${Date.now()}`);
const db = getFirestore(app, "coala");

const [definitionsSnap, schedulesSnap, usersSnap] = await Promise.all([
  Promise.all(Object.keys(MODELS).map((id) => db.collection("dp_shiftDefinitions").doc(id).get())),
  db.collection("dp_schedules").where("unitId", "==", UNIT_ID).get(),
  db.collection("users").get(),
]);

const usersById = new Map(usersSnap.docs.map((document) => [document.id, document.get("username") || document.id]));
const shifts: Array<{
  path: string;
  scheduleId: string;
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}> = [];

for (const schedule of schedulesSnap.docs) {
  const scheduleShifts = await schedule.ref.collection("shifts").get();
  for (const shift of scheduleShifts.docs) {
    const data = shift.data();
    const model = MODELS[data.shiftDefinitionId as keyof typeof MODELS];
    if (!model || String(data.date ?? "") < EFFECTIVE_DATE) continue;
    const userName = usersById.get(String(data.userId ?? ""));
    shifts.push({
      path: shift.ref.path,
      scheduleId: schedule.id,
      id: shift.id,
      before: data,
      after: {
        startTime: model.startTime,
        endTime: model.endTime,
        ...(userName ? { userName } : {}),
        synchronizedAt: Timestamp.now(),
        synchronizedSource: "bizneo-models-validated-20260731",
      },
    });
  }
}

const report = {
  mode: APPLY ? "apply" : "dry-run",
  effectiveDate: EFFECTIVE_DATE,
  unitId: UNIT_ID,
  definitions: definitionsSnap.map((document) => ({
    id: document.id,
    exists: document.exists,
    before: document.data() ?? null,
    after: MODELS[document.id as keyof typeof MODELS],
  })),
  affectedSchedules: [...new Set(shifts.map((shift) => shift.scheduleId))],
  affectedShifts: shifts.map(({ path, before, after }) => ({
    path,
    date: before.date,
    userId: before.userId,
    before: { startTime: before.startTime, endTime: before.endTime },
    after: { startTime: after.startTime, endTime: after.endTime, userName: after.userName },
  })),
};

console.log(JSON.stringify(report, null, 2));

if (!APPLY) process.exit(0);

const backupRef = db.collection("system_migration_backups").doc(BACKUP_ID);
const backup = await backupRef.get();
if (backup.exists) throw new Error(`Backup ${BACKUP_ID} já existe; sincronização não reaplicada.`);

await backupRef.set({
  type: "shopping_auto_shift_sync",
  effectiveDate: EFFECTIVE_DATE,
  unitId: UNIT_ID,
  definitions: definitionsSnap.map((document) => ({ id: document.id, data: document.data() ?? null })),
  shifts: shifts.map(({ path, before }) => ({ path, data: before })),
  createdAt: FieldValue.serverTimestamp(),
});

const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
for (const [id, model] of Object.entries(MODELS)) {
  writes.push((batch) => batch.set(db.collection("dp_shiftDefinitions").doc(id), {
    startTime: model.startTime,
    endTime: model.endTime,
    breakStart: model.breakStart,
    breakEnd: model.breakEnd,
    synchronizedAt: FieldValue.serverTimestamp(),
    synchronizedSource: "bizneo-models-validated-20260731",
  }, { merge: true }));
}
for (const shift of shifts) {
  writes.push((batch) => batch.set(
    db.collection("dp_schedules").doc(shift.scheduleId).collection("shifts").doc(shift.id),
    { ...shift.after, synchronizedAt: FieldValue.serverTimestamp() },
    { merge: true },
  ));
}

for (let index = 0; index < writes.length; index += 400) {
  const batch = db.batch();
  writes.slice(index, index + 400).forEach((write) => write(batch));
  await batch.commit();
}

await backupRef.set({ appliedAt: FieldValue.serverTimestamp(), affectedShiftCount: shifts.length }, { merge: true });
console.log(`Sincronização aplicada: ${shifts.length} turno(s), ${Object.keys(MODELS).length} modelo(s).`);
