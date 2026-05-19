import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

loadEnv({ path: ".env.local" });

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "smart-converter-752gf";

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"));
  }

  return null;
}

const credentials = serviceAccount();
const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp(credentials ? { credential: cert(credentials), projectId: PROJECT_ID } : { projectId: PROJECT_ID });

const db = getFirestore(app, "coala-rh");

function slugify(input) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalize(input) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const departments = [
  { id: "desenvolvimento-humano-dho", name: "Desenvolvimento Humano (DHO)" },
  { id: "gestao-estrategica", name: "Gestão estratégica" },
  { id: "financeiro", name: "Financeiro" },
  { id: "geral", name: "Geral" },
  { id: "operacional", name: "Operacional" },
];

const roles = [
  ["Diretor de RH | Desenvolvimento Humano (DHO)", "desenvolvimento-humano-dho", null],
  ["Analista de RH | Desenvolvimento Humano (DHO)", "desenvolvimento-humano-dho", "Diretor de RH | Desenvolvimento Humano (DHO)"],
  ["Assistente de RH | Desenvolvimento Humano (DHO)", "desenvolvimento-humano-dho", "Analista de RH | Desenvolvimento Humano (DHO)"],
  ["Auxiliar de RH | Desenvolvimento Humano (DHO)", "desenvolvimento-humano-dho", "Assistente de RH | Desenvolvimento Humano (DHO)"],
  ["Diretor de RH | Gestão estratégica", "gestao-estrategica", null],
  ["Analista de RH | Gestão estratégica", "gestao-estrategica", "Diretor de RH | Gestão estratégica"],
  ["Assistente de RH | Gestão estratégica", "gestao-estrategica", "Analista de RH | Gestão estratégica"],
  ["Auxiliar de RH | Gestão estratégica", "gestao-estrategica", "Assistente de RH | Gestão estratégica"],
  ["Diretor financeiro", "financeiro", null],
  ["Gerente financeiro", "financeiro", "Diretor financeiro"],
  ["Analista financeiro", "financeiro", "Gerente financeiro"],
  ["Assistente financeiro", "financeiro", "Analista financeiro"],
  ["Auxiliar financeiro", "financeiro", "Assistente financeiro"],
  ["Diretor geral", "geral", null],
  ["Vice diretor geral", "geral", "Diretor geral"],
  ["Diretor operacional", "operacional", null],
  ["Gerente de operações", "operacional", "Diretor operacional"],
  ["Supervisor operacional", "operacional", "Gerente de operações"],
  ["Estoquista", "operacional", "Supervisor operacional"],
  ["Líder de quiosque", "operacional", "Supervisor operacional"],
  ["Atendente de quiosque", "operacional", "Líder de quiosque"],
];

function inferDepartmentId(name) {
  const text = normalize(name);
  if (text.includes("desenvolvimento humano") || text.includes("dho")) return "desenvolvimento-humano-dho";
  if (text.includes("gestao estrategica")) return "gestao-estrategica";
  if (text.includes("financeir")) return "financeiro";
  if (text.includes("operac") || text.includes("quiosque") || text.includes("estoquista")) return "operacional";
  if (text.includes("diretor geral") || text.includes("vice diretor geral")) return "geral";
  return null;
}

async function main() {
  const now = new Date().toISOString();

  for (const department of departments) {
    await db.collection("jobDepartments").doc(department.id).set({
      name: department.name,
      slug: department.id,
      isActive: true,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
  }

  const roleSnap = await db.collection("jobRoles").get();
  const roleByName = new Map(
    roleSnap.docs.map((doc) => [normalize(doc.data().name ?? ""), { id: doc.id, data: doc.data() }])
  );

  for (const [name, departmentId] of roles) {
    if (!roleByName.has(normalize(name))) {
      const ref = db.collection("jobRoles").doc();
      const department = departments.find((item) => item.id === departmentId);
      const data = {
        name,
        publicTitle: name.split("|")[0].trim(),
        slug: slugify(name),
        departmentId,
        departmentName: department?.name ?? null,
        reportsTo: null,
        responsibilities: [],
        publicResponsibilities: [],
        requirements: [],
        publicRequirements: [],
        competencies: [],
        benefits: [],
        formQuestions: [],
        loginRestricted: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(data);
      roleByName.set(normalize(name), { id: ref.id, data });
    }
  }

  for (const [name, departmentId, reportsToName] of roles) {
    const role = roleByName.get(normalize(name));
    if (!role) continue;
    const department = departments.find((item) => item.id === departmentId);
    const manager = reportsToName ? roleByName.get(normalize(reportsToName)) : null;

    await db.collection("jobRoles").doc(role.id).set({
      departmentId,
      departmentName: department?.name ?? null,
      reportsTo: manager?.id ?? null,
      updatedAt: now,
    }, { merge: true });
  }

  const functionSnap = await db.collection("jobFunctions").get();
  for (const doc of functionSnap.docs) {
    const data = doc.data();
    let departmentId = inferDepartmentId(data.name ?? data.publicTitle ?? "");

    if (!departmentId && Array.isArray(data.compatibleRoleIds)) {
      const matchedRole = roleSnap.docs
        .map((roleDoc) => ({ id: roleDoc.id, data: roleDoc.data() }))
        .find((role) => data.compatibleRoleIds.includes(role.id) && role.data.departmentId);
      departmentId = matchedRole?.data.departmentId ?? null;
    }

    if (!departmentId) continue;
    const department = departments.find((item) => item.id === departmentId);
    await doc.ref.set({
      departmentId,
      departmentName: department?.name ?? null,
      updatedAt: now,
    }, { merge: true });
  }

  console.log(`Departamentos criados/atualizados: ${departments.length}`);
  console.log(`Cargos do organograma garantidos: ${roles.length}`);
  console.log("Vínculos de departamento aplicados em cargos e funções compatíveis.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
