# DRE: fontes de receita, despesa e CMV

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página DRE](../../../src/app/dashboard/financial/dre/page.tsx) monta [`DrePage`](../../../src/features/financial/pages/dre-page.tsx). O cliente busca contas e centros de resultado pela coleção financeira e pede dados de unidades/períodos a [`GET /api/financial/dre/source-data`](../../../src/app/api/financial/dre/source-data/route.ts). Quando o critério de CMV é movimentação de estoque, também chama [`GET /api/financial/dre/stock-cmv`](../../../src/app/api/financial/dre/stock-cmv/route.ts). As duas rotas limitam a 20 unidades e seis competências, exigem permissão DRE e verificam o acesso a cada unidade. A rota de fontes também omite detalhes de despesas para quem não possui `financial.expenses.view`.

| Indicador/fonte | Origem observada |
| --- | --- |
| Vendas | `pdvSales.amountCents` dos fechamentos: pagamentos PDV líquidos de troco, antes de suprimentos/sangrias/ajustes humanos. Projeção versionada em `cashClosureMonthlySummaries`; [seleção e cobertura](../../../src/features/financial/dre/revenue-selection.ts). `salesReports` fornece CMV e testemunhas de datas, não fallback monetário. |
| Despesas | `expenses` do banco financeiro por `competenceMonth`, normalizadas pelo [contrato contábil](../../../src/features/financial/lib/expense-accounting-contract.ts). |
| Caixa | `cashClosureMonthlySummaries` por workspace/unidade/competência. [Fonte](../../../src/features/financial/dre/source-data.server.ts), [fechamento](cash-closures.md). |
| CMV por estoque | [`movementHistory`](../../../src/features/financial/dre/stock-cmv.server.ts) de saídas da unidade, mais `products`, `baseProducts` e `effective_cost_history`. O cálculo de resumo está em [`stock-cmv.ts`](../../../src/features/financial/dre/stock-cmv.ts). |

As consultas paginam e têm limites explícitos: 5.000 relatórios ou despesas por período, 5.000 simulações, 25.000 movimentos, 5.000 produtos e 10.000 registros de custo. Exceder o limite resulta em erro operacional nas [rotas](../../../src/app/api/financial/dre/source-data/route.ts), em vez de resposta parcial silenciosa.

## Dados, permissão e impacto

**Inferência de impacto:** alteração em vendas, competência de despesa, fechamento de caixa, movimentos ou custo efetivo pode mudar indicadores sem tocar na página DRE. Por isso, investigação de divergência deve começar pela fonte indicada na linha correspondente e conferir o filtro de unidade, período, classificação e critério de CMV. A [página](../../../src/features/financial/pages/dre-page.tsx) combina os resultados e cálculos de despesas; diferenças entre CMV de simulação e de saída de estoque são esperadas quando os critérios selecionados não são os mesmos.

## Verificação e limites

Os [testes de fontes](../../../tests/unit/dre-source-data.test.ts), [CMV de estoque](../../../tests/unit/dre-stock-cmv.test.ts) e [detalhes de despesas](../../../tests/unit/financial-dre-expense-details.test.ts) são referências. Para mudanças, conferir período/unidade, ausência de simulação, despesa sem detalhe autorizado, limite excedido e escolha de CMV. Este guia não valida todos os totais visuais nem exportações ponta a ponta.

## Apresentação, critérios e exportação rastreados

Na [página](../../../src/features/financial/pages/dre-page.tsx), receita por unidade/competência exige resumo versionado com cobertura comprovada. Não usa esperado ajustado, contagem ou receita por itens como fallback. Unidades administrativas sem PDV/fonte não invalidam vendas consolidadas; suas despesas permanecem. Unidade configurada no PDV sem fonte continua desconhecida. CMV de composição usa custo atual das fichas enquanto aberto e snapshot próprio após confirmação mensal; estoque usa consumo, perdas e ajustes. Despesas passam por [`calculateDreExpenses`](../../../src/features/financial/lib/dre-expense-calculation.ts), competência, centro e posição do plano; antes de `FINANCIAL_DRE_START_MONTH_KEY`, não são incluídas.

