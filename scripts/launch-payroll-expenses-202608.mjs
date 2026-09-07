import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const FIN_DATABASE = "coala-financeiro";
const COMPETENCE = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
const DUE_DATE = Timestamp.fromDate(new Date("2026-09-05T00:00:00.000Z"));
const ACCOUNT_ID = "vuLqBaYv6ZgSALpLQiy9"; // Salários (Folha de pagamento > Pessoal)
const ACCOUNT_NAME = "Salários";
const RESULT_CENTERS = {
  joaoPaulo: "2ZDimcSsXdm2SUYI3Y4w",
  tirirical: "OF7O8RKMJR8I7wAhfxhb",
  shoppingAutomovel: "eCHb3fsk97fvUqzbT7DR",
};
const CREATED_BY = "claude-code:payroll-launch-20260905";
const SOURCE_NOTE = "Lançado a partir do holerite de Agosto/2026 (Folha Mensal, CT SORVETES LTDA). Pagamento (PIX/Inter) a ser feito manualmente pelo usuário — não há integração automática de folha com o Banco Inter neste sistema ainda.";
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

if (APPLY && ROLLBACK) throw new Error("Use apenas --apply ou --rollback.");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId: PROJECT_ID });
const finDb = getFirestore(app, FIN_DATABASE);

function description(name) {
  return `Salário - 08/2026 | ${name}`;
}

const EMPLOYEES = [
  { key: "aliny", employeeId: "kjveCeNGKwbY9C4c4ji86JJbXQz2", name: "Aliny Rodrigues da Silva", net: 1543.53, resultCenter: RESULT_CENTERS.shoppingAutomovel },
  { key: "carliane", employeeId: "Yv9V1cqvG0QaqA8xOZ0qzgdatTl1", name: "Carliane Sousa Ramos", net: 1537.33, resultCenter: RESULT_CENTERS.tirirical },
  {
    key: "heucilene",
    employeeId: "fvrLOh1JOIOtU5QhZQZydN3UBf22",
    name: "Heucilene Oliveira Ribeiro",
    net: 1492.19,
    isApportioned: true,
    apportionments: [
      { resultCenter: RESULT_CENTERS.joaoPaulo, percentage: 33.34 },
      { resultCenter: RESULT_CENTERS.tirirical, percentage: 33.33 },
      { resultCenter: RESULT_CENTERS.shoppingAutomovel, percentage: 33.33 },
    ],
  },
  { key: "mariaEdna", employeeId: "hMNJ5lSn51MKne6nDakYhUDqEUS2", name: "Maria Edna Gois Ribeiro", net: 1345.33, resultCenter: RESULT_CENTERS.tirirical },
  { key: "mariaJoana", employeeId: "T268zeSgq8QMGAJPph7YrOCzbrD2", name: "Maria Joana Barbosa Pereira", net: 1044.10, resultCenter: RESULT_CENTERS.joaoPaulo },
  { key: "samila", employeeId: "oHTdeGUJ77S1rUBbqgQp7YcpuIn1", name: "Samila Valesca Cardoso", net: 1613.29, resultCenter: RESULT_CENTERS.joaoPaulo },
  { key: "sara", employeeId: "FzliQXBLykURpu9CxL8EzoAe4Xq1", name: "Sara Ferreira Coelho", net: 1543.53, resultCenter: RESULT_CENTERS.shoppingAutomovel },
  { key: "thaise", employeeId: "iBINjsq011a3F266sP9kMI5zd2R2", name: "Thaise Correia Marinho", net: 346.13, resultCenter: RESULT_CENTERS.tirirical },
];

function expenseDoc(emp) {
  const base = {
    workspaceId: "coala",
    description: description(emp.name),
    supplier: emp.name,
    employeeId: emp.employeeId,
    employeeName: emp.name,
    accountPlan: ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    accountPlanName: ACCOUNT_NAME,
    totalValue: emp.net,
    competenceDate: COMPETENCE,
    dueDate: DUE_DATE,
    paymentMethod: "single",
    installments: [{ number: 1, dueDate: DUE_DATE, value: emp.net, status: "pending" }],
    status: "pending",
    notes: SOURCE_NOTE,
    createdAt: Timestamp.now(),
    createdBy: CREATED_BY,
    updatedAt: Timestamp.now(),
    updatedBy: CREATED_BY,
  };
  if (emp.isApportioned) {
    return {
      ...base,
      isApportioned: true,
      resultCenter: null,
      rateioCriterion: "equal",
      apportionments: emp.apportionments,
    };
  }
  return { ...base, isApportioned: false, resultCenter: emp.resultCenter };
}

function docId(emp) {
  return `salary_202608_${emp.employeeId}`;
}

async function readExisting() {
  const refs = EMPLOYEES.map((emp) => finDb.collection("expenses").doc(docId(emp)));
  const snaps = await finDb.getAll(...refs);
  return snaps;
}

if (ROLLBACK) {
  const snaps = await readExisting();
  const batch = finDb.batch();
  let count = 0;
  snaps.forEach((snap) => {
    if (snap.exists && snap.get("createdBy") === CREATED_BY) {
      batch.delete(snap.ref);
      count += 1;
    }
  });
  if (count === 0) {
    console.log("Nada para reverter (nenhum documento criado por este script encontrado).");
    process.exit(0);
  }
  await batch.commit();
  console.log(`Rollback concluído: ${count} despesa(s) removida(s).`);
  process.exit(0);
}

const existing = await readExisting();
const alreadyPresent = existing.filter((snap) => snap.exists);
if (alreadyPresent.length > 0) {
  throw new Error(`${alreadyPresent.length} despesa(s) já existem com esse id (evitando duplicar): ${alreadyPresent.map((s) => s.id).join(", ")}`);
}

const totalNet = EMPLOYEES.reduce((sum, emp) => sum + emp.net, 0);

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  competencia: "08/2026",
  vencimento: "2026-09-05",
  contaContabil: `${ACCOUNT_NAME} (${ACCOUNT_ID})`,
  totalLiquido: Math.round(totalNet * 100) / 100,
  lancamentos: EMPLOYEES.map((emp) => ({
    id: docId(emp),
    colaborador: emp.name,
    valor: emp.net,
    rateio: emp.isApportioned ? emp.apportionments : { resultCenter: emp.resultCenter },
  })),
}, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Nenhum dado foi criado. Rode novamente com --apply para aplicar.");
  process.exit(0);
}

const batch = finDb.batch();
EMPLOYEES.forEach((emp) => {
  batch.create(finDb.collection("expenses").doc(docId(emp)), expenseDoc(emp));
});
await batch.commit();

const verifySnaps = await readExisting();
const missing = verifySnaps.filter((snap) => !snap.exists);
if (missing.length > 0) throw new Error(`Falha na verificação: ${missing.length} despesa(s) não foram criadas.`);

console.log(`8 despesas de salário (competência 08/2026) criadas com sucesso em financeiro/expenses. Total líquido: R$ ${totalNet.toFixed(2)}.`);
