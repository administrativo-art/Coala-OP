# Orçamentos financeiros — implantação e limites

Os envelopes mensais e projetos são cadastros de planejamento: não criam despesa, não agendam nem pagam. Despesas reais das contas escolhidas comprometem automaticamente o envelope do mês da competência, inclusive apenas a parcela pertinente de um rateio. Provisões de previsão não são contadas como gasto real.

## Modos de criação

- Manual: cria apenas a competência selecionada.
- Automático fixo: repete o valor informado em cada competência.
- Último mês fechado ou média: consulta despesas reais das contas escolhidas; se faltar histórico, a prévia bloqueia a regra.
- Consumo e preços: usa relatórios completos de consumo, estoque da matriz, pedidos confirmados e histórico de custo efetivo. A prévia é obrigatória. Se faltarem dados confiáveis, a geração falha explicitamente, sem inventar um valor.
- Projeto: orçamento separado com período e associação explícita de despesas. Uma despesa não pode ser vinculada a dois projetos.

Valores gerados são snapshots mensais; recálculos posteriores não alteram automaticamente o valor original. Revisões de valor exigem motivo. Uma conta não pode pertencer a dois envelopes ativos da mesma competência.

## Implantação

1. Implantar índices de `firestore.indexes.json` e `firestore.financial.rules` conforme o processo do projeto, além do app e de `financialBudgetGeneration` em Cloud Functions.
2. Definir `FINANCIAL_BUDGET_SCHEDULER_SECRET` com o mesmo valor no app Next.js e no secret da Cloud Function. Não registrar o valor em arquivos ou logs.
3. A função usa por padrão `https://op.coalashakes.com/api/jobs/financial-budgets/generate`. Definir `FINANCIAL_BUDGET_GENERATION_URL` somente se o backend de destino for diferente; a URL deve ser HTTPS e corresponder ao ambiente implantado.
4. Confirmar permissões `financial.settings.manageBudgets` nos perfis autorizados. A leitura exige `financial.cashFlow.view`; escrita pelo cliente Firestore está bloqueada pelas regras e passa pela API.
5. Conferir no primeiro mês a prévia e a geração de um envelope de teste. O agendador roda diariamente às 03:30, fuso `America/Belem`, para gerar a competência corrente de forma idempotente.

## Verificação

Rodar `npm run verify`, `npm run check:rules`, build de Functions e `tests/e2e/financial/budgets.spec.ts` com emuladores. Validar no ambiente de homologação a tela de Configurações, a curva do Fluxo de Caixa e a opção de cenário. O cenário só acrescenta a parte ainda não comprometida nem já coberta por previsão de despesa, para evitar dupla contagem.

Limites atuais: até 100 envelopes por mês, 100 regras, 2.000 despesas por mês e 100 despesas por projeto. Despesas legadas sem `competenceMonth` canônico não entram na consulta mensal; migrá-las antes de usar meses históricos como base. A estimativa por consumo só aceita estoque da matriz nesta entrega e não substitui uma previsão operacional de vendas/receitas.
