export type ImportAuditChange = {
  field: string;
  label: string;
  previousValue: string;
  nextValue: string;
};

export type ImportAuditSnapshot = {
  values: Record<string, string>;
};

type FieldDefinition = {
  field: string;
  label: string;
  read: (item: Record<string, unknown>) => unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return String(value);
  return String(value).trim() || "Não informado";
}

function summarizeApportionments(value: unknown) {
  const entries = asArray(value).map(asRecord);
  if (entries.length === 0) return "Não informado";
  return entries
    .map((entry) => `${displayValue(entry.resultCenterName)} (${displayValue(entry.percentage)}%)`)
    .join("; ");
}

function summarizeAccountAllocations(value: unknown) {
  const entries = asArray(value).map(asRecord);
  if (entries.length === 0) return "Não informado";
  return entries
    .map((entry) => `${displayValue(entry.accountPlanName)} (R$ ${displayValue(entry.amount)})`)
    .join("; ");
}

function summarizePersonAllocations(value: unknown) {
  const entries = asArray(value).map(asRecord);
  if (entries.length === 0) return "Não informado";
  return entries
    .map((entry) => {
      const analysisType = entry.analysisType === "employer_cost"
        ? "Custo da empresa"
        : entry.analysisType === "employee_deduction"
        ? "Desconto do colaborador"
        : "Informativo";
      return [
        displayValue(entry.employeeName),
        displayValue(entry.accountPlanName),
        analysisType,
        displayValue(entry.resultCenterName ?? entry.resultCenter),
        entry.payrollDocumentId ? `documento RH ${displayValue(entry.payrollDocumentId)}` : null,
        entry.contractReference ? displayValue(entry.contractReference) : null,
        `R$ ${displayValue(entry.amount)}`,
      ].filter(Boolean).join(" · ");
    })
    .join("; ");
}

function summarizeSplitExpenses(value: unknown) {
  const entries = asArray(value).map(asRecord);
  if (entries.length === 0) return "Não informado";
  return entries
    .map((entry) => {
      const allocation = Number(entry.percentage) > 0
        ? `${displayValue(entry.percentage)}%`
        : `R$ ${displayValue(entry.value)}`;
      return [
        displayValue(entry.description),
        displayValue(entry.supplier),
        displayValue(entry.resultCenterName),
        `competência ${displayValue(entry.competenceDate)}`,
        `vencimento ${displayValue(entry.dueDate)}`,
        allocation,
      ].join(" · ");
    })
    .join("; ");
}

const FIELD_DEFINITIONS: FieldDefinition[] = [
  { field: "financial.date", label: "Data no extrato", read: (item) => item.date },
  { field: "financial.description", label: "Descrição original do extrato", read: (item) => item.rawDescription },
  { field: "financial.account", label: "De onde saiu/onde entrou", read: (item) => asRecord(item.financialDraft).accountName },
  { field: "financial.method", label: "Como saiu/entrou", read: (item) => asRecord(item.financialDraft).paymentMethodLabel },
  { field: "financial.kind", label: "Tipo de movimentação", read: (item) => asRecord(item.financialDraft).movementKind },
  { field: "financial.counterpartyAccount", label: "Conta de destino", read: (item) => asRecord(item.financialDraft).counterpartyAccountName },
  { field: "financial.counterpartyMethod", label: "Forma de entrada no destino", read: (item) => asRecord(item.financialDraft).counterpartyPaymentMethodLabel },
  { field: "financial.notes", label: "Observações da movimentação", read: (item) => asRecord(item.financialDraft).notes },
  { field: "expense.mode", label: "Tratamento da despesa", read: (item) => asRecord(item.expenseDraft).mode },
  { field: "expense.linkedExpense", label: "Despesa vinculada", read: (item) => asRecord(item.expenseDraft).linkedExpenseId },
  { field: "expense.purchase", label: "Compra vinculada", read: (item) => asRecord(item.expenseDraft).purchaseOrderId },
  { field: "expense.purchaseMode", label: "Tratamento da compra", read: (item) => asRecord(item.expenseDraft).purchaseLinkMode },
  { field: "expense.allocatedAmount", label: "Valor alocado", read: (item) => asRecord(item.expenseDraft).allocatedAmount },
  { field: "expense.settlementBaseValue", label: "Valor principal baixado", read: (item) => asRecord(item.expenseDraft).settlementBaseValue },
  { field: "expense.settlementInstallment", label: "Parcela baixada", read: (item) => asRecord(item.expenseDraft).settlementInstallmentNumber },
  { field: "expense.interest", label: "Juros", read: (item) => asRecord(item.expenseDraft).interest },
  { field: "expense.fine", label: "Multa", read: (item) => asRecord(item.expenseDraft).fine },
  { field: "expense.chargesAccountPlan", label: "Plano dos encargos", read: (item) => asRecord(item.expenseDraft).chargesAccountPlanName },
  { field: "expense.description", label: "Descrição da despesa", read: (item) => asRecord(item.expenseDraft).description },
  { field: "expense.supplier", label: "Fornecedor", read: (item) => asRecord(item.expenseDraft).supplier },
  { field: "expense.accountPlan", label: "Plano de contas", read: (item) => asRecord(item.expenseDraft).accountPlanName },
  { field: "expense.accountAllocations", label: "Apropriações contábeis", read: (item) => summarizeAccountAllocations(asRecord(item.expenseDraft).accountAllocations) },
  { field: "expense.personAllocations", label: "Individualização por colaborador", read: (item) => summarizePersonAllocations(asRecord(item.expenseDraft).personAllocations) },
  { field: "expense.resultCenter", label: "Unidade", read: (item) => asRecord(item.expenseDraft).resultCenterName },
  { field: "expense.apportionments", label: "Rateio entre unidades", read: (item) => summarizeApportionments(asRecord(item.expenseDraft).apportionments) },
  { field: "expense.splitMode", label: "Forma da divisão", read: (item) => asRecord(item.expenseDraft).splitAllocationMode },
  { field: "expense.splits", label: "Despesas divididas", read: (item) => summarizeSplitExpenses(asRecord(item.expenseDraft).splitExpenses) },
  { field: "expense.competence", label: "Competência", read: (item) => asRecord(item.expenseDraft).competenceDate },
  { field: "expense.dueDate", label: "Vencimento original", read: (item) => asRecord(item.expenseDraft).dueDate },
  { field: "expense.notes", label: "Observações da despesa", read: (item) => asRecord(item.expenseDraft).notes },
];

export function buildImportAuditSnapshot(item: unknown): ImportAuditSnapshot {
  const record = asRecord(item);
  return {
    values: Object.fromEntries(
      FIELD_DEFINITIONS.map((definition) => [
        definition.field,
        displayValue(definition.read(record)),
      ])
    ),
  };
}

export function diffImportAuditSnapshots(
  previous: ImportAuditSnapshot | null | undefined,
  next: ImportAuditSnapshot
): ImportAuditChange[] {
  if (!previous) return [];
  return FIELD_DEFINITIONS.flatMap((definition) => {
    const previousValue = displayValue(previous.values?.[definition.field]);
    const nextValue = displayValue(next.values?.[definition.field]);
    return previousValue === nextValue
      ? []
      : [{ field: definition.field, label: definition.label, previousValue, nextValue }];
  });
}
