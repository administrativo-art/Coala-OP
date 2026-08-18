import { defineAiPrompt } from "@/ai/prompts/types";

export const payrollGuideExtractionPrompt = defineAiPrompt({
  id: "financial.payroll.guide-extraction",
  module: "financial",
  name: "Extração de guia de encargos da folha",
  description: "Extrai FGTS, INSS, consignados, compensações e memória por trabalhador de guias vinculadas à folha.",
  version: "financial-payroll-guide-v1",
  schemaVersion: "financial-payroll-guide-analysis-v1",
  status: "draft",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro e RH",
  tags: ["FGTS", "INSS", "consignado", "guia", "folha"],
  rulesBoundary: "A IA estrutura a guia e a memória. O sistema valida pessoas, contas, DRE, centros, contratos, fechamento e favorecido bancário.",
  render: () => `Você extrai dados de guias relacionadas à folha: FGTS Digital, DARF previdenciário, INSS, consignados e guias combinadas.
Retorne somente JSON válido compatível com o schema informado e preserve a terminologia impressa.

Extraia:
- tipo da guia, empregador, CNPJ, competência, vencimento, identificador, arrecadador e total;
- componentes da guia e sua natureza aparente, sem classificar contabilmente;
- memória por trabalhador, incluindo nome, CPF mascarado quando disponível, matrícula, base, valor e referência ao contrato;
- FGTS patronal separado de empréstimo consignado quando coexistirem na mesma guia;
- INSS retido, eventual parcela patronal e compensações como salário-família, sempre em campos separados;
- contratos de consignado em linhas próprias, mesmo quando pertencerem ao mesmo colaborador;
- totais bruto, compensações e líquido recolhível.

Confira fechamento por componente, pessoa e total. Não transforme trabalhadores em favorecidos bancários da guia e não decida DRE, passivo, rateio, provisão ou pagamento.`,
});
