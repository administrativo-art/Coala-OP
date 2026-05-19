import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

loadEnv({ path: ".env.local" });

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "smart-converter-752gf";

const ITALO_EMAIL = "aitaloricardo@gmail.com";
const COMMERCIAL_DEPARTMENT_ID = "departamento-comercial-publicidade";
const COMMERCIAL_DEPARTMENT_NAME = "DEPARTAMENTO COMERCIAL E PUBLICIDADE";
const GENERAL_DIRECTOR_PROFILE_NAME = "Diretoria geral";
const DEFAULT_USER_PROFILE_NAME = "Usuário padrão";

const roleSpecs = [
  {
    id: "diretor-comercial-publicidade",
    name: "Diretor de Comercial e Publicidade",
    publicTitle: "Diretor de Comercial e Publicidade",
    parentName: null,
    order: 0,
    useGeneralDirectorProfile: true,
  },
  {
    id: "responsavel-comercial",
    name: "Responsável Comercial",
    publicTitle: "Responsável Comercial",
    parentName: "Diretor de Comercial e Publicidade",
    order: 1,
    useGeneralDirectorProfile: false,
  },
  {
    id: "responsavel-publicidade",
    name: "Responsável de Publicidade",
    publicTitle: "Responsável de Publicidade",
    parentName: "Diretor de Comercial e Publicidade",
    order: 2,
    useGeneralDirectorProfile: false,
  },
];

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"));
  }

  return null;
}

