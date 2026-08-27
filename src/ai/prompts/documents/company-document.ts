import { defineAiPrompt } from "@/ai/prompts/types";
import { COMPANY_DOCUMENT_CATEGORIES } from "@/lib/documents/company-document-categories";

export type CompanyDocumentPromptContext = {
  knownUnits: string[];
};

export const companyDocumentPrompt = defineAiPrompt<CompanyDocumentPromptContext>({
  id: "documents.company-document-analysis",
  module: "documents",
  name: "Análise de documento da empresa",
  description: "Classifica documentos administrativos e sugere nome, detalhe e unidade com base em catálogo fechado.",
  version: "company-document-v2",
  schemaVersion: "company-document-analysis-v2",
  status: "active",
  risk: "medium",
  outputMode: "structured",
  owner: "Documentos",
  tags: ["documento", "empresa", "classificação", "unidade"],
  rulesBoundary: "A IA sugere classificação e unidade. O sistema controla categorias válidas, acesso, persistência e revisão humana.",
  render: ({ knownUnits }) => [
    "Você analisa documentos administrativos de uma empresa brasileira (sorveteria com múltiplas unidades/filiais) para padronizar o arquivamento.",
    "Retorne somente JSON válido, sem markdown. A saída é validada por JSON Schema rígido.",
    "Use exclusivamente uma categoria do catálogo fechado abaixo. Se não houver evidência segura, use \"A classificar\". Não existe categoria \"Unidades\": um documento de uma filial específica (ex.: inscrição estadual, alvará, contrato de locação de uma loja) é classificado pela natureza dele (Licenças e autorizações, Contratos, Fiscal e contábil etc.) e a filial vai em suggestedUnit, não na categoria.",
    "O título final do documento no sistema segue o padrão \"Nome do documento - Detalhes\". Você preenche as duas partes separadamente:",
    "- documentName: o nome canônico e curto do TIPO de documento, sem detalhes específicos. Ex.: \"Contrato Social\", \"Inscrição Estadual\", \"Alvará de Funcionamento\", \"Contrato de Locação\". Use null se não for possível identificar.",
    "- documentDetail: um qualificador curto (máx. 60 caracteres) que distingue este documento de outros do mesmo tipo, ex.: \"Quarta alteração\", \"Renovação 2026\", \"Parcela 03\". NÃO inclua o nome de unidade/filial aqui - isso vai em suggestedUnit. Use null se não houver qualificador relevante.",
    "- suggestedUnit: preencha somente quando o documento pertencer especificamente a UMA unidade/filial (ex.: inscrição estadual de uma loja, alvará de uma loja, contrato de locação de um endereço). Documentos da empresa como um todo (ex.: contrato social, marca/INPI) devem usar null aqui.",
    knownUnits.length > 0
      ? `Unidades/filiais já cadastradas no sistema (use exatamente este texto quando identificar uma delas no documento): ${JSON.stringify(knownUnits)}. Se o documento mencionar claramente uma unidade que não está nesta lista, use o texto como aparece no documento.`
      : "Nenhuma unidade cadastrada foi encontrada como referência; se identificar uma unidade/filial no documento, use o texto como aparece nele.",
    "Não invente dados que não estão no documento.",
    "Catálogo fechado de categorias:",
    JSON.stringify(COMPANY_DOCUMENT_CATEGORIES),
    "Formato obrigatório:",
    JSON.stringify({
      category: "Societário",
      categoryConfidence: 0.9,
      documentName: "Contrato Social",
      documentDetail: "Quarta alteração",
      suggestedUnit: null,
      issues: [],
      warnings: [],
    }),
  ].join("\n\n"),
});
