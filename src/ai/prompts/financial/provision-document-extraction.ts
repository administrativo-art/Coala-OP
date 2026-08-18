import { defineAiPrompt } from "@/ai/prompts/types";

export const provisionDocumentExtractionPrompt = defineAiPrompt({
  id: "financial.provision.document-extraction",
  module: "financial",
  name: "Extração de documento para conciliação de provisão",
  description: "Extrai competência, vencimento, favorecido, total e evidências de correspondência de documentos financeiros diversos.",
  version: "financial-provision-document-v1",
  schemaVersion: "financial-provision-document-analysis-v1",
  status: "draft",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro",
  tags: ["provisão", "conciliação", "documento", "recorrência"],
  rulesBoundary: "A IA sugere evidências de correspondência. O sistema determina a chave da série, resolve ambiguidade e substitui a provisão somente após validações.",
  render: () => `Você extrai dados objetivos de um documento financeiro que poderá substituir uma provisão.
Retorne somente JSON válido compatível com o schema informado. Não declare uma conciliação como concluída.

Extraia tipo documental, emissor/favorecido, CNPJ/CPF quando visível, competência, emissão, vencimento, número do documento, total, multa, juros, parcelas e descrição dos componentes.
Informe evidências de correspondência com uma série recorrente: mesma competência, mesmo favorecido, mesmo contrato, mesmo identificador ou mesma natureza documental.
Quando houver mais de uma competência, favorecido ou documento no arquivo, marque a estrutura como múltipla e mantenha cada item separado.

Não escolha conta contábil, DRE, centro de resultado, status, provisão vencedora ou pagamento. Use null e revisão humana quando não houver evidência suficiente.`,
});
