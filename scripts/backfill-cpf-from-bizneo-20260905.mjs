import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const APPLY = process.argv.includes("--apply");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId: PROJECT_ID });
const hrDb = getFirestore(app, "coala-rh");

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

const EMPLOYEES = [
  { name: "Carliane Sousa Ramos", hrEmployeeId: "17044767", cpf: onlyDigits("60945735367") },
  { name: "Maria Edna Gois Ribeiro", hrEmployeeId: "17021665", cpf: onlyDigits("61261029321") },
  { name: "Maria Joana Barbosa Pereira", hrEmployeeId: "17044771", cpf: onlyDigits("612.700.503-54") },
  { name: "Samila Valesca Cardoso", hrEmployeeId: "18546102", cpf: onlyDigits("009.025.313-28") },
];

for (const emp of EMPLOYEES) {
  if (emp.cpf.length !== 11) throw new Error(`CPF inválido para ${emp.name}: ${emp.cpf}`);
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  fonte: "Bizneo (Documentos_CPF), coletado na admissão de cada colaboradora",
  destino: "coala-rh/employees/{hrEmployeeId}/field_values/employee.cpf",
  lancamentos: EMPLOYEES.map((e) => ({ name: e.name, hrEmployeeId: e.hrEmployeeId, cpfMasked: `***.***.***-${e.cpf.slice(-2)}` })),
}, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Nenhum dado foi alterado. Rode novamente com --apply para aplicar.");
  process.exit(0);
}

for (const emp of EMPLOYEES) {
  const ref = hrDb.collection("employees").doc(emp.hrEmployeeId).collection("field_values").doc("employee.cpf");
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error(`Já existe employee.cpf para ${emp.name} (${emp.hrEmployeeId}) — abortando para não sobrescrever.`);
  }
  await ref.create({
    field_key: "employee.cpf",
    value_text: emp.cpf,
    source: "bizneo_backfill_20260905",
    updated_by: "claude-code:payroll-launch-20260905",
    updated_at: FieldValue.serverTimestamp(),
  });
  console.log(`CPF gravado para ${emp.name}.`);
}

console.log("\nConcluído. As 4 colaboradoras agora têm CPF cadastrado em coala-rh.");
