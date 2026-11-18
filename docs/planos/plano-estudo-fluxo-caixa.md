# Plano — Estudo de fluxo de caixa

Evolução da tela **Financeiro › Fluxo de caixa › Visão do caixa** (`src/features/financial/pages/cash-flow-page.tsx`) para responder, numa só tela com abas, quatro perguntas: *consigo pagar tudo?*, *quanto entra e quando, e onde está o dinheiro que já foi vendido?*, *o negócio está saudável?* e *o que já entrou e saiu?*. Abas desde 17/11/2026: Próximas semanas, Entradas (incorpora Onde está o dinheiro), Saúde do negócio e Movimentações.

Protótipo da primeira versão, aprovado em 15/11/2026 (superado pelos modelos de 17/11/2026 abaixo): artefato de design "Fluxo de caixa — Visão do caixa (padrão Coala)" (5 pranchas: Próximas semanas, Entradas, Onde está o dinheiro, Saúde do negócio, painel lateral da semana).

## Situação atual verificada (15/11/2026)

| Fonte | Onde está | Uso no estudo |
| --- | --- | --- |
| Saldo do Inter | API `GET /banking/v2/saldo` (escopo `extrato.read`, o mesmo do extrato em `src/lib/integrations/inter/statements.server.ts`) | Saldo inicial da projeção |
| Carteira Stone | `readStonePortfolio` (`receivables/portfolio-sync.server.ts`), parcelas abertas por `receivableItems` | Entradas garantidas de cartão no vencimento (valor líquido) |
| Boletos de depósito | `cashDepositBatches` (`cash-deposits/repository.server.ts`) | Espécie com boleto emitido (`issuing`/`issued`) e lotes ainda sem boleto (`open`/`locked`) |
| Vendas do PDV por forma | `cashClosures.expectedByChannelCents` (espécie, Pix, débito, crédito) | Média de 3 meses por dia da semana; espécie vendido e ainda não fechado |
| Despesas | `expenses` abertas (`pending`, `partially_paid`, previsões `forecast`), valor por `expenseCashForecastAmount` | Saídas na data de vencimento; vencidas entram na semana atual |
| Realizado | `transactions` da conta Inter (sem transferências) | Aba Saúde: entrou × saiu por mês |

## Decisões (15/11/2026)

- (Substituído em 17/11/2026 por período por calendário; ver abaixo.) Horizonte de 13 semanas, semanas de segunda a domingo, começando na semana de hoje.
- Vendas futuras projetadas pela **média dos últimos 3 meses** (90 dias de fechamentos), por dia da semana e forma de pagamento. (Cenários retirados em 17/11/2026.)
- Prazo do dinheiro = da venda até cair no Inter. Regra por etapa:
  - boleto emitido: emissão + 3 dias;
  - contado sem boleto (lote aberto ou fechamento aprovado não alocado): hoje + 7 + 3 dias;
  - vendido e não fechado: data da venda + prazo médio da unidade; enquanto a unidade tiver menos de 4 lotes pagos, usa 14 + 7 + 3 dias.
- Cartão e Pix projetados: Pix D+0, débito D+1, crédito D+30, já líquidos das taxas praticadas (0,75%, 1,46% e 2,22%).
- Mínimo de caixa = **2 semanas de saídas médias** dos últimos 3 meses.
- Acesso: somente o administrador padrão (mesma regra das demais telas de recebíveis). Os demais perfis continuam vendo apenas a aba Movimentações.
- Cálculo sob demanda no servidor, só leitura, consultas limitadas (ver custo abaixo). Snapshot diário fica para a fase 2, junto com o "previsto × realizado".

## Decisões de 17/11/2026 (redesenho aprovado pelo programador)

Modelos aprovados em artefatos de design da sessão de 17/11/2026 ("Visão do caixa" e "Despesas e orçamento"); implementação no worktree `Coala-OP-visao-caixa-redesign`, registro do chamado `2026-11-17-visao-caixa-redesign`.

