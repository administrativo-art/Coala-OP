import { defineAiPrompt } from "@/ai/prompts/types";

export type FinancialInboxDocumentExtractionPromptContext = {
  emailSubject: string;
  senderDomain: string | null;
  deterministicText: string | null;
};

export const financialInboxDocumentExtractionPrompt = defineAiPrompt<FinancialInboxDocumentExtractionPromptContext>({
  id: "financial.inbox-document-extraction",
  module: "financial",
  name: "Extração de documentos da caixa de cobranças",
  description: "Extrai evidências estruturadas de boletos, faturas, contas e guias recebidas por e-mail.",
  version: "financial-inbox-document-v1",
  schemaVersion: "financial-inbox-document-extraction-v1",
  status: "active",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro",
  tags: ["cobrança", "boleto", "fatura", "OCR", "auditoria"],
  rulesBoundary: "A análise apenas extrai evidências para revisão humana; nunca cria despesa, vincula cobrança ou prepara pagamento.",
  render: ({ emailSubject, senderDomain, deterministicText }) => `Analise o documento financeiro recebido e retorne somente os campos comprovados visualmente ou no texto.

REGRAS
- Não invente nem complete números ausentes.
- Não escolha plano de contas, centro de resultado, despesa de destino ou decisão bancária.
- amountCents deve conter o valor total cobrado em centavos, como inteiro.
- dueDate usa YYYY-MM-DD e competence usa YYYY-MM.
- barcode contém somente os 44, 46, 47 ou 48 dígitos da linha digitável/código de barras.
- supplierTaxId é o CNPJ do beneficiário/fornecedor, não o CNPJ do cliente pagador.
- customerAccount é o identificador da conta do cliente junto ao fornecedor.
- contractNumber é o contrato da prestação do serviço.
- serviceNumbers contém somente linhas/terminais cobrados. Não inclua telefone de atendimento, SAC, vendas, WhatsApp ou contato do fornecedor.
- Para telefonia, use serviceType mobile ou landline; para banda larga use internet.
- Se o documento consolidar várias linhas, retorne todas as linhas comprovadas.
- documentText deve ser uma transcrição curta das áreas que sustentam os campos, limitada a 12.000 caracteres.
- Use null ou lista vazia quando não houver evidência.

CONTEXTO DO E-MAIL
Assunto: ${String(emailSubject ?? "").slice(0, 500)}
Domínio do remetente: ${senderDomain || "não identificado"}
${deterministicText ? `\nTEXTO JÁ EXTRAÍDO\n${deterministicText.slice(0, 30000)}` : ""}`,
});