Receita líquida = bruta − impostos/deduções; margem bruta subtrai CMV; contribuição subtrai custos variáveis; resultado operacional subtrai pessoal, operação, ocupação, não categorizadas e faltas de caixa, somando sobras em linha própria. Diferenças são apenas do dinheiro físico, sem compensação entre operadores, na competência gerencial do dia original. Resultado antes dos impostos incorpora receitas/despesas financeiras e não operacionais; líquido subtrai impostos do resultado. Ponto de equilíbrio divide fixos pela margem relativa positiva. Pessoal e exportação têm permissões específicas.

## Contrato gerencial e compatibilidade — 2026-09-26

Venda100 − sangria10 = esperado físico90; contado80 → falta10. DRE: receita100 − despesa classificada10 − falta10 =80. Suprimento/fundo não é venda. Justificativa livre mantém o requisito para faltas; não exige investigar/recontar nem inventa compensação. A competência gerencial de origem foi aprovada pelo usuário, não é afirmação normativa sobre escrituração. Atraso de depósito não gera perda automática.

O [contrato puro](../../../functions/src/cash-closure-dre.ts) é compartilhado pelo app e Functions. Resumo mensal lê e grava em transação (dias do mês+sentinela). `dreVersion=1`, cobertura e centavos/null distinguem ausência de zero. Fonte antiga, dia ausente, duplicação ou PDV alterado impedem resultado íntegro. Operadores abertos geram aviso de parcialidade; receita conhecida permanece, resultado/exportação incompletos ficam indisponíveis. O consumidor analítico `agent/management.ts` usa o mesmo seletor.

`salesReports` tem dois escritores: o importador antigo descarta itens sem ficha/mantém primeiro preço; o job novo inclui não mapeados e grava receita/fingerprint. Ambos agregam itens, não o total explícito de pagamentos. Nenhum substitui silenciosamente a fonte integral. GET não faz backfill.

### Recuperação explícita do histórico

Reutilizar **Sincronizar PDV** do fechamento existente, por unidade/dia, após autorização de dados reais e preflight das despesas/classificações já existentes. Não inferir vendas pelo contado. Legado com evidência explícita e sem alertas pode ser normalizado em memória, mas resumo sem campos novos permanece indisponível até atualização autorizada. Fonte indisponível continua pendente.

Após mudança em fonte aprovada: reabrir operadores necessários, revisar/vincular sangrias aos gastos existentes, conferir e finalizar. `approvedSourceHash` de **todos** deve atestar a fonte atual antes de liberar diferenças. Origem removida/alterada exige desfazer vínculo com motivo; cancelar despesa criada ou restaurar a vinculada, com auditoria. Não mudar depósitos/contagens automaticamente. Este caminho existente substitui a proposta inicial de novo script de backfill.

Testes: [projeção](../../../tests/unit/cash-closure-dre.test.ts), [cobertura](../../../tests/unit/dre-revenue-selection.test.ts), [resync/classificação](../../../tests/integration/cash-withdrawal-classification.test.mjs), [HTTP autenticado](../../../tests/e2e-api/financial-reconciliation.test.mts). O fechamento financeiro mensal geral permanece fora daquela entrega. O congelamento específico do CMV por composição foi acrescentado em 2026-09-27, conforme a seção abaixo.

`exportCsv` usa esses mesmos dados e bloqueios de integridade; fonte com erro, simulação ausente, cadastro/classificação inválida ou critério estoque sem movimentos impedem exportação útil conforme avisos da tela. CSV é artefato local, sem escrita no financeiro. Concordância dos totais com fontes reais e testes de todos os filtros continuam na etapa de verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Comparativo de orçamento pessoal

[Source-data](../../../src/features/financial/dre/source-data.server.ts) inclui `budgetPlanning`, exibido separadamente pela [página](../../../src/features/financial/pages/dre-page.tsx) e pelo [quadro](../../../src/features/financial/components/dre/budget-planning-comparison.tsx). [Projeções](../../../src/features/financial/budgets/projections.server.ts) consultam orçamentos com composição em centros inteiramente autorizados, comparam orçado/comprometido/residual e informam conflitos. Sem permissão de pessoal, substituem nomes nominais. Não criam despesas nem alteram o cálculo contábil. Ver [orçamentos](financial-budgets.md).


## CMV atual e fechamento manual — 2026-09-27

