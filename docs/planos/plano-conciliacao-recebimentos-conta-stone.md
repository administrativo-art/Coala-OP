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

- 2026-11-14 · As quatro telas de recebíveis Stone são conferências independentes, não etapas. A navegação passa a abas sem numeração: A receber, Antecipações, Taxas e Recebido.
- 2026-11-14 · Sem MDR no arquivo, a tela propõe a taxa (bruto − líquido − antecipação) e marca **Verificar taxa**. Em análise com o programador: confirmação pelo operador, possivelmente por grupo, com exceção por venda e registro de quem confirmou. Exige uma rota de escrita com `secureRoute`, permissão e auditoria.
- 2026-11-14 · Problemas observados com dados reais (Quiosque Tirirical, novembro):
  - pagos sem data prevista (corrigido com a data da captura ou da carteira);
  - "Bateu" exibido com diferença (corrigido: o resto vira "sem explicação");
  - vendas sem MDR fora do resumo por cartão (corrigido com a taxa proposta).

- 2026-11-14 · Telas escolhidas pelo programador. Os protótipos estão em [`anexos/recebiveis-stone/`](anexos/recebiveis-stone/); os dados deles são fictícios.
  - **Recebido:** semana a semana (segunda a domingo) em linha mínima, com divisor alinhado, e pílulas de bandeira em "Por cartão e parcelas". Já implementada e publicada (PRs #817/#821). Referência: `recebido-semanas.html`.
  - **A receber:** variação B1. Abre em "Tudo", com abas de mês, semanas retráteis (bruto, taxa e líquido), barra e cartões da posição Stone e cartões que abrem o detalhe por arranjo. Implementada no worktree `Coala-OP-receivables-tabs`, ainda não publicada. Referência: `a-receber.html`.
  - **Antecipações:** alternativa **C10**, tabela completa por semanas retráteis com vencimento original, dias, custo e taxa a.m. por parcela. Referência: `antecipacoes-alternativas.html`, aba C10.
  - **Taxas:** layout **E1**, com blocos empilhados nesta ordem:
    1. mudanças de taxa a confirmar;
    2. vendas a corrigir (retrátil, por grupo, em tabela);
    3. outras cobranças (retrátil, em tabela);
    4. histórico de taxas (gráfico em degraus por grupo e tabela de evolução mensal);
    5. taxas atuais;
    6. lançamento da despesa, liberado ao zerar as pendências;
    7. decisões.

    Referência: `taxas.html`.
- 2026-11-14 · **Taxa de referência = taxa atual por recorrência**, não o contrato.
  - Cada grupo (bandeira × modalidade × parcelas, Pix e antecipação) tem a taxa que mais se repete, confirmada uma vez pelo operador.
  - Venda fora dela vai para análise.
  - Taxa nova que se repete gera **uma** pergunta, "é a nova taxa?", em vez de dezenas de exceções.
  - Subida de taxa sempre aparece em destaque.
  - Limite registrado: cobrança errada uniforme desde o início não é detectada.
- 2026-11-14 · **Conferência automática e decisões persistentes:**
  - Uma rotina diária confere o arquivo novo da Stone, que também atualiza vendas antigas. Ela revisita os últimos 7 dias e, nos dias 2 e 7, o mês anterior. Só recalcula o dia cujo arquivo mudou.
  - As telas abrem com o resultado salvo, sem o botão "Conferir"; "Reconferir" fica manual.
  - Decisões (aceitar, contestar, nova taxa, confirmar taxa) ficam gravadas à parte e nunca são apagadas pela rotina.
  - Mudança da Stone que afete valor, taxa, data ou situação **reabre** o item, com o antes e o depois. Um mês conferido volta a "em conferência". Despesa lançada não é apagada: gera um ajuste.
  - Sem tarefa ou notificação por enquanto.
  - A rotina deve ler os arquivos já guardados pela sincronização da carteira, em vez de pedir de novo à Stone.

## Pendências a confirmar

- Parâmetros da taxa atual (propostos, aguardando confirmação): janela de 60 dias, mínimo de 5 vendas por grupo, tolerância de R$ 0,01 por parcela, mudança detectada após 5 vendas ou 3 dias seguidos.
- Separação automática × pontual nas antecipações: verificar se o arquivo Stone a informa antes de prometer.

- Fluxo de revisão (aba Pendências): tipos B1–B8 (taxa, líquido, não pago, atraso, antecipação, chargeback, arquivo ausente) e C1–C3 (cruzamento com o PDV). Estados Pendente → Em verificação → Resolvido.
- A carteira automática começa nas vendas de 01/09, mas o vínculo do Quiosque Tirirical vale desde 20/09. Verificar se vendas anteriores ao vínculo entram na carteira da unidade.

- Tabela de taxas contratadas com a Stone (bandeira × modalidade × parcelas), a fornecer pelo programador.
- Comportamento com dados reais: carteira sincronizada, Pix com cobertura parcial, vendas com mais de 12 parcelas.
- 2ª parte: transferências Stone → Inter (fonte candidata: `transactions` `transfer_in` com `toAccountId` da conta Stone, gravadas pela Auditoria do Extrato).

## Próximas etapas (após a 1ª entrega)

1. **Publicar o que está pronto:** abas sem etapas, correções A1–A3 da aba Recebido e tela A receber com a carteira v3.
2. **Rotina diária e resultados salvos** (feito em 2026-11-14, conferência salva em `stoneReceiptMonthSnapshots` após a sincronização da carteira): Recebido abre pronta, lendo os arquivos guardados da carteira; rota de escrita e secureRoute só para a rotina e o "Reconferir".
3. **Antecipações (C10):** leitura dos arquivos guardados, sem gravação.
4. **Decisões e reabertura:** registro das decisões, rota com `secureRoute`, permissão do financeiro e registro de quem decidiu.
5. **Taxas (E1):** taxa atual por recorrência, histórico semanal (reconstruído desde a primeira data da carteira), mudanças, vendas a corrigir e outras cobranças.
6. **Fechamento do mês e lançamento da despesa:** reaproveita a apropriação existente em `acquirer-fees`.

## Ordem de execução

1. Tabelas oficiais de bandeira, tipo de conta e tipo de taxa (`stone-codes.ts`).
2. Montagem pura do mês: parcelas pagas (arquivos do período), previstas (carteira), capturas do período e Pix. Inclui o resumo por dia e por grupo, com testes.
3. Montagem pura da auditoria da venda: os 12 cruzamentos e os dados de origem, com testes.
4. Leitura no servidor: arquivos Stone, carteira, Pix e fechamento do PDV, com a mesma checagem de vínculo e permissão.
5. Interface com os padrões do guia de design: `PageHero`, `HeroChip`, `Segmented`, `SidePanel` e `LiftRow`.
6. Guia de fluxo, mapa e verificações (`check-engineering-docs`, testes, lint).
