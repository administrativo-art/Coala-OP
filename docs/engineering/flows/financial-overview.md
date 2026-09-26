# Painel financeiro: indicadores e atalhos

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página financeira](../../../src/app/dashboard/financial/page.tsx) monta [`FinancialDashboardPage`](../../../src/features/financial/pages/financial-dashboard-page.tsx). A tela exige `financial.dashboard` para exibir; atalhos de despesas, auditoria, cartões, caixa, DRE e configurações dependem de suas permissões específicas. Além de planos de contas e quiosques, a página lê `expenses` diretamente com [`useFinancialCollection`](../../../src/features/financial/hooks/use-financial-collection.tsx). O hook [`useFinancialDashboardIndicators`](../../../src/features/financial/hooks/use-dashboard-indicators.ts) lê **novamente** `expenses`, além de `transactions` e `payments`, e calcula indicadores no cliente. Cada leitura direta usa `getDocs` da coleção inteira; o fallback [`GET /api/financial/data`](../../../src/app/api/financial/data/route.ts) também lê coleção inteira após checagem de caminho.

O hook soma despesas abertas, vencimentos em 30 dias, receita de transações de entrada, saídas e pagamentos reportados, e calcula `dre` e `cash` por fórmulas locais. A [página](../../../src/features/financial/pages/financial-dashboard-page.tsx) filtra listas de despesas por competência, vencimento, fornecedor, status e plano de contas **após** o carregamento. O indicador local chamado `dre` não deve ser tratado como equivalente à [DRE detalhada](dre.md) sem comparar fontes, exclusões e períodos; o mesmo vale para o saldo frente ao [fluxo de caixa](cash-flow.md).

## Dados, acesso e impacto

`expenses`, `transactions`, `payments` e `accounts` vêm do banco financeiro; a leitura direta depende das [regras financeiras](../../../firestore.financial.rules), enquanto o fallback usa [`canReadFinancialPath`](../../../src/features/financial/lib/server-access.ts). Não há escrita no próprio painel. Um perfil com acesso ao dashboard pode executar os hooks antes do retorno visual de acesso negado, pois eles são chamados no início do componente; conferir regras e comportamento de erro para perfis restritos.

`npm run check` passou na verificação anterior do mapa (2026-09-25). Antes de alterar indicadores, comparar períodos, pagamentos conciliados, provisões, transferências e rateios com DRE/caixa; medir leituras duplicadas e volume, testar perfil restrito e confirmar se o dashboard deve mostrar dados globais ou apenas unidades permitidas. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Fórmulas e recorte efetivamente implementados

No [hook de indicadores](../../../src/features/financial/hooks/use-dashboard-indicators.ts), abertas são `pending`/`partially_paid`; parcial usa `settlementSummary.balanceAmountCents / 100`, demais usam `totalValue`. Vencimentos somam esse saldo entre início de hoje e final de hoje + 30 dias. Receita soma transações `in` exceto `transfer_in`, sem janela de competência. Despesa econômica exclui provisão `forecast` e status `draft`, `cancelled`, `reconciled`; `dre = receita − despesa econômica`.

`cash = receita − pagamentos reportados − saídas`. Pagamentos reportados excluem `MATCHED`, vínculo bancário e despesa já referenciada em transações não revertidas, inclusive rateios; saídas excluem transferências e reversões. O filtro de reversão não é aplicado à receita nessa função. Os filtros visuais de lista não alteram essas fórmulas. Não há filtro por unidade/período nas consultas do hook. Isso explica por que a equivalência ao caixa e à DRE detalhada não pode ser presumida; concordância contábil e autorização são verificações posteriores, e não caminhos ainda desconhecidos.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Inicialização e permissões

O [bootstrap financeiro](../../../src/app/api/financial/bootstrap/route.ts) tenta sincronizar claims antes do documento financeiro do usuário. O bootstrap ainda tenta transportar a matriz financeira nos claims nesta base. A correção local F07 não foi integrada; ver [acesso de pessoas](people-access.md). Isso não comprova os indicadores ou recortes contábeis deste painel.
