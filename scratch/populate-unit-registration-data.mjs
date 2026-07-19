import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const apply = process.argv.includes("--apply");

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

function normalize(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const registrations = [
  {
    label: "Tirirical",
    matches: (name) => name.includes("tirirical") || name.includes("tirircal"),
    cnpj: "14276603000125",
    address: "Avenida Guajajaras, Quadra 65, nº 3505, São Bernardo, São Luís - MA, CEP 65056-045",
  },
  {
    label: "João Paulo",
    matches: (name) => name.includes("joao paulo"),
    cnpj: "14276603000206",
    address: "Avenida João Pessoa, nº 224, Filipinho, São Luís - MA, CEP 65042-815",
  },
  {
    label: "Shopping do Automóvel",
    matches: (name) => name.includes("shopping") && name.includes("automovel"),
    cnpj: "14276603000478",
    address: "Avenida dos Holandeses/Conselheiro Hilton Rodrigues, nº 1, Quadra 36, Loja 45, Nível 01, Edifício Shopping do Automóvel, Calhau, São Luís - MA, CEP 65071-380",
  },
  {
    label: "Matriz/CD",
    matches: (name) => name === "cd" || name.includes("matriz") || name.includes("centro de distribuicao"),
    cnpj: "14276603000397",
    address: "Edifício Adriana - Av. Cel. Colares Moreira, 01, Qda. 121, 1º andar - mesmo prédio da Pharmapele, Renascença, São Luís - MA, CEP 65075-440",
  },
];

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, databaseId);
const snapshot = await db.collection("dp_units").get();
const units = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

console.log(`Projeto: ${projectId}/${databaseId}`);
console.log(`Unidades encontradas: ${units.length}`);
for (const unit of units) console.log(`- ${unit.id}: ${unit.name}`);

const resolved = registrations.map((registration) => {
  const candidates = units.filter((unit) => registration.matches(normalize(unit.name)));
  if (candidates.length !== 1) {
    throw new Error(`${registration.label}: esperava 1 unidade, encontrei ${candidates.length}.`);
  }
  return { registration, unit: candidates[0] };
});

console.log(apply ? "\nAplicando atualizações:" : "\nPrévia (nenhuma gravação):");
for (const { registration, unit } of resolved) {
  console.log(`- ${unit.name} (${unit.id}): ${registration.cnpj} | ${registration.address}`);
}

if (apply) {
  const batch = db.batch();
  for (const { registration, unit } of resolved) {
    batch.update(db.collection("dp_units").doc(unit.id), {
      cnpj: registration.cnpj,
      address: registration.address,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log("\nAtualização concluída. Verificando leitura:");
  for (const { registration, unit } of resolved) {
    const saved = (await db.collection("dp_units").doc(unit.id).get()).data();
    const valid = saved?.cnpj === registration.cnpj && saved?.address === registration.address;
    if (!valid) throw new Error(`Falha na verificação de ${registration.label}.`);
    console.log(`- ${registration.label}: CNPJ e endereço conferidos`);
  }
}
