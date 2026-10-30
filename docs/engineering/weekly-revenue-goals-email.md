# Placar Coala — relatório semanal de faturamento e metas

## Estado

Implementado em 29/10/2026, **sem deploy, sem push e sem envio**: `weeklyRevenueGoalsEmail` em [weekly-revenue-goals-email.ts](../../functions/src/weekly-revenue-goals-email.ts) (leitura, trava de cobertura, envio único por semana) e cálculo/montagem puros em [weekly-revenue-goals-report.ts](../../functions/src/weekly-revenue-goals-report.ts), com teste em `tests/unit/weekly-revenue-goals-report.test.ts`.

Agenda: toda segunda-feira às 08:00, no fuso `America/Belem`. O layout foi validado em 29/10/2026 com uma prévia de dados reais da semana de 19 a 25/10/2026 (não versionada).

Decisões de implementação, todas configuráveis por parâmetro da função até confirmação:

- Remetente e destinatário: `Margaret Hamilton · Coala One <relatorios@coalashakes.com>` → `administrativo@coalashakes.com` e `cesar@cesarthimotheo.com`, definidos em 29/10/2026 (`REVENUE_GOALS_EMAIL_FROM`, `REVENUE_GOALS_EMAIL_TO`, lista separada por vírgula).
- Cobertura mínima da semana para enviar: 80% dos dias esperados (`REVENUE_GOALS_MIN_WEEK_COVERAGE`). Abaixo disso o envio é bloqueado e registrado em `scheduledEmailRuns` com `status: blocked`.
- Status do mês: `No ritmo` ≥ 100% do esperado, `Atenção` ≥ 95%, `Em risco` abaixo (`REVENUE_GOALS_ON_TRACK_PERCENT`, `REVENUE_GOALS_ATTENTION_PERCENT`).
- Percentuais, esperado e status usam a **Meta Alvo**; UP e TOP aparecem na legenda com o quanto falta.
- Histórico legado (soma dos itens antes do contrato de cupons) entra com aviso na seção de qualidade.
- Comparações semanais usam a média por dia aberto, porque dia sem relatório fica ausente.
- Esperado do mês: distribuição configurada da meta. Em `scheduled_days`, mesmas datas do encerramento da meta (turnos de trabalho que contam para meta, de quem tem meta individual); sem escala encontrada, usa o calendário e avisa no cartão.
- O nome do relatório fica em `REPORT_NAME` ("Placar Coala").

## Objetivo

Enviar uma leitura executiva do desempenho comercial com três perguntas em ordem:

1. O que aconteceu com faturamento, pedidos e produtos?
2. Onde aconteceu, por unidade e no consolidado?
3. O resultado foi suficiente para cumprir as metas e manter o ritmo esperado?

## Períodos

- **Semana anterior:** segunda-feira a domingo completos.
- **Mês até o dia anterior:** do primeiro dia do mês até D-1.
- **Histórico:** últimos seis meses disponíveis, respeitando a cobertura real de cada unidade.
- **Consolidado geral:** soma das unidades elegíveis, sem preencher dias ausentes com zero.

### Comparadores

- Semana: comparar com a média das semanas completas disponíveis nos seis meses anteriores.
- Mês: comparar com o mesmo número de dias transcorridos em cada mês anterior.
- Metas: usar a distribuição configurada (`calendar_days` ou `scheduled_days`); não dividir a meta por 30 por conveniência.
- Unidade nova ou sem cobertura suficiente: mostrar `Histórico parcial` e omitir percentuais que induzam falsa precisão.
- Base igual a zero: não calcular crescimento percentual.

## Fonte e cobertura observada em 29/10/2026

Fonte operacional: `salesReports`, `kiosks`, `goalPeriods` e dados relacionados às metas.

- 679 relatórios diários de vendas.
- João Paulo: histórico desde 01/01/2026.
- Tirirical: histórico desde 01/01/2026.
- Shopping do Automóvel: histórico desde 05/08/2026.
- Produtos aparecem em praticamente todo o histórico.
- O contrato monetário reconciliado mais recente (`sourceCouponRevenueCents`) cobre principalmente cerca de 57–58 dias por unidade.

O histórico anterior pode ser reconstruído por `items.quantity × items.unitPrice`, mas deve ser identificado como **histórico legado** até validação ou reprocessamento. O e-mail sempre exibirá cobertura e qualidade dos dados.

## Hierarquia do e-mail

### 1. Cabeçalho Coala One

- Título: `Placar Coala — Faturamento e metas`.
- Períodos exatos analisados.
- Data e hora da atualização.
- Visual: fundo quente, superfícies brancas, cabeçalho escuro e rosa Coala (`#d13670`) como destaque.

### 2. Resumo executivo consolidado

Dois blocos: semana anterior e mês até D-1.

