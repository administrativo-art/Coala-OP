# Stone: vendas, recebimentos, taxas e antecipações

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Antecipações (`stone`)

A [página de antecipações](../../../src/app/dashboard/financial/stone-anticipations/page.tsx) monta [`AnticipationWorkspace`](../../../src/features/financial/agent/anticipation-workspace.tsx). O usuário seleciona vínculo, StoneCode, data e uma pergunta guiada. A tela carrega vínculos e catálogos paginados em [`/api/financial/stone-mappings`](../../../src/app/api/financial/stone-mappings/route.ts); editar vínculo usa POST com unidade, conta, códigos, vigência, revisão e justificativa. A consulta usa [`POST /api/financial/agent`](../../../src/app/api/financial/agent/route.ts). A rota exige administrador padrão, limita corpo, chama [`runFinancialAgent`](../../../src/features/financial/agent/service.ts), lê XML da agenda Stone via [`fetchStoneAgendaXml`](../../../src/lib/integrations/stone/agenda-transport.ts) e pode usar priorização por IA somente quando `ENABLE_AI_FEATURES=true`. A tela declara que a consulta não executa antecipação nem lança valores no caixa/DRE; salvar vínculo altera seu cadastro e auditoria.

## Comparação de vendas (`sales-reconciliation`)

A [página PDV × Stone](../../../src/app/dashboard/financial/sales-reconciliation/page.tsx) monta [`SalesReviewPage`](../../../src/features/financial/sales-reconciliation/review-page.tsx), restrita na tela ao administrador padrão. Ela carrega o vínculo oficial, escolhe unidade/StoneCode/dia e chama [`POST /api/financial/pdv-stone-review`](../../../src/app/api/financial/pdv-stone-review/route.ts). A rota repete a autorização de administrador e chama [`queryDailySales`](../../../src/features/financial/sales-reconciliation/query.ts) com fontes PDV, agenda Stone e Pix validado, limitando a duração da consulta. A página confere IDs do vínculo/conta/escopo na resposta, abre no filtro de divergências e mantém a opção **Todas** para inspeção integral. O resultado é somente leitura; não confirma banco, lança pagamento nem fecha venda automaticamente.

## Conciliação de recebimentos (`stone-receipts`)

A [página Conciliação de recebimentos](../../../src/app/dashboard/financial/stone-receipts/page.tsx) monta [`StoneReceiptsPage`](../../../src/features/financial/receipts-reconciliation/receipts-page.tsx), também restrita ao administrador padrão. Ela é uma entrada própria na navegação e separa carteira/previsões, antecipações, taxas praticadas e crédito bancário. A primeira página do catálogo paginado de vínculos é carregada automaticamente na entrada; atualização e páginas seguintes continuam ações explícitas. [`AcquirerFeesPanel`](../../../src/features/financial/acquirer-fees/fees-panel.tsx) só é montado após unidade e StoneCode serem escolhidos. A página de vendas não apresenta atalhos para estes fluxos, não carrega nem grava taxas.

A Conciliação de vendas também carrega a primeira página dos vínculos ao entrar e inicia o recorte no dia anterior em `America/Belem`, sem consultar PDV ou Stone automaticamente. Com vários vínculos, a unidade continua sendo uma escolha obrigatória e o seletor de StoneCode fica bloqueado até essa escolha; com um único vínculo, unidade e primeiro StoneCode são preenchidos. A consulta externa só ocorre depois de **Comparar vendas**.

Pagamento informado pela Stone continua diferente de crédito confirmado no banco. O módulo direciona ao extrato existente, mas ainda não executa a comparação Stone paga × crédito Inter. Exportação de evidências está prevista para uma etapa posterior; não há ação de contestação.

## Dados, dependências e verificação

Os dois fluxos dependem do vínculo Stone/unidade/conta em [`configuration.server.ts`](../../../src/features/financial/agent/configuration.server.ts), das credenciais usadas apenas no servidor e de dados externos que podem chegar atrasados. O [guia de recebíveis](receivables-stone.md) cobre previsões de recebimento, com semântica diferente da comparação diária. `npm run check` passou na verificação anterior do mapa (2026-09-25). Referências iniciais: [autorização de carteira Stone](../../../tests/unit/stone-portfolio-auth.test.ts), [período de recebíveis](../../../tests/unit/stone-receivable-period.test.ts) e [E2E de comparação](../../../tests/e2e/financial/pdv-stone-review.spec.ts). Antes de elevar os grupos, conferir origem Pix, vigência do vínculo, paginação, limite de 500 eventos por fonte, timeouts, dados divergentes e custo de chamadas externas.

## Serviço, vínculos e correspondência rastreados

[`runFinancialAgent`](../../../src/features/financial/agent/service.ts) aceita apenas intenção `review_anticipations`, valida administrador e vínculo novamente no serviço e consulta revisão XML por data de pagamento. Cálculo/linhas são determinísticos; IA recebe apenas contagens e IDs de ações para reordenar a lista permitida, com validação de cardinalidade/IDs e fallback. Não altera valores nem grava caixa/DRE. [`configuration.server`](../../../src/features/financial/agent/configuration.server.ts) lista catálogos por página e salva `stoneMerchantMappings` em transação com revisão esperada, validação de vínculos/vigências e evento de auditoria. Mudança concorrente exige recarregar.

