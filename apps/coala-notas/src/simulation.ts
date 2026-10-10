import type { LocalPurchaseContext, OpenWithdrawal, ReceiptAnalysis } from "./upload";

export const simulationContext: LocalPurchaseContext = {
  units: [{ id: "simulation-unit", name: "Unidade de simulação" }],
  accounts: [
    { id: "simulation-supplies", name: "Insumos e matérias-primas" },
    { id: "simulation-cleaning", name: "Material de limpeza" },
  ],
  resultCenters: [{ id: "simulation-result", name: "Operação · Simulação", unitId: "simulation-unit" }],
  products: [
    { id: "simulation-milk", name: "Leite integral · 1 L", packageLabel: "caixa" },
    { id: "simulation-sugar", name: "Açúcar refinado · 1 kg", packageLabel: "pacote" },
  ],
};

export function createSimulationAnalysis(): ReceiptAnalysis {
  return {
    supplierName: "Fornecedor de simulação",
    supplierTaxId: null,
    purchaseDate: new Date().toISOString().slice(0, 10),
    amountCents: 1200,
    confidence: "low",
    suggestedAccountId: "simulation-supplies",
    items: [{ description: "Leite integral 1L", quantity: 2, unit: "un", unitPriceCents: 600, totalCents: 1200, productId: "simulation-milk", packages: 2 }],
    payment: null,
    warnings: [],
  };
}

export function createSimulationWithdrawals(): OpenWithdrawal[] {
  const date = new Date().toISOString().slice(0, 10);
  return [
    { sourceId: "simulation-withdrawal-1", unitId: "simulation-unit", unitName: "Unidade de simulação", date, time: "10:42", amountCents: 5000, operatorName: "Operador de simulação" },
    { sourceId: "simulation-withdrawal-2", unitId: "simulation-unit", unitName: "Unidade de simulação", date, time: "15:10", amountCents: 1200, operatorName: "Operador de simulação" },
  ];
}
