# Plano — Estudo de fluxo de caixa (13 semanas)

Evolução da tela **Financeiro › Fluxo de caixa › Visão do caixa** (`src/features/financial/pages/cash-flow-page.tsx`) para responder, numa só tela com abas, quatro perguntas: *consigo pagar tudo?*, *quanto entra e quando?*, *onde está o dinheiro?* e *o negócio está saudável?*. A lista atual de movimentações continua como a última aba.

Protótipo aprovado em 15/11/2026: artefato de design "Fluxo de caixa — Visão do caixa (padrão Coala)" (5 pranchas: Próximas semanas, Entradas, Onde está o dinheiro, Saúde do negócio, painel lateral da semana).

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

- Horizonte de **13 semanas**, semanas de segunda a domingo, começando na semana de hoje.
- Vendas futuras projetadas pela **média dos últimos 3 meses** (90 dias de fechamentos), por dia da semana e forma de pagamento. Cenários: pessimista −15% e otimista +10% sobre as vendas projetadas; o garantido não muda.
- Prazo do dinheiro = da venda até cair no Inter. Regra por etapa:
  - boleto emitido: emissão + 3 dias;
  - contado sem boleto (lote aberto ou fechamento aprovado não alocado): hoje + 7 + 3 dias;
  - vendido e não fechado: data da venda + prazo médio da unidade; enquanto a unidade tiver menos de 4 lotes pagos, usa 14 + 7 + 3 dias.
- Cartão e Pix projetados: Pix D+0, débito D+1, crédito D+30, já líquidos das taxas praticadas (0,75%, 1,46% e 2,22%).
- Mínimo de caixa = **2 semanas de saídas médias** dos últimos 3 meses.
- Acesso: somente o administrador padrão (mesma regra das demais telas de recebíveis). Os demais perfis continuam vendo apenas a aba Movimentações.
- Cálculo sob demanda no servidor, só leitura, consultas limitadas (ver custo abaixo). Snapshot diário fica para a fase 2, junto com o "previsto × realizado".

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
