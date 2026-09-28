# Fechamento de caixa: sincronização PDV e contagem

## Complemento integrado — 2026-09-26

A contagem existente contém um [painel de sangrias](../../../src/features/financial/cash-closures/components/cash-withdrawals-panel.tsx), uma consulta por fechamento, não por operador. Escolher conta-folha pela árvore pesquisável e centro exclusivo da unidade; criar despesa ou vincular avulsa elegível. Rascunho/contagem continuam disponíveis antes de classificar. **Finalização no servidor exige todas as sangrias válidas classificadas**, inclusive pelos caminhos antigos. Operador aprovado exige reabertura antes de corrigir, com motivo e auditoria. Fonte sem ID de provedor requer sincronização explícita, nunca identidade inventada.

O esperado físico já desconta sangrias e inclui suprimentos, por isso os cards de mês/calendário dizem “Esperado para conferência”, não “Vendas no PDV”. A [DRE](dre.md) usa receita integral separada, faltas/sobras físicas e despesa classificada uma vez. Ajustes de contado/esperado não alteram venda de origem. Dois operadores devem recertificar a fonte atual antes de limpar `pdvChangedAfterApproval`.

O [aviso de liquidação na origem](../../../src/features/financial/components/expenses/source-settlement-notice.tsx) aparece em detalhes, formulário e lista móvel de despesas. Edição financeira/pagamento/exclusão são bloqueados; notas/anexos permanecem sujeitos às permissões normais. Não há confirmação bancária fictícia. [HTTP autenticado](../../../tests/e2e-api/financial-reconciliation.test.mts) valida gate, autorização, retry e exemplo100−10−10=80; [integração](../../../tests/integration/cash-withdrawal-classification.test.mjs) valida concorrência/resync/reabertura. Sem navegador/produção. Fechamento mensal não implementado.

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [páginas de fechamento](../../../src/app/dashboard/financial/cash-closures/page.tsx) usam [`GET /api/financial/cash-closures`](../../../src/app/api/financial/cash-closures/route.ts), com filtros por unidade/período, sessão de contagem aberta e autorização `cashClosures.view`. A rota filtra novamente por unidade acessível antes de responder.

[`syncCashClosure`](../../../src/features/financial/cash-closures/service.server.ts) resolve a filial PDV Legal da unidade, busca cupons, operadores e fontes de movimentos de caixa, constrói o fechamento e o grava pelo [repositório](../../../src/features/financial/cash-closures/repository.server.ts). Falhas de sincronização são registradas. O [job diário](../../../src/app/api/jobs/cash-closures/daily-sync/route.ts), protegido por segredo, percorre unidades com filial PDV, sincroniza a data escolhida ou o dia anterior em Belém e registra execução por unidade em `cashClosureJobRuns`.

Na [rota de finalização](../../../src/app/api/financial/cash-closures/%5BclosureId%5D/finalize/route.ts), o operador selecionado só pode ser finalizado por pessoa com `cashClosures.approve` na unidade. Divergências podem exigir permissão sênior adicional; contagens incompletas e faltas sem justificativa são rejeitadas. A ação chama `finalizeCashClosureOperator` no [repositório](../../../src/features/financial/cash-closures/repository.server.ts) e considera a sessão de contagem ativa. Reabertura, ajuste esperado, divisão de depósito e auditoria possuem [rotas específicas](../../../src/app/api/financial/cash-closures) que precisam ser seguidas para mudanças nesses estados.

## Dados, dependências e impacto

### Sangrias classificadas — backend local de 2026-09-26

[`GET/PATCH withdrawals`](../../../src/app/api/financial/cash-closures/[closureId]/withdrawals/route.ts) usa autenticação compartilhada e [serviço transacional](../../../src/features/financial/cash-closures/withdrawal-classification.server.ts). Consultar exige `cashClosures.view` + `expenses.view`; criar exige `cashClosures.edit` + `expenses.view/create/pay`; vincular/desvincular exige `cashClosures.edit` + `expenses.view/edit/pay`. Todas exigem acesso à unidade e workspace exato; administrador não ignora workspace. O cabeçalho é autorizado antes das subcoleções. GET não escreve.

Valor, data, operador e unidade vêm de sangria positiva, cash, não cancelada. ID sintético/legado sem proveniência não serve como identidade financeira: ressincronizar e exigir ID fornecido pelo PDV. Conta deve ser folha ativa, sem filhos (consulta limitada), com posição de despesa explícita na DRE; não se presume herança de posição. Centro ativo deve ser exclusivo da unidade. Uma sangria corresponde a uma despesa integral nesta entrega, sem rateio/parcelamento múltiplo. A classificação cria despesa já paga em espécie ou vincula avulsa em aberto de valor/competência/centro compatíveis, rejeitando qualquer evidência de outro pagamento. Referência `obligationId` sem documento é aceita; obrigação já materializada é rejeitada conservadoramente. Parcela única do formulário é atualizada/restaurada junto da despesa.

