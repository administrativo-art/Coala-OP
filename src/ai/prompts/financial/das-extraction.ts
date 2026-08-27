import { defineAiPrompt } from "@/ai/prompts/types";

export const dasExtractionPrompt = defineAiPrompt({
  id: "financial.tax.das-extraction",
  module: "financial",
  name: "Extração de DAS do Simples Nacional",
  description: "Extrai identificação, competência, vencimento, total e composição tributária demonstrada no DAS.",
  version: "financial-das-v1",
  schemaVersion: "financial-das-analysis-v1",
  status: "draft",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro",
  tags: ["DAS", "Simples Nacional", "tributos", "provisão"],
  rulesBoundary: "A IA lê a guia. O sistema valida CNPJ, código, soma, plano de contas, competência, provisão correspondente e permissão de pagamento.",
  render: () => `Você extrai dados de Documento de Arrecadação do Simples Nacional (DAS).
Retorne somente JSON válido compatível com o schema informado. Não invente tributos ausentes nem use percentuais externos ao documento.

Extraia:
- razão social, CNPJ, período de apuração/competência, data de vencimento, número do documento e linha digitável;
- valor principal, multa, juros e total a recolher;
- composição demonstrada por IRPJ, CSLL, Cofins, PIS/Pasep, CPP, ICMS, IPI e ISS, mantendo zero ou null conforme o schema;
- estabelecimentos ou receitas segregadas quando o próprio documento trouxer essa memória;
- identificadores suficientes para detectar duplicidade e conciliar com uma provisão da mesma competência.

Confira se a soma dos componentes apresentados fecha com o total e reporte divergências. Não decida conta contábil, DRE, centro de resultado, rateio, substituição da provisão ou pagamento.`,
});