function normalize(input) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(input) {
  return normalize(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

const credentials = serviceAccount();
const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp(
        credentials ? { credential: cert(credentials), projectId: PROJECT_ID } : { projectId: PROJECT_ID }
      );

const opDb = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");

async function getProfileByName(name) {
  const snapshot = await opDb.collection("profiles").get();
  const matches = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((profile) => normalize(profile.name) === normalize(name));

  if (matches.length === 0) {
    throw new Error(`Perfil não encontrado: ${name}`);
  }

  return matches[0];
}

async function ensureCommercialDepartment() {
  const timestamp = nowIso();
  const ref = hrDb.collection("jobDepartments").doc(COMMERCIAL_DEPARTMENT_ID);

  await ref.set(
    {
      name: COMMERCIAL_DEPARTMENT_NAME,
      slug: slugify(COMMERCIAL_DEPARTMENT_NAME),
      description: null,
      parentId: null,
      order: 4,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { merge: true }
  );

  return { id: ref.id, name: COMMERCIAL_DEPARTMENT_NAME };
}

async function getExistingRolesByName() {
  const snapshot = await hrDb.collection("jobRoles").get();
  return new Map(
    snapshot.docs.map((doc) => [normalize(doc.data().name), { id: doc.id, data: doc.data(), ref: doc.ref }])
  );
}

async function ensureCommercialRoles(department, generalDirectorProfileId) {
  const timestamp = nowIso();
  const rolesByName = await getExistingRolesByName();
  const ensured = new Map();

  for (const spec of roleSpecs) {
    const existing = rolesByName.get(normalize(spec.name));
    const ref = existing?.ref ?? hrDb.collection("jobRoles").doc(spec.id);
    const parent = spec.parentName ? ensured.get(normalize(spec.parentName)) : null;
    const parentId = parent?.id ?? null;

    const data = {
      name: spec.name,
      publicTitle: spec.publicTitle,
      slug: slugify(spec.name),
      departmentId: department.id,
      departmentName: department.name,
      reportsTo: parentId,
      parentId,
      responsibilities: existing?.data?.responsibilities ?? [],
      publicResponsibilities: existing?.data?.publicResponsibilities ?? [],
      requirements: existing?.data?.requirements ?? [],
      publicRequirements: existing?.data?.publicRequirements ?? [],
      competencies: existing?.data?.competencies ?? [],
      benefits: existing?.data?.benefits ?? [],
      formQuestions: existing?.data?.formQuestions ?? [],
      loginRestricted: existing?.data?.loginRestricted ?? false,
      isActive: true,
      order: spec.order,
      updatedAt: timestamp,
      ...(existing ? {} : { createdAt: timestamp }),
      ...(spec.useGeneralDirectorProfile ? { defaultProfileId: generalDirectorProfileId } : {}),
    };

    await ref.set(data, { merge: true });

    const role = { id: ref.id, data: { ...(existing?.data ?? {}), ...data }, ref };
    rolesByName.set(normalize(spec.name), role);
    ensured.set(normalize(spec.name), role);
  }

  return ensured.get(normalize("Diretor de Comercial e Publicidade"));
}

async function updateItalo(directorRole, generalDirectorProfileId) {
  const usersByEmail = await opDb.collection("users").where("email", "==", ITALO_EMAIL).limit(1).get();
  let userDoc = usersByEmail.docs[0] ?? null;

  if (!userDoc) {
    const usersSnapshot = await opDb.collection("users").get();
    userDoc =
      usersSnapshot.docs.find((doc) => normalize(doc.data().username).includes("italo")) ??
      usersSnapshot.docs.find((doc) => normalize(doc.data().email).includes("italoricardo")) ??
      null;
  }

  if (!userDoc) {
    throw new Error("Usuário Italo não encontrado.");
  }

  await userDoc.ref.set(
    {
      jobRoleId: directorRole.id,
      jobRoleName: directorRole.data.name,
      jobFunctionIds: [],
      jobFunctionNames: [],
      profileId: generalDirectorProfileId,
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  return { id: userDoc.id, username: userDoc.data().username, email: userDoc.data().email };
}

async function cleanupDefaultUserProfiles() {
  const profilesSnapshot = await opDb.collection("profiles").get();
  const defaultProfiles = profilesSnapshot.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() }))
    .filter((profile) => normalize(profile.data.name) === normalize(DEFAULT_USER_PROFILE_NAME));

  if (defaultProfiles.length <= 1) {
    return { canonicalId: defaultProfiles[0]?.id ?? null, deletedIds: [], migratedUsers: 0 };
  }

  const usersSnapshot = await opDb.collection("users").get();
  const usageCount = new Map(defaultProfiles.map((profile) => [profile.id, 0]));

  for (const userDoc of usersSnapshot.docs) {
    const profileId = userDoc.data().profileId;
    if (usageCount.has(profileId)) {
      usageCount.set(profileId, (usageCount.get(profileId) ?? 0) + 1);
    }
  }

  const canonical = [...defaultProfiles].sort((a, b) => {
    const byUsage = (usageCount.get(b.id) ?? 0) - (usageCount.get(a.id) ?? 0);
    if (byUsage !== 0) return byUsage;
    return a.id.localeCompare(b.id);
  })[0];

  const duplicateIds = defaultProfiles.map((profile) => profile.id).filter((id) => id !== canonical.id);
  const usersToMigrate = usersSnapshot.docs.filter((doc) => duplicateIds.includes(doc.data().profileId));

  for (const group of chunk(usersToMigrate, 450)) {
    const batch = opDb.batch();
    for (const userDoc of group) {
      batch.update(userDoc.ref, { profileId: canonical.id, updatedAt: nowIso() });
    }
    await batch.commit();
  }

  for (const profileId of duplicateIds) {
    await opDb.collection("profiles").doc(profileId).delete();
  }

  return { canonicalId: canonical.id, deletedIds: duplicateIds, migratedUsers: usersToMigrate.length };
}

async function main() {
  const generalDirectorProfile = await getProfileByName(GENERAL_DIRECTOR_PROFILE_NAME);
  const department = await ensureCommercialDepartment();
  const directorRole = await ensureCommercialRoles(department, generalDirectorProfile.id);

  if (!directorRole) {
    throw new Error("Cargo Diretor de Comercial e Publicidade não foi criado/encontrado.");
  }

  const italo = await updateItalo(directorRole, generalDirectorProfile.id);
  const cleanup = await cleanupDefaultUserProfiles();

  console.log("Departamento Comercial/Publicidade garantido:", department.id);
  console.log("Cargo do Italo:", directorRole.id, directorRole.data.name);
  console.log("Italo atualizado:", italo.id, italo.username ?? italo.email);
  console.log("Perfil padrão canônico:", cleanup.canonicalId ?? "não encontrado");
  console.log("Usuários migrados dos perfis duplicados:", cleanup.migratedUsers);
  console.log("Perfis duplicados removidos:", cleanup.deletedIds.length ? cleanup.deletedIds.join(", ") : "nenhum");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
