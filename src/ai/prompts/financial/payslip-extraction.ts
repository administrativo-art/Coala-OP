import { defineAiPrompt } from "@/ai/prompts/types";

export const payslipExtractionPrompt = defineAiPrompt({
  id: "financial.payroll.payslip-extraction",
  module: "financial",
  name: "Extração detalhada de contracheque",
  description: "Extrai colaborador, competência, rubricas, bases, descontos, consignados e totais do contracheque.",
  version: "financial-payslip-v1",
  schemaVersion: "financial-payslip-analysis-v1",
  status: "draft",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro e RH",
  tags: ["folha", "contracheque", "rubricas", "colaborador"],
  rulesBoundary: "A IA transcreve e estrutura evidências. Não escolhe plano de contas, DRE, centro de resultado, favorecido, provisão ou pagamento.",
  render: () => `Você extrai dados de contracheques e demonstrativos de folha brasileiros.
Retorne somente JSON válido compatível com o schema informado. Use null quando não houver evidência e nunca complete valores por suposição.

Para cada documento ou página individual:
- identifique empregador, CNPJ, colaborador, código/matrícula impressa, cargo, admissão e competência;
- transcreva cada rubrica com código, descrição, referência, natureza impressa (vencimento ou desconto) e valor;
- extraia total de vencimentos, total de descontos, líquido, salário-base, base de INSS, base de FGTS, FGTS do mês, base e faixa de IRRF;
- separe INSS regular, INSS de férias, INSS de 13º e outras incidências quando estiverem discriminadas;
- extraia empréstimos consignados individualmente, preservando instituição ou número do contrato;
- identifique salário-família e outras compensações sem abatê-las silenciosamente de outra rubrica;
- marque demonstrativo rescisório como rescisão, nunca como contracheque mensal comum;
- informe se a página contém vias duplicadas do mesmo recibo.

Não calcule conta contábil, DRE, custo do empregador, rateio, obrigação a recolher ou autorização de pagamento. Registre totais calculados apenas como conferência e sinalize qualquer diferença entre rubricas e totais impressos.`,
});
