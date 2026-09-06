import { createPaymentRequest } from "../src/features/financial/payment-requests/service.server";
import { findPaymentRequestBySource } from "../src/features/financial/payment-requests/repository.server";

const ACTOR = {
  uid: "claude-code:payroll-launch-20260905",
  email: null,
  name: "Claude Code (lançamento de folha 08/2026, sob supervisão de Tiago Brasil)",
};

// employeeId aqui é o ID do documento em coala-rh/employees (usado pelo resolvedor de
// favorecido) — não é o UID do Firebase Auth. Para a Thaise, o hrEmployeeId dela É o
// próprio UID (registro duplicado no RH); para os demais é o ID numérico do Bizneo.
const EMPLOYEES = [
  { name: "Aliny Rodrigues da Silva", net: 1543.53, employeeId: "18688727", expenseId: "salary_202608_kjveCeNGKwbY9C4c4ji86JJbXQz2" },
  { name: "Carliane Sousa Ramos", net: 1537.33, employeeId: "17044767", expenseId: "salary_202608_Yv9V1cqvG0QaqA8xOZ0qzgdatTl1" },
  { name: "Heucilene Oliveira Ribeiro", net: 1492.19, employeeId: "17021666", expenseId: "salary_202608_fvrLOh1JOIOtU5QhZQZydN3UBf22" },
  { name: "Maria Edna Gois Ribeiro", net: 1345.33, employeeId: "17021665", expenseId: "salary_202608_hMNJ5lSn51MKne6nDakYhUDqEUS2" },
  { name: "Maria Joana Barbosa Pereira", net: 1044.10, employeeId: "17044771", expenseId: "salary_202608_T268zeSgq8QMGAJPph7YrOCzbrD2" },
  { name: "Samila Valesca Cardoso", net: 1613.29, employeeId: "18546102", expenseId: "salary_202608_oHTdeGUJ77S1rUBbqgQp7YcpuIn1" },
  { name: "Sara Ferreira Coelho", net: 1543.53, employeeId: "18681052", expenseId: "salary_202608_FzliQXBLykURpu9CxL8EzoAe4Xq1" },
  { name: "Thaise Correia Marinho", net: 346.13, employeeId: "iBINjsq011a3F266sP9kMI5zd2R2", expenseId: "salary_202608_iBINjsq011a3F266sP9kMI5zd2R2" },
];

const APPLY = process.argv.includes("--apply");

async function main() {
  for (const emp of EMPLOYEES) {
    console.log(`\n=== ${emp.name} — R$ ${emp.net.toFixed(2)} ===`);
    const existing = await findPaymentRequestBySource("salary" as any, emp.expenseId);
    if (existing) {
      console.log(`Já existe uma solicitação (id ${existing.id}, status ${existing.status}) — não vou duplicar.`);
      continue;
    }
    const payload = {
      sourceType: "salary" as any,
      sourceId: emp.expenseId,
      expenseId: emp.expenseId,
      beneficiaryReference: { sourceType: "employee" as const, sourceId: emp.employeeId },
      amount: emp.net,
      description: `Salário - 08/2026 | ${emp.name}`,
    };
    if (!APPLY) {
      console.log("dry-run — criaria:", JSON.stringify(payload, null, 2));
      continue;
    }
    const request = await createPaymentRequest(payload, ACTOR);
    console.log(`Criado: id=${request.id} status=${request.status} favorecido=${request.beneficiarySnapshot?.name} destino=${request.beneficiarySnapshot?.maskedPaymentDestination}`);
  }
  console.log(APPLY
    ? "\nPronto. As solicitações estão em 'awaiting_financial_authorization' — precisam ser autorizadas e enviadas manualmente na tela Financeiro > Pagamentos."
    : "\nDry-run concluído. Rode com --apply para criar de verdade.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