- **Sem cenários.** Pessimista/otimista foram retirados; a projeção usa só a média de 3 meses. Em vez deles há o modo **Sem projeção** (padrão) e **Com projeção**.
- **Período por calendário**, de hoje até o fim do sexto mês seguinte (substitui as 13 semanas). Atalhos: Este mês, Até o fim do próximo mês, Próximos 3 meses e Personalizado. Agrupamento automático: dia até 35 dias, semana até 2 meses, mês acima (o usuário pode trocar). O saldo é sempre calculado desde hoje.
- **Saídas recorrentes pela média** de 3 meses por categoria, só no que ainda não está lançado nem pago no mês (regras em `model.ts`).
- **Entradas e Onde está o dinheiro viram uma aba:** etapas (Aguardando contagem → Contado, sem boleto → Boleto emitido → Stone) como filtro de um gráfico e uma tabela; pendências com próximo passo. "Aguardando contagem" substitui "Vendido, não fechado": o PDV fecha sozinho e o que falta é o Financeiro contar o malote numa sessão de contagem (a contagem só acontece na sessão).
- **Contas:** saldo operacional separado da reserva (investimento); a reserva só soma ao caixa quando o usuário marca. Estrutura pronta; ainda sem fonte de dados para a reserva.
- **Movimentações:** só o realizado, período passado por calendário, extrato agrupado como em Despesas. Os gráficos que saíram dela foram para Despesas (provisionado × pago por competência, na faixa do período) e para Orçamento × despesas (ritmo e curva do disponível), que continua onde está.
- Semanas e meses começam recolhidos nas tabelas; dias começam abertos.

### Custo (Firestore) após 17/11/2026

Por abertura do estudo, no pior caso: despesas abertas até 3.000 (1.500 por status) + fechamentos até 1.000 (antes 600; cobrem os 90 dias da média e as 8 semanas do acerto) + lotes até 200 + transações do Inter dos últimos 6 meses até 4.500 (antes 3.000 em 4 meses) + plano de contas até 800 (só nomes de categoria) + carteiras Stone ≈ 9.700 leituras. Uso esperado: administrador, cerca de 5 aberturas por dia ≈ 5 × 9.700 × 30 ≈ 1,5 milhão de leituras/mês no teto; o típico fica perto de 3 a 4 mil por abertura. Sem listeners nem polling; "Recalcular" refaz a mesma consulta. A faixa Por competência de Despesas e os cards de Orçamento não fazem leitura nova.

## Pendências de 17/11/2026

- Tela não vista no navegador nem conferida com dados reais; só typecheck, lint, testes dirigidos e renderização estática.
- Compras planejadas por orçamento e saldo esperado dos projetos não entram mais na Visão do caixa; levar para "Com projeção" (APIs existentes, sem consumidor hoje).
- "Saldo depois" por lançamento e a linha de saldo não existem em Movimentações (o saldo por conta só chega ao administrador).
- Movimentos do Inter sem plano de contas entram como "Saídas sem classificação" na média recorrente; transação vinculada a despesa só tem a categoria do próprio registro.
- Conta de investimento e outras contas bancárias: sem fonte de saldo.
- Acerto da média compara a média com as vendas dos fechamentos, não com o que caiu no Inter (a ligação venda → recebimento depende do prazo de cada forma de pagamento).

## Custo estimado (Firestore)

Por abertura da tela: até 1.500 despesas abertas, até 400 fechamentos (90 dias × unidades), até 200 lotes, 1 a 3 carteiras Stone, até 3.000 transações do Inter (4 meses). Uso esperado: administrador, cerca de 5 aberturas por dia ≈ 5 × 5.100 × 30 ≈ 765 mil leituras/mês no pior caso; típico bem menor (≈ 2 mil leituras por abertura). Sem listeners nem polling; o botão "Recalcular" refaz a mesma consulta.

## Pendências a confirmar

- Dinheiro da Stone: a projeção trata a liquidação Stone como entrada no caixa no vencimento; a transferência Stone → Inter (2ª parte da conciliação) ainda não está modelada.
- Despesas recorrentes ainda não provisionadas não entram (só o que já existe em `expenses` e as previsões).
- Duplicidade conhecida de outubro (boleto de depósito R$ 1.157,00 lançado como receita e como transferência) distorce a aba Saúde até ser corrigida; correção do código e script de outubro seguem em chamado próprio.
- Fase 2: snapshot diário da projeção para medir "previsto × realizado" e o indicador de acerto.

## Ordem de execução

1. Modelo puro `src/features/financial/cash-flow-study/model.ts` com testes unitários.
2. Carregador no servidor e saldo do Inter (`cash-flow-study.server.ts`, `getInterBalance`).
3. Rota `GET /api/financial/cash-flow-study` com `secureRoute` (administrador padrão).
4. Abas na Visão do caixa: Próximas semanas, Entradas, Onde está o dinheiro, Saúde do negócio, Movimentações; painel lateral da semana.
5. Documentação de fluxo, inventários e verificação.
6. Fase 2: snapshot diário e previsto × realizado.
