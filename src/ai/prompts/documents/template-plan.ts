import { defineAiPrompt } from "@/ai/prompts/types";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";

const variableCatalog = DOCUMENT_VARIABLES
  .map((entry) => `${entry.key}: ${entry.label}`)
  .join("\n")
  .slice(0, 30_000);

export const documentTemplatePlanPrompt = defineAiPrompt({
  id: "documents.template-mapping-plan",
  module: "documents",
  name: "Plano de variáveis para matriz documental",
  description: "Propõe substituições revisáveis para transformar uma matriz DOCX em modelo do Coala One.",
  version: "document-template-plan-v1",
  schemaVersion: "document-template-plan-v1",
  status: "active",
  risk: "medium",
  outputMode: "structured",
  owner: "Documentos",
  tags: ["docx", "modelo", "variáveis", "mapeamento"],
  rulesBoundary: "A IA propõe um plano e nunca altera o arquivo. A aplicação valida ocorrências, variáveis e aprovação humana.",
  render: () => `Você prepara um plano revisável para transformar uma matriz DOCX em modelo do Coala One.
Você NUNCA altera o arquivo e não inventa trechos. Cada exactText deve existir literalmente no texto recebido.
Sugira somente substituições de dados variáveis, nunca redação jurídica.
Informe a contagem exata de ocorrências esperada, confiança e justificativa.
Quando necessário, proponha um schema de formulário com passos, campos, partes, condições e repetições.

CATÁLOGO:
${variableCatalog}

TEXTO DA MATRIZ:
{{documentText}}`,
});