[`queryDailySales`](../../../src/features/financial/sales-reconciliation/query.ts) valida data já publicada, vínculo oficial/filial, coleta PDV e Stone e revalida vínculo após coleta; alteração durante consulta é conflito. [Matching](../../../src/features/financial/sales-reconciliation/matching.ts) usa identificador de provedor, NSU/autorização/terminal e pedido; conflito ou multiplicidade impede correspondência alta. Um par individual compatível por chave forte ou por valor único na janela de cinco minutos recebe `auto_checked`. Grupo por soma/horário, ausência, conflito, diferença ou vínculo incompleto recebe `attention_required`. O estado `pending` do PDV significa que o PDV não comprova a aprovação da adquirente; isoladamente ele não contradiz uma captura `approved` da Stone. Isso não transforma a conferência em liquidação nem comprova recebimento.

[Pix](../../../src/features/financial/sales-reconciliation/pix-source.server.ts) lê snapshot de `stonePixConciliationFiles` e até 501 linhas em transação somente leitura; máximo aceito 500. [`reviewPixSnapshot`](../../../src/features/financial/sales-reconciliation/pix-source.ts) confere documento/workspace/dia/hash/contagem/unicidade, StoneCode/terminal, IDs de evento/e2e, status pago, valores coerentes e ausência de estorno. Incompleto vira `pending`; registros inválidos são excluídos, não transformados em venda confirmada. A rota tem timeout de 110 segundos. Correspondências não persistem baixas financeiras. Testes de fonte ausente, duplicata, atraso e mudança de vínculo continuam necessários.

## Evidências da etapa 2

## Apropriação de taxas explícitas — 2026-09-26

O [painel de taxas](../../../src/features/financial/acquirer-fees/fees-panel.tsx) fica em Conciliação de recebimentos e é separado da comparação de vendas. [GET/POST acquirer-fees](../../../src/app/api/financial/acquirer-fees/route.ts) exige administrador padrão no servidor. Prévia não grava. Cadastro/vínculo/correção/auditoria usam transação, revalidando workspace, mapping/vigência, centro exclusivo da unidade, conta-folha ativa de despesa e snapshot Pix. Sem permissão nova.

- Pix: taxa explícita de evento pago elegível identificado por e2e/evento. Competência da venda; retenção no dia do evento financeiro. Datas futuras/anteriores à venda ficam pendentes.
- Cartão: MDR explícito por parcela na competência da venda; antecipação explícita confirmada na competência do evento. Moeda não BRL, estorno, parcialidade ou origem ambígua não geram taxa presumida.
- `SaleFee`/`FeeType=2` combinado fica pendente sem composição comprovada. Não somar às partes nem inferir taxa pelo residual bruto−líquido. Soma decimal antes do arredondamento.

Limites:500 parcelas/componentes,31 datas originais,2 chamadas simultâneas,100 grupos e100 componentes/grupo. Excesso explícito, nunca soma parcial silenciosa. Identidade independe do arquivo/posição: reservas `financialSourceSettlements` impedem duplicidade/sobreposição. `financialAcquirerFeeBatches` mantém revisões/auditoria.

Despesa `paid`, `sourceSettlement.kind=acquirer_fee`, `cashEffectIncludedInNetReceivable=true`, evidência REPORTED e zero confirmação bancária. Não cria payment/split/obrigação/débito. Motor e regras bloqueiam novo pagamento. Antes de criar, usuário confirma ausência de lançamento manual; servidor verifica mesmo valor/competência/centro. Isso não identifica todo equivalente com valores diferentes. Vínculo só com avulsa elegível, sem pagamento/obrigação materializada/rateio. Correção exige motivo e estado financeiro intacto; histórico permite desfazer sem provedor disponível.

Catálogos501 contas/51 centros sob escolha de grupo; candidatos25+sentinela, histórico100+sentinela. Sem polling. Corpo2048 bytes/10s, consulta110s. [Unitários](../../../tests/unit/acquirer-fees.test.ts), [integração](../../../tests/integration/acquirer-fees.test.mjs), [HTTP em emuladores](../../../tests/e2e-api/financial-reconciliation.test.mts).

Fontes primárias consultadas em 2026-09-26: [Stone Installments](https://conciliacao.stone.com.br/reference/installments), [AccountType](https://conciliacao.stone.com.br/reference/accounttype), [FinancialTransactionsAccounts](https://conciliacao.stone.com.br/reference/financialtransactionsaccounts), [arquivo Pix](https://conciliacao.stone.com.br/reference/estrutura-do-arquivo-pix).

### Taxa contratada × taxa praticada

O arquivo atual pode trazer o MDR praticado, mas o repositório não possui tabela contratual versionada por modalidade/vigência nem regra contratual de arredondamento. Portanto a interface identifica a cobertura das duas fontes e não calcula “cobrado a mais” enquanto faltar a evidência contratual. A etapa futura deve cadastrar ou importar a fonte oficial do contrato, preservar sua vigência e então comparar por transação/modalidade. Valor ausente não vira zero e residual bruto−líquido não vira taxa presumida.

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
