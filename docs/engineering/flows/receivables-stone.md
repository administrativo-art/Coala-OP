# Recebíveis Stone: período, carteira e posição

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de recebíveis](../../../src/app/dashboard/financial/cash-flow/receivables/page.tsx) monta [painéis de período, carteira e posição](../../../src/features/financial/receivables/receivables-page.tsx). O seletor mostra unidade e nome da conta, nunca o identificador interno; quando informado na URL, vínculo e StoneCode seguem para as quatro abas dos Recebíveis Stone (A receber, Antecipações, Taxas e Recebido), conferências independentes e não etapas em sequência. A tela separa a carteira automática da conferência por período, sem confundir nenhuma delas com crédito bancário. [`POST /api/financial/stone-future-receivables`](../../../src/app/api/financial/stone-future-receivables/route.ts) permite revisão de período apenas ao administrador padrão, verifica o mapeamento de unidade/Stone/conta e consulta agenda XML da Stone. [`GET/POST /api/financial/stone-portfolio`](../../../src/app/api/financial/stone-portfolio/route.ts) também exige administrador padrão; confere se o mapeamento ainda corresponde à carteira antes de ler ou sincronizar o snapshot. A [posição da carteira](../../../src/app/api/financial/stone-wallet-position/route.ts) consulta XML específico com validação de parâmetros e controle no serviço; desde 15/11/2026 o painel manual dessa consulta aparece só na entrada do agente Coala Financeiro, porque a aba A receber já mostra a mesma posição lida pela rotina diária.

A aba **Carteira** da tela A receber ([`StonePortfolioPanel`](../../../src/features/financial/receivables/portfolio-panel.tsx), lógica em [`receivable-view.ts`](../../../src/features/financial/receivables/receivable-view.ts)) abre em **Tudo**:

- **Abas de mês:** filtram as parcelas pelo vencimento.
- **Tabela:** agrupada por mês e por semana (segunda a domingo). As semanas são retráteis e trazem bruto, taxa e líquido.
- **Barra e cartões:** mostram a posição de direitos da Stone (2.4) por natureza: Livre, Já antecipado, Em garantia e Cedido. A Stone informa essa posição só para a carteira toda, por arranjo; não a separa por mês nem por parcela. Por isso clicar num cartão abre o detalhe por bandeira e produto em `SidePanel`, sem filtrar a tabela.
- **Taxa sem MDR:** quando o arquivo não traz o MDR, a taxa é proposta como bruto − líquido e marcada **Verificar taxa**.
- **Projeção versão 3 (2026-11-14):** cada parcela aberta passa a guardar bandeira, tipo de conta, nº de parcelas e MDR da captura. Carteiras salvas nas versões 1 e 2 continuam legíveis, sem esses campos, até a próxima sincronização diária. A sincronização reescreve o snapshot quando a versão muda.

A aba **Antecipações** mostra antes do formulário de consulta a tabela [`StoneAnticipationsTable`](../../../src/features/financial/receipts-reconciliation/anticipations-panel.tsx) (alternativa C10, 2026-11-14). São as parcelas pagas antes do vencimento original, agrupadas em semanas retráteis pela data do pagamento, com o vencimento original, os dias antecipados, o líquido original, o custo (`AdvanceRateAmount`) e a taxa efetiva ao mês, que é custo ÷ (líquido × dias ÷ 30). Ela lê a mesma conferência mensal salva do Recebido (`view: "saved"`); **Reconferir agora** consulta ao vivo, sem gravar.

[`syncStonePortfolio`](../../../src/features/financial/receivables/portfolio-sync.server.ts) lê fonte configurada, data de publicação e arquivos diários, obtém direitos da posição, projeta a carteira e salva snapshot. Usa trava com expiração para impedir sincronizações simultâneas; se já estiver atualizado para a data/versão/mapeamento, retorna o resumo existente. [`readStonePortfolio`](../../../src/features/financial/receivables/portfolio-sync.server.ts) valida workspace, código, unidade, conta, mapeamento e versão do snapshot, além de sinalizar `stale` quando a data publicada mudou. A consulta de mapeamento fica em [`mapping.server.ts`](../../../src/features/financial/receivables/mapping.server.ts).

## Dados, permissões e impacto

| Local | Efeito observado |
| --- | --- |
| Stone Agenda XML | Fonte externa da consulta de período, posição e sincronização. [Transporte](../../../src/lib/integrations/stone/agenda-transport.ts). |
| Mapeamentos de lojista, conta bancária e unidades | Escopo de StoneCode para quiosque e conta. [Mapeamento](../../../src/features/financial/receivables/mapping.server.ts). |
| Snapshot de carteira, arquivos diários, direitos e trava no banco financeiro | Cache de projeção e prevenção de trabalho concorrente. [Sincronização](../../../src/features/financial/receivables/portfolio-sync.server.ts). |

**Inferência de impacto:** mudança no mapeamento pode invalidar snapshot e visão da carteira; não reutilizar uma projeção com unidade/conta antiga. Falhas após adquirir a trava são tratadas com liberação no `finally`, mas resultados externos e snapshot não compartilham transação. Alterar o modelo de projeção exige conferir versões já publicadas e os consumidores do fluxo de caixa.

## Verificação e limites

Os [testes de período](../../../tests/unit/stone-receivable-period.test.ts), [autorização da carteira](../../../tests/unit/stone-portfolio-auth.test.ts) e [projeção](../../../tests/unit/stone-portfolio-projection.test.ts) são referências. Para mudanças, conferir administrador versus perfil restrito, mapeamento alterado, snapshot antigo, trava concorrente, dia sem arquivo e limite do XML. Não foi consultada a Stone real neste levantamento.

## Relação com antecipação e PDV rastreada

A carteira e a posição são snapshots de direitos/eventos da Stone, conforme [`portfolio-sync.server`](../../../src/features/financial/receivables/portfolio-sync.server.ts); não são saldo bancário nem faturamento PDV. A [revisão de antecipações](stone-sales-review.md) usa data de pagamento e verifica diferenças/taxas por parcela sem baixar a carteira automaticamente. A comparação PDV × Stone é consulta independente de fatos diários, também sem gravação financeira. Não somar parcelas pagas antecipadamente outra vez ao saldo futuro, nem tratar sugestão de matching como recebimento bancário.

Para uma divergência, a cadeia de dependências é vínculo/vigência → arquivo/publicação → projeção/versão → consumidor; a consulta PDV verifica outro contrato (venda), e o extrato verifica crédito efetivo. Os caminhos e fronteiras de escrita estão rastreados; a concordância entre fontes reais continua na verificação integrada.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
