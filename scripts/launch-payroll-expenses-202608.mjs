import { Timestamp } from "firebase-admin/firestore";

import { reconcileExpenseProvisionOnServer } from "../src/features/financial/expense-provision-reconciliation.server.ts";
import { payrollExpenseDocumentId } from "../src/features/financial/lib/payroll-provisions.ts";
import { financialDbAdmin } from "../src/lib/firebase-financial-admin.ts";

const COMPETENCE_KEY = "2026-08";
const COMPETENCE = Timestamp.fromDate(new Date("2026-08-01T12:00:00-03:00"));
const DUE_DATE = Timestamp.fromDate(new Date("2026-09-05T12:00:00-03:00"));
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

if (ROLLBACK) {
  throw new Error("Rollback destrutivo desativado: salários conciliados devem preservar o histórico.");
}

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
    payrollEarningType: "salary",
    payrollIdentityKey: `payroll:salary:${COMPETENCE_KEY}:${emp.employeeId}`,
    provisionType: "actual",
    provisionCompetence: COMPETENCE_KEY,
    provisionSeriesKey: `payroll-salary:${emp.employeeId}`,
    provisionSource: "payslip",
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
  return payrollExpenseDocumentId(emp.employeeId, COMPETENCE_KEY, "salary");
}

async function readExisting() {
  const refs = EMPLOYEES.map((emp) => financialDbAdmin.collection("expenses").doc(docId(emp)));
  const snaps = await financialDbAdmin.getAll(...refs);
  return snaps;
}

const existing = await readExisting();
const alreadyPresent = existing.filter((snap) => snap.exists);

const totalNet = EMPLOYEES.reduce((sum, emp) => sum + emp.net, 0);

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  competencia: "08/2026",
  vencimento: "2026-09-05",
  contaContabil: `${ACCOUNT_NAME} (${ACCOUNT_ID})`,
  totalLiquido: Math.round(totalNet * 100) / 100,
  existingCount: alreadyPresent.length,
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

for (const emp of EMPLOYEES) {
  await reconcileExpenseProvisionOnServer(docId(emp), {
    uid: CREATED_BY,
    name: "Importador de holerites",
  }, {
    identity: {
      provisionSeriesKey: `payroll-salary:${emp.employeeId}`,
      provisionCompetence: COMPETENCE_KEY,
      provisionType: "actual",
    },
    createIfMissing: expenseDoc(emp),
  });
}

const verifySnaps = await readExisting();
const missing = verifySnaps.filter((snap) => !snap.exists);
if (missing.length > 0) throw new Error(`Falha na verificação: ${missing.length} despesa(s) não foram criadas.`);

console.log(`8 despesas de salário (competência 08/2026) garantidas sem duplicação. Total líquido: R$ ${totalNet.toFixed(2)}.`);
