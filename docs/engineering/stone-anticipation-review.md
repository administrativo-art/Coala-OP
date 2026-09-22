# Conferência Stone — primeira entrega, somente leitura

## Contrato e limites

Página `/dashboard/financial/stone-anticipations`; GET `/api/financial/stone-anticipations`.
Compara um dia de pagamentos com arquivos das vendas originais por StoneCode,
transação e parcela. Não filtra candidatos por MDR: campo ausente não significa
ausência de antecipação. Datas e valores incompatíveis, pagamentos parciais,
cancelamentos, chargebacks e origens ambíguas ficam pendentes.

Pagamento anterior ao vencimento é evidência de pagamento antecipado, não
confirmação da natureza contratual de um desconto ou do beneficiário bancário.
MDR vem do provedor. Desconto adicional = líquido original − líquido pago;
nunca classificar automaticamente como custo RAV. Cálculo em inteiros com escala
de 12 casas, apresentação em reais. Nulo não equivale a zero.

O layout 2.2 documenta `AdvanceRateAmount` e
`AdvancedReceivableOriginalPaymentDate` em FinancialTransactionsAccounts.
Esses campos são lidos diretamente, separados da diferença calculada. A
antecipação explícita exige ambos, pagamento anterior e origem consistente.
Diferença não explicada = bruto − líquido pago − MDR − custo informado;
ausência de qualquer taxa torna essa diferença desconhecida. Não representa uma
alíquota percentual e não há lançamento automático. A confirmação desses campos
nos arquivos reais ainda requer executar a versão atualizada no backend.

Fonte técnica: https://conciliacao.stone.com.br/reference/installments-ft-accounts

Não altera agenda, caixa ou DRE, não cria coleção, não importa despesas e não
marca conciliação bancária. Não é saldo da carteira. Credenciais somente no runtime
de servidor via referência existente ao Secret Manager. XML bruto não é exposto.

## Permissões e custo

Reutiliza a política administrativa da consulta de agenda: `isDefaultAdmin`
no servidor antes de chamar Stone; página e navegação restritas também no cliente.
Nenhuma permissão nova/migração. Abertura a usuários restritos depende de cadastro
oficial StoneCode/unidade e política de acesso por unidade, não de inferência.

Sem polling nem consulta automática na abertura. Cada consulta manual: até duas
leituras de autenticação no Firestore, zero escritas de negócio, até 32 GETs Stone
(pagamento + 31 datas originais), concorrência 2, orçamento global 110 s.
Preflight: 10 consultas/dia × 30 dias × 2 docs = até 600 leituras de autenticação/mês;
até 9.600 GETs Stone/mês nesse teto. Mais administradores multiplicam o custo.
Arquivos indisponíveis e datas excedentes são explicitados; não se presume zero.
Paginação visual de 50 parcelas, sem repetir chamadas ao provedor.

## Próximas entregas — não implementadas aqui

1. Obter contrato técnico e amostra autorizada RAV/Registradora (endpoints,
   autenticação, versão, UR, operação, beneficiário, cancelamento/reversão).
   A documentação pública consultada descreve a finalidade mas não apresenta
   esse contrato no índice atual. Não inventar endpoints ou rateio por venda.
2. Vincular operações confirmadas e antecipações parciais, preservar histórico,
   deduplicar por identificador/revisão oficial e reconciliar com o extrato.
3. Baixas e classificação de custos aprovadas, usando plano de contas/regime
   da DRE vigente, transação no banco adequado e proteção contra lançamento prévio.

Fonte: https://conciliacao.stone.com.br/docs/registradora (consultada em 22/09/2026).
E2E em observação, somente emuladores demo, sem credenciais/provedor reais.
