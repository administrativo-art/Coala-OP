import { defineAiPrompt } from "@/ai/prompts/types";

export type MobilePurchaseExtractionPromptContext = {
  fundingSource: "cash_withdrawal" | "company_payment";
  /** Contas liberadas para compra local; a IA só pode sugerir uma delas. */
  accounts?: Array<{ id: string; name: string }>;
  /** Produtos com entrada de estoque; a IA só pode sugerir um deles por item. */
  products?: Array<{ id: string; name: string; packageLabel: string }>;
};

export const mobilePurchaseExtractionPrompt = defineAiPrompt<MobilePurchaseExtractionPromptContext>({
  id: "financial.mobile-purchase-extraction",
  module: "financial",
  name: "Extração conjunta de compra local",
  description: "Extrai uma nota de compra e, quando obrigatório, cruza seu comprovante de pagamento.",
  version: "mobile-purchase-v4",
  schemaVersion: "mobile-purchase-extraction-v1",
  status: "active",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro",
  tags: ["compra local", "nota", "comprovante", "OCR", "auditoria"],
  rulesBoundary: "A análise apenas sugere dados para revisão humana; não registra compra, pagamento, despesa ou movimento de estoque.",
  render: ({ fundingSource, accounts = [], products = [] }) => `Analise os documentos identificados explicitamente como NOTA DE COMPRA e COMPROVANTE DE PAGAMENTO.

REGRAS OBRIGATÓRIAS
- Um documento pode chegar em até duas imagens (nota longa, frente e verso). Trate-as como um único documento: una os itens na ordem, não repita itens que aparecem nas duas imagens e não some o total duas vezes.
- Nunca use o comprovante para inventar fornecedor, itens ou data da nota.
- Extraia fornecedor, CNPJ, data, total e itens exclusivamente da NOTA DE COMPRA.
- O total e a soma dos itens devem usar centavos inteiros. Use null quando não estiver comprovado.
- O meio de pagamento vem exclusivamente do COMPROVANTE DE PAGAMENTO.
- Classifique o meio como pix, card_credit, card_debit, cash, boleto, term ou unknown.
- Se não for possível distinguir crédito de débito, use unknown; não adivinhe.
- Compare valor e favorecido dos dois documentos. A comparação pode ser true, false ou null quando inconclusiva.
- transactionId deve conter somente o identificador comprovado da transação, limitado a 120 caracteres.
- Retorne alertas curtos para divergência, documento ilegível ou evidência insuficiente.
- A origem informada é ${fundingSource}. Para cash_withdrawal, payment deve ser null e não existe comprovante.
- Para company_payment, analise obrigatoriamente os dois documentos, mas mantenha cada evidência em seu papel.
- Compras locais costumam ser de insumos de consumação, material de limpeza ou utensílios, mas qualquer categoria da lista pode ser a correta; não há frete.
- Em suggestedAccountId, sugira a categoria que melhor descreve os itens, usando exatamente um id da lista CATEGORIAS abaixo. Se a nota misturar categorias, use a de maior valor e registre um alerta. Use null quando a lista estiver vazia ou nenhuma categoria servir.
- Para cada item, se ele corresponder a um produto da lista PRODUTOS DE ESTOQUE, informe em productId exatamente o id e em packages quantas embalagens desse produto a linha representa (ex.: nota com 2 un de leite 1 L e produto "Leite · 1 L" → packages 2). Compare nome, marca e tamanho da embalagem; se o tamanho não bater ou houver dúvida, use null nos dois campos. Item sem produto correspondente é consumo direto: productId e packages null.
- A categoria é apenas uma sugestão: a IA não decide conta contábil, centro de resultado, unidade, entrada em estoque nem baixa de pagamento; a revisão humana confirma ou troca.
- Esta é uma sugestão para revisão humana e nunca uma autorização de pagamento.

CATEGORIAS (id — nome)
${accounts.length ? accounts.map((account) => `${account.id} — ${account.name}`).join("\n") : "(nenhuma categoria disponível)"}

PRODUTOS DE ESTOQUE (id — nome · embalagem)
${products.length ? products.map((product) => `${product.id} — ${product.name} (${product.packageLabel})`).join("\n") : "(nenhum produto disponível)"}`,
});