| Indicador | Semana | Mês até D-1 |
| --- | ---: | ---: |
| Faturamento líquido | R$ | R$ |
| Comparação histórica | % | % |
| Cupons/pedidos | quantidade | quantidade |
| Ticket médio | R$ | R$ |
| Itens vendidos | quantidade | quantidade |
| Itens por pedido | média | média |
| Média diária | R$ | R$ |
| Meta de faturamento | R$ | R$ |
| Atingimento | % | % |
| Unidades na meta | n/total | n/total |

No consolidado, somar apenas metas de faturamento. Metas de ticket e produto permanecem por unidade.

### 3. Leitura Coala

Texto curto gerado por regras determinísticas, com:

- três conclusões;
- dois pontos de atenção;
- uma oportunidade para a semana.

O texto deve explicar causa provável observável nos dados, como volume, ticket, mix, unidade ou dia. Não atribuir causalidade externa sem evidência.

### 4. Comparação entre unidades

- barras proporcionais de participação no faturamento;
- faturamento, crescimento, ticket e atingimento da meta;
- ordem pelo maior faturamento semanal;
- sinalização de cobertura parcial.

### 5. Cartão por unidade

Cada unidade apresenta:

- faturamento semanal e mensal;
- pedidos, ticket, itens e média diária;
- participação no consolidado;
- melhor e pior dia;
- produto líder em faturamento;
- meta, realizado, atingimento e distância em reais;
- projeção do mês e média diária necessária;
- próximo patamar de premiação, quando configurado;
- metas de ticket e produto, sem consolidação indevida.

### 6. Produtos

- cinco maiores por faturamento;
- cinco maiores por quantidade;
- participação no faturamento;
- preço médio realizado;
- maiores crescimentos e quedas com volume mínimo;
- produtos novos e sem histórico comparável;
- produtos sem venda no período, apenas quando havia histórico relevante.

Mudanças de nome ou vínculo de `simulationId` precisam ser reconciliadas antes de comparar produtos.

### 7. Tendência de seis meses

- faturamento mensal;
- ticket médio;
- pedidos;
- atingimento das metas;
- frequência de cumprimento: `atingiu em n dos últimos períodos`;
- melhor e pior período;
- volatilidade por unidade.

### 8. Qualidade dos dados

- dias esperados e dias disponíveis;
- relatórios no contrato monetário atual;
- relatórios legados;
- dias ausentes ou divergentes;
- unidades sem seis meses completos;
- metas ausentes, encerradas incorretamente ou sem distribuição válida.

## Regras das metas

### Meta semanal encerrada

Somente quando houver período de meta compatível com a semana:

- alvo;
- realizado;
- percentual;
- diferença em reais;
- atingida/não atingida;
- faixa de premiação alcançada, se aplicável.

Não criar uma meta semanal artificial a partir de uma meta mensal.

### Meta mensal em andamento

- meta total;
- meta esperada até D-1 pela distribuição configurada;
- realizado acumulado;
- desvio do ritmo esperado;
- projeção de fechamento;
- média diária necessária nos dias restantes;
- status: `No ritmo`, `Atenção` ou `Em risco`, com limiares documentados antes da implementação.

### Metas de ticket e produto

Mostrar apenas na unidade correspondente. Não somar no consolidado.

## Fórmulas principais

- `faturamento = soma da receita líquida comprovada dos cupons`.
- `pedidos = soma da contagem de cupons`.
- `ticket médio = faturamento / pedidos`.
- `itens por pedido = quantidade de itens / pedidos`.
- `participação da unidade = faturamento da unidade / faturamento consolidado`.
- `atingimento = realizado / meta`.
- `distância da meta = realizado - meta`.
- `projeção mensal = realizado / dias distribuídos transcorridos × dias distribuídos totais`.
- `média necessária = max(meta - realizado, 0) / dias distribuídos restantes`.

Todos os cálculos monetários devem usar centavos inteiros internamente.

## Proteções

- Não enviar quando a cobertura do período estiver abaixo do limite aprovado; registrar falha operacional.
- Não tratar dia ausente como faturamento zero.
- Não misturar receita PDV com recebimentos Stone ou entradas bancárias.
- Não somar metas de naturezas diferentes.
- Não comparar produto sem identidade estável.
- Não expor colaboradores, operadores ou premiação individual neste e-mail administrativo.
- Registrar execução idempotente para impedir envio duplicado em retentativas.
- O envio é informativo e não altera metas, vendas ou financeiro.

## Pendências antes da publicação

1. Confirmar o nome do relatório.
2. Confirmar cobertura mínima e limiares de status (valores padrão acima).
3. Integrar por PR em `main` e publicar a função à parte; o merge não publica Functions.
4. Fazer um envio de teste autorizado antes da primeira segunda-feira.
