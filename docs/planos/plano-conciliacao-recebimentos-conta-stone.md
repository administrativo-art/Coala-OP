# Plano — Conciliação de recebimentos, 1ª parte (venda → conta Stone)

Situação em 2026-11-14. Chamado: `.ai-work/development-technology/2026-11-13-receipts-clarity/`. Plano-mãe: [integração Stone e conciliação de receitas v5](plano-integracao-stone-conciliacao.md).

## Situação atual verificada

- A tela **Conciliação de recebimentos** (`/dashboard/financial/stone-receipts`) compara cada liquidação Stone de cartão 1:1 com um crédito do extrato Inter em até D+2 (`receipts-reconciliation/reconciliation.server.ts`).
- O plano v5 define a conta Stone como conta de passagem: a liquidação cai na conta Stone e o acumulado é transferido depois para o Inter. O programador confirmou isso em 2026-11-14. O pareamento 1:1 com o Inter não corresponde à regra.
- O Pix não entra na tela. Ele existe na Conciliação de vendas (`sales-reconciliation/pix-source*.ts`), com taxa e data de liquidação (`feeEvidence`).
- O cruzamento PDV × Stone já é feito e salvo por dia em `dailySalesReviews` e `dailySalesReviewSnapshots` (`sales-reconciliation/review-state.server.ts`).
- A carteira Stone sincronizada (`receivables/portfolio-sync.server.ts`) guarda as parcelas com vencimento e situação. É a fonte da previsão de vendas anteriores ao período.
- O código da bandeira (`BrandId`) não tinha tabela de nomes no sistema. A tabela oficial foi conferida em <https://conciliacao.stone.com.br/reference/brandid.md> em 2026-11-14: 1 Visa, 2 Mastercard, 3 Amex, 4 Cabal, 5 UnionPay, 9 Hipercard, 171 Elo. `AccountType` e `FeeType` foram conferidos em <https://conciliacao.stone.com.br/reference/accounttype.md> e <https://conciliacao.stone.com.br/reference/feetype.md>.
- Não existe tabela de taxa contratada. Só a taxa praticada (MDR ÷ bruto) é conhecida.
- Não existe extrato da conta Stone: a Banking API não está provisionada. O pagamento na conta Stone é comprovado pelo arquivo diário de conciliação.

## Decisões

- 2026-11-14 · A 1ª parte termina em **"pago na conta Stone"**. A transferência Stone → Inter fica para a 2ª parte, com plano próprio.
- 2026-11-14 · Tela aprovada pelo programador (protótipo modelo-g):
  - Indicadores no cabeçalho escuro.
  - **Dia a dia**: previsto × pago na conta Stone, com a diferença explicada.
  - **Por cartão e parcelas**: bandeira × modalidade; o parcelado abre por número de parcelas, cada um com a sua taxa.
  - **Auditoria da venda** em painel lateral: dados de origem primeiro, os 12 cruzamentos só com o resultado e um botão "Detalhar cruzamento" com os valores comparados.
- 2026-11-14 · A auditoria reaproveita o cruzamento PDV × Stone salvo pela Conciliação de vendas e não refaz o pareamento. Sem fechamento salvo no dia, o painel informa que a conferência do PDV não foi feita.
- 2026-11-14 · O cruzamento 9 (taxa) compara com a taxa mais frequente do mesmo grupo (bandeira, modalidade e parcelas) no período. Ele aponta diferença; não afirma cobrança a maior enquanto não houver tabela contratada.
- 2026-11-14 · A rota existente (`POST /api/financial/stone-receipts/reconcile`) passa a aceitar `view: "month" | "sale"`, sem alterar o arquivo da rota. Consulta somente leitura, restrita ao administrador padrão, como antes.

## Pendências a confirmar

- Tabela de taxas contratadas com a Stone (bandeira × modalidade × parcelas), a fornecer pelo programador.
- Comportamento com dados reais: carteira sincronizada, Pix com cobertura parcial, vendas com mais de 12 parcelas.
- 2ª parte: transferências Stone → Inter (fonte candidata: `transactions` `transfer_in` com `toAccountId` da conta Stone, gravadas pela Auditoria do Extrato).

## Ordem de execução

1. Tabelas oficiais de bandeira, tipo de conta e tipo de taxa (`stone-codes.ts`).
2. Montagem pura do mês: parcelas pagas (arquivos do período), previstas (carteira), capturas do período e Pix. Inclui o resumo por dia e por grupo, com testes.
3. Montagem pura da auditoria da venda: os 12 cruzamentos e os dados de origem, com testes.
4. Leitura no servidor: arquivos Stone, carteira, Pix e fechamento do PDV, com a mesma checagem de vínculo e permissão.
5. Interface com os padrões do guia de design: `PageHero`, `HeroChip`, `Segmented`, `SidePanel` e `LiftRow`.
6. Guia de fluxo, mapa e verificações (`check-engineering-docs`, testes, lint).
