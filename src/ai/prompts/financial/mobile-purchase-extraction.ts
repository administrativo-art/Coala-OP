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
  description: "Classifica o documento de compra, extrai seus dados e cruza eventual comprovante de pagamento.",
  version: "mobile-purchase-v9",
  schemaVersion: "mobile-purchase-extraction-v5",
  status: "active",
  risk: "high",
  outputMode: "structured",
  owner: "Financeiro",
  tags: ["compra local", "nota", "comprovante", "OCR", "auditoria"],
  rulesBoundary: "A análise apenas sugere dados para revisão humana; não registra compra, pagamento, despesa ou movimento de estoque.",
  render: ({ fundingSource, accounts = [], products = [] }) => `Analise os documentos identificados explicitamente como NOTA DE COMPRA e COMPROVANTE DE PAGAMENTO.

REGRAS OBRIGATÓRIAS
- Um documento pode chegar em até duas imagens (nota longa, frente e verso). Trate-as como um único documento: una os itens na ordem, não repita itens que aparecem nas duas imagens e não some o total duas vezes.
- Classifique apenas as imagens rotuladas NOTA DE COMPRA em purchaseDocumentKind: nfe_or_danfe para NF-e/DANFE de compra, nfce para NFC-e/DANFE NFC-e (cupom fiscal eletrônico), coupon_or_receipt para cupom não fiscal, comprovante de venda ou recibo, unknown quando a natureza não estiver clara. O rótulo do anexo, nome do arquivo, observação do operador e comprovante de pagamento não são evidência fiscal.
- Informe fiscalAuthorizationStatus: authorized somente quando o próprio documento trouxer protocolo de autorização legível com 15 dígitos; pending quando disser contingência pendente de autorização, aguardando autorização, rejeitada ou situação equivalente ainda não autorizada; unknown quando não for possível comprovar o estado. Copie em fiscalAuthorizationEvidence um trecho literal curto que contenha "Protocolo de Autorização" e todos os 15 dígitos, sem reticências, completar números ocultos ou inventar texto; use null se nenhum trecho legível existir. Chave de acesso, QR Code ou aparência de DANFE/NFC-e isolados não provam autorização. Se houver indicação de contingência pendente em qualquer imagem do documento, use pending mesmo que outra parte pareça autorizada.
- Informe purchaseDocumentKindConfidence como high somente com sinais fiscais inequívocos e legíveis; se faltar legibilidade ou houver dúvida, use medium ou low. Compra normal sem comprovante só prossegue com nfe_or_danfe ou nfce, confiança high e fiscalAuthorizationStatus authorized.
- Nunca use o comprovante para inventar fornecedor, itens ou data da nota.
- Extraia fornecedor, CNPJ, data, total e itens exclusivamente da NOTA DE COMPRA.
- O total e a soma dos itens devem usar centavos inteiros. Use null quando não estiver comprovado.
- O meio de pagamento vem exclusivamente do COMPROVANTE DE PAGAMENTO.
- Classifique o meio como pix, card_credit, card_debit, cash, boleto, term ou unknown.
- Se não for possível distinguir crédito de débito, use unknown; não adivinhe.
- Compare valor e favorecido dos dois documentos. A comparação pode ser true, false ou null quando inconclusiva.
- transactionId deve conter somente o identificador comprovado da transação, limitado a 120 caracteres.
- Retorne alertas curtos para divergência, documento ilegível ou evidência insuficiente.
- Se fiscalAuthorizationStatus for pending, inclua em warnings um aviso explícito de autorização fiscal pendente, mesmo quando houver comprovante de pagamento.
- A origem informada é ${fundingSource}. Para cash_withdrawal, payment deve ser null e não existe comprovante.
- Para company_payment, o comprovante pode estar ausente apenas com documento fiscal autorizado e identificado com confiança high. Quando houver comprovante, mantenha cada evidência em seu papel; sem ele, payment deve ser null.
- Compras locais costumam ser de insumos de consumação, material de limpeza ou utensílios, mas qualquer categoria da lista pode ser a correta; não há frete.
- Em suggestedAccountId, sugira a categoria que melhor descreve os itens, usando exatamente um id da lista CATEGORIAS abaixo. Se a nota misturar categorias, use a de maior valor e registre um alerta. Use null quando a lista estiver vazia ou nenhuma categoria servir.
- Para cada item, classifique aiTreatment em: existing_item quando houver correspondência exata na lista de produtos; item_not_found quando for um insumo, material, utensílio ou mercadoria que deveria ter cadastro, mas não houver correspondência exata; asset_candidate quando for um bem durável e reutilizável que possa exigir controle patrimonial; immediate_use somente quando o item for integralmente consumido/aplicado nesta compra e não fizer sentido controlar saldo ou patrimônio; needs_review quando a destinação não estiver clara.
- Item não encontrado nunca é sinônimo de uso imediato. Na dúvida entre item_not_found, asset_candidate e immediate_use, use needs_review.
- Informe aiConfidence e uma aiReason curta baseada na descrição, durabilidade, forma de uso, valor e histórico disponível. A IA apenas sugere; patrimônio e cadastro novo permanecem pendentes de revisão no sistema web.
- Quando aiTreatment for existing_item, informe em productId exatamente o id e em packages quantas embalagens a linha representa (ex.: nota com 2 un de leite 1 L e produto "Leite · 1 L" → packages 2). Compare nome, marca e tamanho; se não houver correspondência exata, productId e packages devem ser null e aiTreatment não pode ser existing_item.
- A categoria é apenas uma sugestão: a IA não decide conta contábil, centro de resultado, unidade, entrada em estoque nem baixa de pagamento; a revisão humana confirma ou troca.
- Esta é uma sugestão para revisão humana e nunca uma autorização de pagamento.

CATEGORIAS (id — nome)
${accounts.length ? accounts.map((account) => `${account.id} — ${account.name}`).join("\n") : "(nenhuma categoria disponível)"}

PRODUTOS DE ESTOQUE (id — nome · embalagem)
${products.length ? products.map((product) => `${product.id} — ${product.name} (${product.packageLabel})`).join("\n") : "(nenhum produto disponível)"}`,
});
