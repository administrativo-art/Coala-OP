# Plano — Fechamento financeiro mensal

Situação em 2026-11-20, base `origin/main` `73236fb8`. Plano de produto; nenhuma implementação, consulta a produção, escrita financeira ou publicação foi feita para escrevê-lo. Plano-mãe das regras de período: [integração Stone v5, seções 7.5 e 7.5.1](plano-integracao-stone-conciliacao.md#75-fechamento-de-período).

## Objetivo

Ter um fechamento por competência (ex.: outubro) que só se conclui quando tudo daquele mês estiver conciliado: caixa, vendas, taxas, recebimentos, despesas, provisões, pagamentos, cartão, folha, bancos, CMV e DRE. O mês fica aberto enquanto houver pendência, mostra o que falta e **quando** cada pendência deve se resolver. Pode levar um ou dois meses, mas em algum momento o mês fecha e gera o relatório geral com a DRE fechada.

## Situação atual verificada (leitura de código e docs)

Cada conferência tem seu próprio "fechado"; nada consolida por competência.

| Peça | Estado observado | Fonte |
|---|---|---|
| Fechamento de caixa e depósitos | Estado por dia/quiosque; resumo mensal versionado `cashClosureMonthlySummaries`; job de reconciliação de depósitos | `features/financial/cash-closures`, `functions/src/cash-closure-dre.ts`, `cash-deposit-reconciliation-job.ts` |
| PDV × Stone | Revisão salva por dia em `dailySalesReviews`/`dailySalesReviewSnapshots` | `sales-reconciliation/review-state.server.ts` |
| Recebimentos Stone | Até "pago na conta Stone"; coorte do mês com pagamentos posteriores ([plano](plano-recebimentos-pagamentos-entre-competencias.md)). Stone → Inter é a 2ª parte, sem plano | `receipts-reconciliation/*` |
| Taxas MDR/Pix/antecipação | Reconhecidas na competência da venda; **bloqueio próprio** `closedThroughMonth`/`closedPeriods` só para taxas | `acquirer-fees/recognition*.ts` |
| Despesas e provisões | Competência × vencimento × pagamento ([contrato](../contrato-contabil-despesas-financeiras.md)); previsão `forecast` substituída pelo real (`reconciled`) | `obligations/`, `expense-provision-reconciliation.server.ts`, [DAS](../procedimento-das-provisao-conciliacao.md) |
| Fatura de cartão | Importar → Conciliar → Fechar (`closed`, gravado por SDK do cliente) → Pagamento (`reconcile`) | [fluxo](../engineering/flows/card-statements.md) |
| Extrato Inter | `interStatementSync` a cada 15 min (6h–23h) com sugestão de vínculo; saldo exato exibido (#877) | `inter-statement-sync.server.ts`, `functions/src/inter-statement-jobs.ts` |
| Folha | Fechamento da competência no DP | [plano RH](plano-jornada-fechamento-rh.md), `dashboard/dp/fechamento` |
| CMV | Congelado por unidade/competência em `dreCmvClosures` (banco `coala`) via `mutateCmvClosure` | `dre/cmv-closure.server.ts` |
| DRE | Marca resultado provisório e reúne pendências em "Conferir fontes"; exporta PDF/XLSX | [fluxo DRE](../engineering/flows/dre.md) |

Lacunas: configuração das demais contas Inter e passagem Stone → Inter (informadas pelo usuário em 2026-11-20); nenhum estado de período financeiro geral; nenhuma trava de escrita por competência fora das taxas.

## Decisões — 2026-11-20

Recomendações apresentadas e aceitas pelo usuário ("pode"):

1. **Um fechamento por mês para a empresa**, com itens por unidade. O consolidado só fecha com as três unidades em ordem (v5, 7.5).
2. **Crédito parcelado:** basta venda conciliada, taxa reconhecida e parcelas registradas na carteira. Só as parcelas já vencidas precisam estar pagas; as futuras viram "saldo a receber transferido" no relatório.
3. **Depois de fechado, trava.** Escrita na competência fechada é recusada; correção exige reabertura com permissão, motivo e auditoria.
4. ~~Stone → Inter como exceção~~ — substituída pela decisão 9: o item Stone → Inter só entra na lista quando a integração existir; até lá, Recebimento termina em "pago na conta Stone".
5. **Fechamento só por ação humana.** Nunca automático pela data.
6. **Primeiro mês a fechar: outubro de 2026.** Agosto e setembro ficam para depois da tela pronta.
7. **Permissão própria no perfil de permissões**, separada do fechamento de caixa: grupo `financial.monthClosings` com `view`, `close` e `reopen`, editável em `access-profiles-settings`/`profile-management-modal` e declarado em `src/types/index.ts` (padrão restrito `false`; administrador `true`). O servidor valida cada ação; esconder o botão não é controle.
8. **Vencimento usa o estado que Despesas já calcula** (`overdue`/"Vencido" em `expense-display-state.ts` e `expenseHasOverdueBalance`). O item 6 mostra os títulos da competência vencidos e abre Despesas com o filtro "Vencidos"; não há alerta nem prazo novo.
9. **Sem exceção por enquanto (2026-11-20).** Nenhum item é liberado sem estar conferido. O tratamento é feito no módulo de origem; o fechamento só revisa e fecha. A tela de Despesas do fechamento não tem ações: mostra situação, motivo e atalho para Despesas já filtrada (`?competence=AAAA-MM`, `status`, `unit`, `expense`).
10. **Fluxo de Despesas só confere despesas (2026-11-21).** Ficam três conferências: previsões e rascunhos resolvidos, títulos pagos e vinculados ao extrato, fatura do cartão. Saem "Folha e encargos" e "Caixa de documentos": o fechamento da folha é do DP; o custo da folha (salário, FGTS, INSS, pró-labore, PJ) entra como despesa provisionada e já é cobrado pelas conferências de despesas; a caixa de cobranças é tratada em Cobranças. O fluxo fecha quando tudo está conciliado, sem verificação própria por pessoa.
11. **Boleto de competência já fechada (2026-11-21).** A trava recusa o lançamento; quem tem permissão reabre o mês com motivo, a revisão fechada fica preservada, lança-se e concilia-se, e fecha-se de novo como nova revisão. Não se lança como ajuste no mês seguinte.
12. **Vendas e Taxas conectados (2026-11-21).** Sem tela de detalhe: o card leva à tela de origem já no mês. Cada fluxo fecha **sozinho** quando todas as suas conferências estão ok; só o fechamento do mês é manual. Vendas = revisão PDV × Stone (cartão e Pix) com todos os dias fechados; Taxas = conferência Stone do mês salva após o fim do mês e aba Taxas sem pendência. Ordem: Vendas e Taxas agora; **Recebimento por último** (crédito a 30 dias).
13. **Recebimento por competência da parcela (2026-11-21).** O Recebimento de um mês é o que estava **previsto para cair naquele mês**, parcela a parcela (venda em 12x conta uma parcela por mês; crédito à vista de 31/10 pertence a novembro). Duas etapas: Pix e cartão (implementada) e dinheiro (só depois do fechamento do mês; pendente). A tela de cada card não lista mais “O que falta”: a tabela “Até fechar” traz os itens.

## Pendências a confirmar

- Contas bancárias da verificação (item 9): o cadastro e a integração das contas ainda estão sendo finalizados. Até lá, o item 9 aparece como "aguardando definição das contas" e não bloqueia o diagnóstico; o fechamento real de outubro depende dessa definição.

## Modelo

**Estados:** Em apuração → Pronto para fechar → Fechado → (Desatualizado | Reaberto).

- *Em apuração:* há itens pendentes, cada um com data esperada de resolução.
- *Pronto para fechar:* todos os itens conferidos.
- *Fechado:* guarda snapshot da DRE, revisões de CMV usadas, resultado e evidência de cada item, autor e data; gera o relatório.
- *Desatualizado:* fonte mudou depois do fechamento (venda tardia, Stone revisada, CMV reaberto). Não altera os valores fechados; exige revisão.
- *Reaberto:* motivo, autor, revisão anterior preservada.

**Previsão de fechamento:** a maior data esperada entre as pendências. Ex.: "Outubro pode fechar a partir de 01/12 — DAS (23/11), crédito de 31/10 (≈30/11)".

**Sem exceção (decisão 9):** nenhum item é liberado sem estar conferido. O que estiver parado se resolve no módulo de origem (pagar e vincular, cancelar, ajustar, registrar perda).

### Tela: cinco fluxos — decisão 2026-11-20

A tela **Financeiro › Fechamento do mês** é organizada pelos cinco fluxos pedidos pelo usuário: **Despesas, Vendas, Recebimento, Taxas e DRE**. Não são etapas obrigatórias em ordem: cada fluxo tem estado próprio (Conferido / Pendente até dd/mm / Sem fonte), pendências com data esperada, totais da competência e atalho para a tela de origem, onde a correção é feita. A DRE fica por último porque depende dos outros quatro; o botão **Fechar outubro** só aparece com os cinco conferidos.

```text
Fechamento financeiro · Outubro/2026        Em apuração · pode fechar a partir de 01/12
───────────────────────────────────────────────────────────────────────────────────
Despesas      ● Pendente até 23/11   DAS 10/2026 previsto; 2 vencidos     [Abrir despesas]
Vendas        ✓ Conferido            31/31 dias × 3 quiosques                [Abrir vendas]
Recebimento   ● Pendente até 30/11   crédito de 31/10                        [Abrir recebimentos]
Taxas         ● Pendente             4 vendas a corrigir                     [Abrir taxas]
DRE           ○ Aguarda fluxos       CMV: 2 de 3 unidades congeladas          [Abrir DRE]
───────────────────────────────────────────────────────────────────────────────────
Cada linha abre o detalhe por unidade.   (valores ilustrativos, não apurados)
```

**Tela inicial aprovada — 2026-11-20:** entre nove alternativas prototipadas (fluxos lado a lado, trilho, matriz fluxo × unidade, calendário, lista de tarefas, abas, ponte do resultado, quadro por situação e meses lado a lado), o usuário escolheu **fluxos lado a lado**, sem alterações. Ela tem:
- painel escuro com o estado do mês, os fluxos conferidos, a previsão de fechamento, o resultado provisório e o botão **Fechar outubro**, desligado com o motivo;
- os cinco fluxos em colunas, cada um com status, progresso, conferências com contagem, "O que falta" com prazo ou valor, e o link para o detalhe;
- embaixo, "Até fechar" (pendências por data), Bancos (saldo final). O bloco de exceções do protótipo sai na implementação (decisão 9).

Protótipo: canvas privado "Fechamento do mês" no claude.ai, artboard `Alt0-Fluxos`; as telas de detalhe de cada fluxo ainda serão revisadas uma a uma.

### Itens de cada fluxo

| Fluxo | Conferido quando | Fonte a reutilizar |
|---|---|---|
| **Despesas** | nenhum rascunho (`draft`) e nenhuma previsão (`forecast`) sem valor real (DAS, folha, encargos, séries) | `expenses` por `competenceMonth`, conciliação de provisões |
| | títulos da competência pagos (`paidAt`) e vinculados a lançamento do extrato — sem emissão de boleto: vincula e paga, ou paga direto e vincula pelo extrato (decisão 2026-11-20); futuros "aguarda dd/mm"; vencidos como "Vencido" com atalho ao filtro de Despesas | `expenses`, `transactions`, `expense-display-state.ts` |
| | fatura do cartão da competência fechada e paga/conciliada | `cardStatements` |
| **Vendas** | caixa de todos os dias de cada quiosque fechado (dinheiro contado) | cash-closures, `cashClosureMonthlySummaries` |
| | PDV × Stone (cartão e Pix) revisado em todos os dias, sem divergência sem decisão | `dailySalesReviews` |
| **Recebimento** | depósitos do dinheiro conciliados no banco | cash-deposits |
| | liquidações vencidas pagas na conta Stone; parcelas futuras na carteira (saldo a receber transferido) | coorte de [pagamentos entre competências](plano-recebimentos-pagamentos-entre-competencias.md) |
| | Stone → Inter: entra na lista só quando a integração existir (decisão 9) | — |
| **Taxas** | aba Taxas sem pendência; MDR, Pix e antecipação reconhecidos na competência | acquirer-fees |
| **DRE** | CMV congelado e íntegro nas três unidades | `dreCmvClosures` |
| | "Conferir fontes" vazio, sem provisório; snapshot e relatório gerados no fechamento | `getDreSourceData`, exportação DRE |

**Bancos:** a conferência do extrato se divide entre os fluxos: as saídas entram em Despesas e as entradas em Recebimento. O saldo final por conta fica no resumo do topo e depende da definição das contas (pendência acima).

## Estado da implementação — 2026-11-20

Primeira entrega local (sem commit, sem publicação), a pedido "vamos implementar" da tela inicial e da tela de Despesas:

- **Feito:** tela inicial (opção 0) e fluxo de Despesas, somente leitura; rota `GET /api/financial/month-closing` com `secureRoute`; permissão `financial.monthClosings` (ver/fechar/reabrir; `fechar` e `reabrir` ainda sem efeito); item "Fechamento do mês" na barra lateral; guia em [flows/month-closing.md](../engineering/flows/month-closing.md); testes unitários (classificação, fuso, permissões).
- **Despesas, o que é calculado:** previsões e rascunhos resolvidos; pagas e vinculadas ao extrato (vencidas e a vencer separadas); fatura do cartão. Folha e Caixa de documentos saíram do fluxo (decisão 10).
- **Os outros quatro fluxos** (Vendas, Recebimento, Taxas, DRE) aparecem como "Ainda não conectado", sem números.
- **Fora desta entrega:** fechar/reabrir, trava da competência, relatório, tabela por quiosque, saldo dos bancos, exceções (decisão 9).
- **Hipóteses a confirmar com dados reais** (diagnóstico de outubro): despesas antigas sem `settlementSummary` aparecem como "sem vínculo no extrato"; pago em dinheiro conta pela baixa do caixa; pagamento só informado não basta; fatura do cartão só conta como conferida quando `paid`.
- **Verificação local:** 17 + 11 testes novos passam; suíte unitária 3.546/3.548 (as 2 falhas vêm do `node_modules` compartilhado: `@tiptap` ausente e `minimatch` antigo); tipos sem erro novo (25 diagnósticos de `@tiptap` preexistentes); lint, `check:security-contracts`, `check-person-source-registration`, geradores de inventário e `check-engineering-docs` passam. **Não executado:** build, navegador, rota HTTP em emulador e leitura de dados reais.
- **Antes do PR:** atualizar a branch com a `main` (a `origin/main` já avançou desde `73236fb8`).

## Ordem de execução

1. **Diagnóstico de outubro, sem escrita.** Calculadora pura da lista a partir das fontes acima, executada em leitura sobre outubro; resultado registrado neste plano. Valida o modelo antes de desenhar a tela.
2. **Tela de consulta** em Financeiro › Fechamento do mês: os cinco fluxos com detalhe por unidade, previsão de data, atalhos para cada tela de origem. Cálculo sob demanda, com limites declarados; sem polling.
3. **Fechar/reabrir:** documento por workspace/competência no banco financeiro com revisões e eventos; `secureRoute`, permissões `financial.monthClosings.close`/`reopen` e auditoria. A tela da etapa 2 já exige `financial.monthClosings.view`. Coordenação com `mutateCmvClosure` (outro banco) por intenção/estado idempotente e retomável (v5, 7.5.1 itens 1–6). Detecção de *Desatualizado*.
4. **Trava da competência fechada** em todos os escritores: APIs de despesas, compras (`api/purchasing` escreve em `expenses`), fatura de cartão (escrita direta — exige regra em `firestore.financial.rules`), fechamento de caixa, taxas. O bloqueio das taxas passa a ler este fechamento.
5. **Relatório de fechamento** (PDF/XLSX) reaproveitando a exportação da DRE, com evidências e saldo a receber transferido. Registrar em `SYSTEM_DOCUMENT_TEMPLATES` e seguir o harness de documentos gerados.
6. **Dependências que entram como itens quando prontas:** contas Inter configuradas e Stone → Inter (2ª parte da conciliação de recebimentos).

Cada etapa de código segue o fluxo do Departamento de Desenvolvimento e Tecnologia (chamado em `.ai-work/development-technology/`); commit, publicação e qualquer escrita em produção exigem autorização própria.

## Critérios de aceite

- Mês com pendência futura não fecha; mostra a pendência e a data esperada.
- Consolidado não fecha com uma unidade pendente ou CMV aberto.
- Fechar duas vezes não duplica; falha entre bancos é retomável sem fechamento parcial anunciado.
- Escrita em competência fechada é recusada em todos os caminhos, inclusive escrita direta pelo cliente.
- Mudança de fonte após fechamento marca *Desatualizado* sem alterar o snapshot.
- Reabertura preserva a revisão anterior e exige motivo.
- Ausência de fonte nunca vira zero nem item conferido.
