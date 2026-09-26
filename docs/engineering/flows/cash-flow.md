# Fluxo de caixa: realizados, previsões e lançamento manual

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de fluxo de caixa](../../../src/app/dashboard/financial/cash-flow/page.tsx) monta [`CashFlowPage`](../../../src/features/financial/pages/cash-flow-page.tsx). O cliente lê `bankAccounts`, `transactions`, `payments`, `expenses` e `accounts` por [`useFinancialCollection`](../../../src/features/financial/hooks/use-financial-collection.tsx). O hook tenta `getDocs` no Firebase cliente e, se necessário, recorre a [`GET /api/financial/data`](../../../src/app/api/financial/data/route.ts). A página aplica período, conta, direção e status após receber os registros.

| Visão | Cálculo observado |
| --- | --- |
| Realizado | Usa `transactions` não revertidas; inclui pagamentos sem transação bancária correspondente e evita contá-los de novo quando a despesa já consta em transação. Exclui transferências internas da lista consolidada. [Página](../../../src/features/financial/pages/cash-flow-page.tsx). |
| Previsto | Usa `expenses` não pagas/canceladas/rascunho, por vencimento ou competência; para pagamento parcial com saldo conhecido, usa apenas o saldo. [Página](../../../src/features/financial/pages/cash-flow-page.tsx). |
| Novo lançamento | O [diálogo](../../../src/features/financial/components/cash-flow/new-transaction-dialog.tsx) valida receita, transferência ou ajuste por schema local e grava diretamente em `transactions` pelo SDK cliente. Transferência grava uma saída e uma entrada em chamadas separadas. |

A página exige `financial.cashFlow.view` ou permissão legada de fluxo financeiro para mostrar a visão; o botão de lançamento exige `cashFlow.create`. As [regras do banco financeiro](../../../firestore.financial.rules) protegem leitura e criação de `transactions` no servidor Firestore, além da visibilidade do botão.

## Dados, dependências e impacto

**Ponto de atenção observado:** [`useFinancialCollection`](../../../src/features/financial/hooks/use-financial-collection.tsx) usa `getDocs(ref)` sem filtro ou limite quando recebe as coleções inteiras; esta página carrega cinco coleções e filtra período no cliente. O custo cresce com o histórico e com usuários/abas. **Inferência de impacto:** as duas gravações de uma transferência não são atômicas; uma pode ser criada sem a outra. Alterações nesse fluxo precisam preservar paridade dos lados, direitos de acesso e classificação dos lançamentos para não distorcer saldos e DRE. O [agente financeiro](../../../src/app/dashboard/financial/cash-flow/agent/page.tsx) é outra subpágina e não está coberto por este guia.

## Verificação e limites

O [teste de análise](../../../tests/unit/financial-cash-flow-analysis.test.ts) é ponto de partida para cálculos. Para mudanças, conferir pagamentos conciliados versus relatados, despesa parcialmente paga, transferência sem dupla contagem, lançamento de receita/ajuste, regras Firestore, perfil restrito e volume de leitura. Este levantamento não mediu leituras mensais nem executou transações reais.

## Agente, rotinas e conciliação rastreados

A [subpágina do agente](../../../src/app/dashboard/financial/cash-flow/agent/page.tsx) roteia `topic=receivables` para [carteira](receivables-stone.md), padrão para [antecipações](stone-sales-review.md) e `topic=management` para análise gerencial. [`runManagementAnalysis`](../../../src/features/financial/agent/management.server.ts) valida admin/schema, vínculo durante a competência e centro de resultado único, lê DRE, transações da conta e despesas vencendo no mês, e opcionalmente Stone até data publicada. Consultas usam limite 501 e rejeitam mais de 500; parâmetros/contas/workspace são conferidos. Resultado e recomendações não lançam dinheiro.

[`analysis-routines`](../../../src/app/api/financial/analysis-routines/route.ts) também é admin e delega ao [serviço de rotinas](../../../src/features/financial/agent/routines.server.ts): salvar com revisão, executar conferência e reconhecer alerta. Essas ações persistem configuração/execução/ciência, não resolvem a origem do alerta nem alteram caixa. Rotina tem trava/revisão para evitar execução concorrente. Reconciliação que altera o realizado está em [extrato/pagamentos](payment-requests.md), [cartão](card-statements.md) e [depósitos](cash-deposits.md); a página agrega seus lançamentos, não substitui esses serviços. Exportação deriva da seleção local e não constitui uma nova fonte contábil.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Orçamentos na main

A [página](../../../src/features/financial/pages/cash-flow-page.tsx) consulta centros de resultado, resumos mensais e `GET /api/financial/budgets/cash-projections?from=…&to=…`, com filtro opcional `resultCenterId`. O filtro de centro afeta somente o planejamento por orçamento; despesas conservam os filtros gerais. Perfis restritos precisam selecionar um centro autorizado. Falha, carregamento ou escopo pendente sinalizam saldo projetado incompleto.

Composições pessoais geram previsões residuais pela data esperada de compra. Esses valores e despesas de tipo `forecast` compõem Compras planejadas, separado de Contas a pagar. A opção inicialmente desligada Simular envelopes sem composição pessoal acrescenta ao fim do mês somente o residual positivo dos demais envelopes, descontada cobertura de previsões existentes. Projeções sem conta bancária aparecem em Todas as contas. Conflito com provisão antiga suspende a nova projeção; conversão exige prévia e confirmação. Fontes: [totais](../../../src/features/financial/budgets/projection-view.ts), [projeções](../../../src/features/financial/budgets/projections.server.ts), [guia do domínio](financial-budgets.md).

O custo inclui essas APIs além das coleções do hook. Conferir limites/sentinelas do serviço, competência e autorização por centro antes de ampliar períodos.

## Projetos e consulta de meses futuros

Em 2026-09-26, o filtro “Até o mês” passou a definir o fim da janela de 1/3/6/12 meses, inclusive futuros. Gráfico, listagem e APIs compartilham a janela; três meses até dezembro mostram outubro–dezembro.

O [cronograma de projeto](../project-budget-cashflow.md) acrescenta somente o saldo ainda esperado de cada etapa, em Todas as contas/Todos os centros. Boletos vinculados substituem a estimativa; pagamento não desconta novamente. Expectativas vencidas reaparecem hoje com aviso, sem mudar a referência original. Provisões avulsas ou planejamento pessoal nas mesmas contas suspendem a estimativa do projeto; envelopes mensais sobrepostos não são somados à simulação. Nada é cancelado automaticamente.

A [consulta de projetos](../../../src/features/financial/budgets/project-projections.server.ts) limita 51 projetos ativos com cronograma (sentinela de 50) e 500 despesas por IDs; exige índice financeiro específico. Sem polling novo ou escrita em GET. Custo e controles no contrato citado; projetos concluídos devem ser inativados. Testes unitários do intervalo/cálculo e integração de vínculos/encerramento executados localmente; navegador local não executado.
