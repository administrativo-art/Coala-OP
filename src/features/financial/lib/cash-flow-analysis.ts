import { format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

import { toDate } from "@/features/financial/lib/utils";

export type ExpenseLifecyclePoint = {
  key: string;
  month: string;
  provisioned: number;
  paid: number;
};

export type CashFlowExportMovement = {
  date: Date;
  description: string;
  supplier?: string;
  accountName?: string;
  accountPlanName?: string;
  competenceDate?: Date | null;
  dueDate?: Date | null;
  direction: "in" | "out";
  status: "realized" | "forecast";
  amount: number;
};

export function buildExpenseLifecycleData(
  expenses: any[],
  months: number,
  referenceDate = new Date()
): ExpenseLifecyclePoint[] {
  const safeMonths = Math.max(1, Math.floor(months) || 1);
  const points = new Map<string, ExpenseLifecyclePoint>();

  for (let index = safeMonths - 1; index >= 0; index -= 1) {
    const date = subMonths(referenceDate, index);
    const key = format(date, "yyyy-MM");
    points.set(key, {
      key,
      month: format(date, "MMM/yy", { locale: ptBR }),
      provisioned: 0,
      paid: 0,
    });
  }

  expenses.forEach((expense) => {
    if (["draft", "cancelled", "reconciled"].includes(expense.status)) return;
    const competence = toDate(expense.competenceDate) || toDate(expense.dueDate);
    if (!competence) return;
    const point = points.get(format(startOfMonth(competence), "yyyy-MM"));
    if (!point) return;

    const value = Number(expense.totalValue) || 0;
    point.provisioned += value;
    if (expense.status === "paid") point.paid += value;
  });

  return Array.from(points.values());
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function csvDate(value?: Date | null) {
  return value ? format(value, "dd/MM/yyyy") : "";
}

export function buildCashFlowCsv(movements: CashFlowExportMovement[]) {
  const header = [
    "Data",
    "Descrição",
    "Fornecedor",
    "Plano de contas",
    "Conta financeira",
    "Competência",
    "Vencimento",
    "Situação",
    "Direção",
    "Valor",
  ];
  const rows = movements.map((movement) => [
    csvDate(movement.date),
    movement.description,
    movement.supplier || "",
    movement.accountPlanName || "",
    movement.accountName || "",
    csvDate(movement.competenceDate),
    csvDate(movement.dueDate),
    movement.status === "realized" ? "Realizado" : "Previsto",
    movement.direction === "in" ? "Entrada" : "Saída",
    (Number(movement.amount) || 0).toFixed(2).replace(".", ","),
  ]);

  return `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n")}`;
}