Regra aprovada: CMV por composição acompanha as vendas e o custo atual até a confirmação manual do fechamento por unidade/competência. O custo vigente no fechamento, mesmo no mês seguinte, é aceito; não é custo histórico por transação. Fichas, precificação e CMV por movimentação não são congelados. Só o CMV é fechado, não receitas/despesas ou a DRE inteira.

[`product-composition-cmv.ts`](../../../src/lib/product-composition-cmv.ts) concentra quantidades em unidade base, preço automático (`lastEffectivePrice ?? initialCostPerUnit`), override e conversões. Provider, formulário de composição e servidor reutilizam o cálculo. O cliente sinaliza prévias incompletas; o financeiro não disponibiliza soma parcial como custo válido.

`GET source-data` consulta apenas composições vendidas dos períodos abertos e insumos únicos. Períodos fechados leem `dreCmvClosures` no banco operacional: não dependem de ficha ou preço atual existir. O payload inclui `cmvPeriods` (estado, revisão, valor, referência temporal e diagnóstico) e capacidades de ação. A mesma fonte atende o agente gerencial. Quando todos os relatórios atuais forem removidos, uma linha `cmvOnly` preserva o custo e não serve de testemunha de receita.

[`POST cmv-closure`](../../../src/app/api/financial/dre/cmv-closure/route.ts) aceita fechar/reabrir via schema, por uma unidade e mês anterior ao atual em `America/Belem`. Exige leitura DRE e unidade autorizada; fechar reutiliza `cashClosures.approve`, reabrir `cashClosures.reopen`; admin padrão mantém a convenção existente. Não cria permissões nem amplia acesso de quem apenas lê DRE. Fechar exige confirmação da conferência de vendas, revisão esperada e fingerprint da fonte exibida. Reabrir exige motivo. Ausência total de relatórios, composição/custo inválido, dados modificados entre conferência e confirmação e limites excedidos impedem fechar. Um relatório explícito sem itens pode representar zero vendas.

[`mutateCmvClosure`](../../../src/features/financial/dre/cmv-closure.server.ts) lê fontes e grava head, revisão preservada e auditoria na mesma transação operacional. Registra quantidades, custos, composição aplicada, referências de preço, fórmula, momento, usuário e revisão; idempotência é verificada antes de novo cálculo. São três escritas por transição e nenhuma em retry idêntico ou GET. Coleção e subcoleções são protegidas pelo deny-all existente para clientes. Não há transação entre esse banco e a fonte financeira de receita.

Preços/composição alterados não mudam CMV congelado. Mudança relevante nos relatórios de vendas gera `sourceChanged`, mantém o valor fechado e deixa resultado/exportação pendentes. Reabrir retorna aos custos atuais; nova confirmação preserva revisões anteriores. Interface e CSV identificam custo atual ou congelado e data/revisão. Não há polling, job, migração nem fechamento retroativo automático.

Limites por consulta: 5.000 fichas, 20.000 itens de composição e 10.000 insumos únicos; fechamentos consultados por IDs determinísticos (até 20 unidades × seis períodos). Por fechamento: 500 relatórios, 5.000 itens vendidos, 500 fichas, 3.000 itens de composição e 2.000 insumos; projeções de leitura limitadas a aproximadamente 3 MB de vendas + 3 MB de composição, snapshot JSON a 700 KB. Exceder falha explicitamente. Leituras incrementais por abertura são itens de composição + insumos + IDs de fechamento, sem varrer coleções; estimativa de uso registrada no chamado.

Testes: [cálculo/schema](../../../tests/unit/product-composition-cmv.test.ts), [integração](../../../tests/integration/dre-cmv-closure.test.mjs), [HTTP autenticado](../../../tests/e2e-api/financial-reconciliation.test.mts) e [isolamento por regras](../../../tests/security/firestore.rules.test.mjs). A implementação local não certifica dados reais nem homologação visual.

O futuro fechamento financeiro mensal deve reutilizar este serviço e referenciar sua revisão, conforme [plano de fechamento, seção 7.5.1](../../plano-integracao-stone-conciliacao.md#751-cmv-no-fechamento-financeiro-mensal). Ainda não existe fechamento geral nem coordenação implantada entre seus estados e o CMV.
