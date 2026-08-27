import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function normalize(value = "") {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function containsId(value, id) {
  if (value === id) return true;
  if (Array.isArray(value)) return value.some((entry) => containsId(entry, id));
  if (value && typeof value === "object") return Object.values(value).some((entry) => containsId(entry, id));
  return false;
}

function matchingPaths(value, needle, prefix = "") {
  if (value === needle) return [prefix || "<root>"];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => matchingPaths(entry, needle, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      matchingPaths(entry, needle, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [];
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, databaseId);
const [unitSnap, kioskSnap, groupSnap, organizationSnap] = await Promise.all([
  db.collection("dp_units").get(),
  db.collection("kiosks").get(),
  db.collection("dp_unitGroups").get(),
  db.collection("dp_unitOrganizations").get(),
]);

const groups = new Map(groupSnap.docs.map((doc) => [doc.id, doc.data()]));
const organizations = new Map(organizationSnap.docs.map((doc) => [doc.id, doc.data()]));
const targets = unitSnap.docs.filter((doc) => {
  const name = normalize(doc.data().name);
  return name.includes("administrativo") || name.includes("cta") || name.includes("matriz") || name.includes("distribuicao");
});
const administrativeTarget = targets.find((target) => normalize(target.data().name).includes("administrativo"));
const matrixTarget = targets.find((target) => normalize(target.data().name).includes("matriz"));

for (const doc of targets) {
  const data = doc.data();
  const group = data.groupId ? groups.get(data.groupId) : null;
  const organization = data.organizationId ? organizations.get(data.organizationId) : null;
  console.log(JSON.stringify({
    id: doc.id,
    name: data.name,
    externalSource: data.externalSource ?? null,
    externalId: data.externalId ?? null,
    pdvFilialId: data.pdvFilialId ?? null,
    bizneoTaxonId: data.bizneoTaxonId ?? null,
    group: group?.name ?? null,
    organization: organization?.name ?? null,
    cnpj: data.cnpj ?? null,
    address: data.address ?? null,
  }, null, 2));
}

console.log("\nEstrutura organizacional afetada:");
for (const doc of targets) {
  const data = doc.data();
  if (!data.organizationId) continue;
  const organization = organizations.get(data.organizationId);
  const organizationUnits = unitSnap.docs.filter((unit) => unit.data().organizationId === data.organizationId);
  const organizationGroups = groupSnap.docs.filter((group) => group.data().organizationId === data.organizationId);
  console.log(JSON.stringify({
    unit: data.name,
    organizationId: data.organizationId,
    organizationName: organization?.name,
    unitCount: organizationUnits.length,
    units: organizationUnits.map((unit) => unit.data().name),
    groupCount: organizationGroups.length,
    groups: organizationGroups.map((group) => group.data().name),
    responsibility: organization ? {
      responsibleSourceType: organization.responsibleSourceType ?? null,
      responsibleSourceName: organization.responsibleSourceName ?? null,
      responsibleUserName: organization.responsibleUserName ?? null,
    } : null,
  }, null, 2));
}

console.log("\nQuiosques operacionais relacionados:");
for (const doc of kioskSnap.docs) {
  const name = normalize(doc.data().name);
  if (name.includes("administrativo") || name.includes("cta") || name.includes("matriz") || name.includes("distribuicao")) {
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  }
}

const referenceCollections = [
  "users",
  "dp_shiftDefinitions",
  "dp_schedules",
  "jobOpenings",
  "candidates",
  "onboardingProcesses",
  "form_projects",
  "form_templates",
  "form_assignments",
  "form_executions",
  "operationalTasks",
  "tasks",
  "task_projects",
  "goalPeriods",
  "employeeGoals",
  "resultCenters",
  "bankAccounts",
  "dp_loginAccessJustifications",
];

console.log("\nReferências diretas conhecidas:");
const referenceSnapshots = new Map();
for (const collectionName of referenceCollections) {
  referenceSnapshots.set(collectionName, await db.collection(collectionName).get());
}
for (const target of targets) {
  const references = [];
  for (const collectionName of referenceCollections) {
    const snapshot = referenceSnapshots.get(collectionName);
    const matched = snapshot.docs.filter((doc) => containsId(doc.data(), target.id));
    if (matched.length) references.push(`${collectionName}: ${matched.length}`);
  }
  console.log(`- ${target.data().name} (${target.id}): ${references.join(", ") || "nenhuma"}`);
}

console.log("\nReferências por nome nas mesmas coleções:");
for (const target of targets) {
  const targetName = target.data().name;
  const references = [];
  for (const collectionName of referenceCollections) {
    const snapshot = referenceSnapshots.get(collectionName);
    const matched = snapshot.docs.filter((doc) => containsId(doc.data(), targetName));
    if (matched.length) references.push(`${collectionName}: ${matched.length}`);
  }
  console.log(`- ${targetName}: ${references.join(", ") || "nenhuma"}`);
}

const impactedUserIds = referenceSnapshots.get("users").docs
  .filter((doc) => administrativeTarget && containsId(doc.data(), administrativeTarget.id))
  .map((doc) => doc.id);
const matrixPeriods = referenceSnapshots.get("goalPeriods").docs.filter((doc) => doc.data().kioskId === "matriz");
const impactedGoals = referenceSnapshots.get("employeeGoals").docs.filter((doc) => impactedUserIds.includes(doc.data().employeeId));
const impactedPeriodIds = new Set(impactedGoals.map((doc) => doc.data().periodId));
const impactedPeriods = referenceSnapshots.get("goalPeriods").docs.filter((doc) => impactedPeriodIds.has(doc.id));
console.log("\nMetas potencialmente afetadas pela mudança de atribuição das escalas:");
console.log(JSON.stringify({
  impactedUserIds,
  matrixPeriods: matrixPeriods.map((doc) => ({ id: doc.id, status: doc.data().status, kioskId: doc.data().kioskId, distributionMode: doc.data().distributionMode })),
  impactedPeriods: impactedPeriods.map((doc) => ({ id: doc.id, status: doc.data().status, kioskId: doc.data().kioskId, kioskIds: doc.data().kioskIds, distributionMode: doc.data().distributionMode })),
  impactedGoals: impactedGoals.map((doc) => ({ id: doc.id, employeeId: doc.data().employeeId, periodId: doc.data().periodId, targetValue: doc.data().targetValue, distributionMode: doc.data().distributionMode })),
}, null, 2));

const selectedKeys = [
  "name", "username", "unitId", "unitIds", "unitName", "unitNames", "unit_id", "unit_name",
  "assignedKioskIds", "responsibleUnitIds", "scheduleId", "year", "month", "code", "startTime", "endTime",
  "bizneoTaxonId", "externalId", "externalSource", "status", "type", "projectId",
];

function summary(data) {
  return Object.fromEntries(selectedKeys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
}

console.log("\nDetalhes das referências encontradas:");
for (const collectionName of referenceCollections) {
  const snapshot = referenceSnapshots.get(collectionName);
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const matchedTargets = targets.filter((target) =>
      containsId(data, target.id) || containsId(data, target.data().name)
    );
    if (matchedTargets.length) {
      console.log(JSON.stringify({
        collection: collectionName,
        id: doc.id,
        matches: matchedTargets.map((item) => ({
          name: item.data().name,
          paths: [
            ...matchingPaths(data, item.id),
            ...matchingPaths(data, item.data().name),
          ],
        })),
        ...summary(data),
      }, null, 2));
    }
  }
}

console.log("\nSubcoleções de turnos das escalas vinculadas:");
const scheduleSnapshot = referenceSnapshots.get("dp_schedules");
const scheduleKeys = new Map();
for (const schedule of scheduleSnapshot.docs) {
  const data = schedule.data();
  const key = `${data.year}-${data.month}`;
  const entries = scheduleKeys.get(key) ?? [];
  entries.push({ id: schedule.id, unitId: data.unitId, name: data.name });
  scheduleKeys.set(key, entries);
}
console.log("\nConflitos de escala se Administrativo/CTA virar Matriz/CD:");
for (const [key, schedules] of scheduleKeys) {
  const adminSchedule = schedules.find((entry) => entry.unitId === administrativeTarget?.id);
  if (!adminSchedule) continue;
  const collisions = schedules.filter((entry) => entry.unitId === matrixTarget?.id || entry.unitId === "matriz");
  console.log(JSON.stringify({ month: key, adminSchedule, collisions }, null, 2));
}

for (const schedule of scheduleSnapshot.docs) {
  if (!targets.some((target) => containsId(schedule.data(), target.id))) continue;
  const shifts = await schedule.ref.collection("shifts").get();
  console.log(`- ${schedule.id}: ${shifts.size} turnos`);
  for (const shift of shifts.docs) console.log(JSON.stringify({ id: shift.id, ...summary(shift.data()) }, null, 2));
}

const otherDatabases = [
  {
    name: "coala-checklist",
    collections: [
      "form_projects", "form_templates", "form_assignments", "form_executions", "form_occurrences",
      "form_analytics_domains", "form_analytics_criteria", "form_analytics_results", "form_analytics_targets",
    ],
  },
  {
    name: "coala-rh",
    collections: [
      "employees", "rh_access_cache", "jobOpenings", "candidates", "applications", "onboardingProcesses",
      "hrNotifications", "uniform_profiles",
    ],
  },
  {
    name: "coala-financeiro",
    collections: ["resultCenters", "bankAccounts", "expenses", "transactions", "accounts"],
  },
];

console.log("\nAuditoria nos bancos especializados:");
for (const database of otherDatabases) {
  const specializedDb = getFirestore(app, database.name);
  for (const collectionName of database.collections) {
    const snapshot = await specializedDb.collection(collectionName).get();
    const matches = [];
    for (const doc of snapshot.docs) {
      for (const target of targets) {
        const paths = [
          ...matchingPaths(doc.data(), target.id),
          ...matchingPaths(doc.data(), target.data().name),
        ];
        if (paths.length) matches.push({ docId: doc.id, target: target.data().name, paths });
      }
    }
    if (snapshot.size || matches.length) {
      console.log(JSON.stringify({ database: database.name, collection: collectionName, scanned: snapshot.size, matches }, null, 2));
    }
  }
}
