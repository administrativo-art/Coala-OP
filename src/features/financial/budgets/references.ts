import { BudgetDomainError } from "./errors";

export function assertBudgetEmployeeEligible(employee: {
  exists: boolean; status: unknown; name: unknown; admissionDate: string | null; hasTerminationProcess: boolean; opIsActive?: unknown;
}, month: string) {
  const date = employee.admissionDate;
  if (!employee.exists || employee.status !== "active" || employee.opIsActive === false || typeof employee.name !== "string" || !employee.name.trim()) {
    throw new BudgetDomainError("A composição contém colaborador inexistente ou inativo. Revise as referências selecionadas.");
  }
  const parsedDate = date ? new Date(`${date}T12:00:00Z`) : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date || date.slice(0, 7) > month) {
    throw new BudgetDomainError("Falta admissão confiável e compatível com a competência de um colaborador.");
  }
  if (employee.hasTerminationProcess) throw new BudgetDomainError("Há desligamento em andamento. Revise a composição antes de gerar o mês.");
}

export function assertCanonicalBudgetPersonLink(input: {
  requestedId: string; userId: string | null; employeeId: string | null; linkedUserIds: unknown[];
}) {
  if (input.requestedId !== input.userId || !input.employeeId || input.linkedUserIds.some((value) => value && value !== input.userId)) {
    throw new BudgetDomainError("Selecione o ID OP com vínculo único e compatível no RH.");
  }
}
