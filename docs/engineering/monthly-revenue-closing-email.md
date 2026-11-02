# Placar Coala — fechamento mensal de faturamento e metas

## Estado

Implementado em 02/11/2026, **sem deploy e sem envio até a autorização de publicação**: `monthlyRevenueClosingEmail` em [monthly-revenue-closing-email.ts](../../functions/src/monthly-revenue-closing-email.ts) e cálculo/montagem puros em [monthly-revenue-closing-report.ts](../../functions/src/monthly-revenue-closing-report.ts), com teste em `tests/unit/monthly-revenue-closing-report.test.ts`. Reaproveita a leitura (`loadReportInput`), a agregação e os componentes visuais do [relatório semanal](weekly-revenue-goals-email.md).

Agenda: todo dia 1º às 09:00, fuso `America/Belem`, relatando o **mês civil anterior completo**. O horário é 09:00 (e não 08:00) para dar margem à chegada do relatório do último dia. Qualquer execução em novembro fecha outubro; a execução é idempotente por mês relatado (`scheduledEmailRuns/monthly-revenue-closing-AAAA-MM`), então um disparo manual no mesmo mês não duplica o envio.

Remetente, destinatários, segredo do Resend e cobertura mínima são os mesmos do semanal (`REVENUE_GOALS_EMAIL_FROM`, `REVENUE_GOALS_EMAIL_TO`, `RESEND_API_KEY`, `REVENUE_GOALS_MIN_WEEK_COVERAGE`, aqui aplicada aos dias do mês).

## Conteúdo

Um único e-mail, consolidado primeiro e depois cada unidade:

1. Cabeçalho com o mês e avisos (metas ainda não encerradas; dias sem relatório).
2. Em 30 segundos: leitura determinística (líder, variação por dia aberto, metas batidas ou não, melhor dia, maior alta, oportunidade).
3. Resultado da rede: faturamento, pedidos, ticket, itens, itens por pedido e média por dia aberto, contra o mês anterior e a média dos meses anteriores.
4. Metas do mês: Meta Alvo, faixas UP/TOP, realizado, diferença em reais e unidades que bateram.
5. Unidades lado a lado e um cartão por unidade (meta, melhor/menor dia, média por dia da semana, 5 produtos, meses seguidos batendo a Meta Alvo).
6. Produtos da rede, tendência de 6 meses (último ponto é o mês fechado) e qualidade dos dados.

## Regras

- **Meta encerrada:** quando `goalPeriods.status = closed`, o realizado é `currentValue`. Enquanto o período estiver aberto, o realizado é a soma de `dailyProgress`, o e-mail avisa "Metas ainda não encerradas no sistema" e a unidade aparece como "Em apuração", sem veredito de atingimento.
- Percentuais e veredito usam a Meta Alvo; UP e TOP são faixas. Ticket e produto não são consolidados. Sem colaboradores, operadores ou premiação individual.
- Dia sem relatório fica ausente (nunca zero); comparações usam a média por dia aberto. Abaixo da cobertura mínima o envio é bloqueado e registrado.
- Receita = vendas do PDV comprovadas nos cupons, sem Stone nem entradas bancárias.

## Lacunas conhecidas

- Não há acumulado do ano: a leitura carrega 8 competências de `salesReports`, não o ano inteiro.
- Não há quebra por semana do mês; o padrão por dia da semana cobre essa leitura.
- Leitura por execução: as mesmas ~1 mil leituras do semanal, uma vez por mês.
- Deploy e execução real não comprovados até o primeiro envio.