`financialSourceSettlements/{hash}` reserva a identidade; `cashClosures/{id}/withdrawals/{hash}` guarda o vínculo. Despesa, reserva, vínculo, revisão do fechamento e auditoria são escritos juntos. Retry/concorrência não cria segunda despesa. Correção exige `unlink` com motivo em operador aberto, cancelando a despesa criada ou restaurando apenas os campos alterados na despesa vinculada; notas/anexos são preservados. Reclassificação exige motivo e gera nova revisão, mantendo histórico. Alterações financeiras externas impedem desfazer automaticamente. Fonte removida/alterada gera pendência e tem esse caminho explícito de correção.

Finalização, inclusive a função legada, valida sangrias e vínculos atuais na mesma transação, antes de escrever. Movimento sem operador, total divergente, fonte incerta ou vínculo obsoleto bloqueia. A rota revalida acesso/divergência sênior dentro da transação. Contagem finalizada registra `approvedSourceHash`; `pdvChangedAfterApproval` só é limpo quando todos os operadores aprovados atestam a versão atual. Linha contada retirada do PDV preserva história, mas `pdvSourceMissing` impede reutilizar suas sangrias como fonte atual.

Legado: cadastros/despesas sem `workspaceId` pertencem exclusivamente ao `WORKSPACE_ID` configurado. Vínculo marca o workspace na despesa e desfazer restaura a ausência. Candidatos são paginados por competência + centro autorizado/exclusivo + status, 25 por página; workspace explícito divergente nunca é retornado. Outros workspaces exigem filtro explícito. Não há varredura global, backfill em GET ou migração real. Contagens limitadas a 350 linhas, 50 operadores e 100 sangrias por fechamento; um painel por fechamento, sem polling.

Proteção compartilhada `sourceSettlement` (`cash_withdrawal | acquirer_fee`) reserva campos financeiros no servidor; regras permitem apenas notas/anexos/metadados de edição. Pagamento manual e vínculo bancário rejeitam nova quitação. Batch bancário legado ganha precondição de versão da despesa contra classificação concorrente. Nenhuma transação/split/pagamento bancário é criado pela classificação; resumo de liquidação indica saldo zero sem afirmar confirmação no banco. UI e validação integrada da entrega inteira pertencem às etapas seguintes.

Evidências locais: [unitários](../../../tests/unit/cash-withdrawal-classification.test.ts), [integração sem navegador](../../../tests/integration/cash-withdrawal-classification.test.mjs) e teste de regras em `tests/security/rules.test.mjs`. O runner de integração executa arquivos sequencialmente porque o teste legado limpa coleções inteiras no emulador. Não certifica dados/provedor reais nem UI.

| Local | Efeito observado |
| --- | --- |
| PDV Legal e cadastro de `kiosks`/`dp_units` | Origem de cupons, movimentos, usuários e vínculo com filial. [Serviço](../../../src/features/financial/cash-closures/service.server.ts). |
| Fechamentos e sessões de contagem no banco financeiro | Valores esperados, contados, divergências e etapa de operador. [Repositório](../../../src/features/financial/cash-closures/repository.server.ts). |
| `cashClosureJobRuns` | Resultado e falha parcial do job diário. [Job](../../../src/app/api/jobs/cash-closures/daily-sync/route.ts). |

**Inferência de impacto:** falha em uma unidade do job não impede as demais e o resultado `partial` depende da contagem de falhas. Alterar cálculo de cupons/movimentos afeta esperado, divergências e eventual depósito. Antes de mexer na finalização, conferir também o vínculo com sessão e a regra de aprovação sênior.

## Verificação e limites

Os [testes de estados](../../../tests/unit/cash-closure-state-machine.test.ts) e verificações do módulo são pontos de partida. Para mudanças, conferir unidade sem filial, dia/fuso, sincronização repetida, sessão de outra pessoa, contagem incompleta, falta justificada, permissão sênior e efeitos em depósito. Este guia não comprova resposta real do PDV Legal nem cobre reabertura/depósito por inteiro.

## Auditoria, esperado e reabertura rastreados

A [rota audit](../../../src/app/api/financial/cash-closures/[closureId]/audit/route.ts) exige visão na unidade e lista logs por workspace/fechamento. [`adjustCashClosureExpected`](../../../src/features/financial/cash-closures/repository.server.ts) usa transação, limites de linhas/operadores, estado editável, valor inteiro não negativo e justificativa mínima; recalcula linha/agregados e registra alteração. A restauração do esperado possui função própria no mesmo repositório. Resumos mensais são projeções posteriores e alimentam a DRE.

[Reabertura](../../../src/app/api/financial/cash-closures/[closureId]/reopen/route.ts) exige permissão específica e motivo; chama [`reopenCashClosureWithDepositHandling`](../../../src/features/financial/cash-deposits/repository.server.ts). Transação seleciona operadores aprovados, valida transição e desanexa sessão/locks com auditoria; operadores vinculados a sessões devem ser reabertos individualmente. Sem cobrança emitida/moeda preparada, retira itens dos lotes, ajusta totais e volta para não alocado. Com histórico de emissão/pagamento ou moedas, preserva lote e cria ajuste `pending_allocation`, marcando depósito `adjusted`. Atualiza fechamento/operadores e logs juntos; refresca resumo depois. Nova finalização calcula delta do ajuste para alocação futura, sem apagar história bancária.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
