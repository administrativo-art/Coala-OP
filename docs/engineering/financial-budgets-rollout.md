# Orçamentos financeiros — implantação e limites

Os envelopes mensais e projetos são cadastros de planejamento: não criam despesa, não agendam nem pagam. Despesas reais das contas escolhidas comprometem automaticamente o envelope do mês da competência, inclusive apenas a parcela pertinente de um rateio. Provisões de previsão não são contadas como gasto real.

## Modos de criação

- Manual: cria apenas a competência selecionada.
- Automático fixo: repete o valor informado em cada competência.
- Último mês fechado ou média: consulta despesas reais das contas escolhidas; se faltar histórico, a prévia bloqueia a regra.
- Consumo e preços: usa relatórios completos de consumo, estoque da matriz, pedidos confirmados e histórico de custo efetivo. A prévia é obrigatória. Se faltarem dados confiáveis, a geração falha explicitamente, sem inventar um valor.
- Projeto: orçamento separado com período e associação explícita de despesas. Uma despesa não pode ser vinculada a dois projetos.

Valores gerados são snapshots mensais; recálculos posteriores não alteram automaticamente o valor original. Revisões de valor ou composição exigem motivo. Uma conta não pode pertencer a dois envelopes ativos da mesma competência e centro. Centros diferentes podem usar a mesma conta; um envelope global conflita com todos os centros. A mesma exclusividade vale para regras automáticas e é garantida em transação por claims compartilhados, compatíveis com os claims globais legados.

## VT e outros orçamentos de pessoal por centro

- O boleto continua sendo uma única despesa/pagamento. Cada parcela interna identifica colaborador, conta e centro de custo; o centro administrativo do cabeçalho não substitui esses rateios. A tela de despesa mostra centro e subtotais mesmo quando há apenas uma pessoa.
- Crie um orçamento por centro, manualmente ou por regra automática fixa. Selecione conta, colaboradores, valor de cada um e data esperada da compra. Na regra, informe dia, mês corrente/anterior, início/fim e antecedência de geração (0 ou 1 mês). Não há cálculo novo de tarifas, escalas ou dias trabalhados.
- A competência identifica o período de uso; a data esperada da compra determina a saída projetada no caixa. Os IDs de pessoa são os canônicos OP resolvidos pelo vínculo existente com RH; IDs de Bizneo/PDV permanecem externos. Não há migração global de identidade nesta entrega.
- O cadastro revalida pessoas selecionadas, atividade OP/RH, admissão e vínculo confiável. Divergência de identidade/data ou desligamento em andamento exige revisão. A consulta de nomes é mínima, paginada e limitada ao escopo do perfil; não libera o diretório inteiro do RH.
- RH e Financeiro usam bancos distintos: a validação de elegibilidade é um preflight, não uma transação entre bancos. Uma alteração concorrente do vínculo ou desligamento exige nova conferência antes de usar o planejamento gerado.
- Um documento real compromete o orçamento mesmo antes do pagamento. O saldo matemático não prova que ainda haverá compra: confirme cobertura **parcial**, **final** ou **compra dispensada**, com justificativa. Cobertura final mantém o saldo econômico e zera a compra esperada. Dispensa só é aceita sem documento para a linha.
- A confirmação exige todos os documentos atuais e seus fingerprints. Mudança de competência, valor, rateio ou suporte documental invalida a cobertura; pagamento/estorno do pagamento, sem mudança do documento, não a reabre. Cancelamento ou boleto complementar exige nova conferência.
- Ausência de colaborador no boleto, rateio inválido ou centro não identificado aparece como pendência, não como nova dívida. Nenhum valor é transferido silenciosamente para a matriz.
- Desligamento encerra apenas expectativas de competências futuras em snapshots ativos, com auditoria. Não apaga o planejado nem cancela o boleto compartilhado; reativação de expectativa encerrada não é permitida por revisão comum.

## Caixa, DRE e transição das previsões antigas

O caixa apresenta separadamente contas a pagar e compras planejadas. O residual da composição entra pela data de compra; não entra novamente no cenário genérico de saldo do envelope. Se houver previsão antiga da mesma pessoa/conta/competência, mesmo em outro centro, a nova projeção fica suspensa com alerta até a conversão. O comparativo da DRE fica separado dos lançamentos; não cria despesas virtuais nem muda silenciosamente a política global da DRE. Um centro compartilhado só aparece quando todas as suas unidades estão autorizadas/selecionadas, sem divisão presumida.

A ferramenta administrativa em Orçamentos permite consultar previsões abertas de VT, preparar a composição, examinar prévia e confirmar a conversão em etapa separada. Preserva exatamente pessoa, conta, competência, valor total e data de compra; a distribuição entre centros precisa estar explicitamente cadastrada. Somente administrador padrão pode converter. A prévia não grava; confirmação desatualizada, pagamento, solicitação bancária, documento real, conciliação ou obrigação compartilhada bloqueiam a operação.

Na conversão, previsão e obrigação exclusiva elegível ficam `cancelled`/`CANCELLED`, com motivo `MIGRATED_TO_BUDGET`, destinos e auditoria. Nunca são marcadas pagas ou conciliadas artificialmente. Repetir a mesma confirmação é idempotente. As regras impedem alterar/excluir a previsão convertida ou forjar o marcador pelo cliente. Rotinas administrativas com Admin SDK também devem respeitar o marcador: regras Firestore não restringem Admin SDK. Não há gerador operacional de VT no produto a alterar nesta entrega.

Previsão individual rateada entre centros também pode ser convertida, desde que tenha parcelas pessoais completas e compatíveis com os percentuais. Não se calcula uma divisão nova: os centavos de cada centro devem coincidir com os destinos. Nomes legados são resolvidos em IDs na transação; referência ambígua ou ausente bloqueia. Rateio sem parcelas pessoais explícitas e rateio entre planos de contas continuam fora desse procedimento.

Implantar código não converte dados existentes. A conversão real requer análise e autorização próprias. Para reversão, não apague marcadores nem reative previsões diretamente: revise o estado atual, documentos e projeções, e faça uma operação compensatória auditada. Desabilitar a nova interface não desfaz uma conversão.

## Implantação

1. Implantar índices de `firestore.financial.indexes.json` no banco `coala-financeiro`, índices de usuários de `firestore.indexes.json` no banco principal e `firestore.financial.rules`, conforme o processo do projeto, além do app e de `financialBudgetGeneration` em Cloud Functions.
2. Definir `FINANCIAL_BUDGET_SCHEDULER_SECRET` com o mesmo valor no app Next.js e no secret da Cloud Function. Não registrar o valor em arquivos ou logs.
3. A função usa por padrão `https://op.coalashakes.com/api/jobs/financial-budgets/generate`. Definir `FINANCIAL_BUDGET_GENERATION_URL` somente se o backend de destino for diferente; a URL deve ser HTTPS e corresponder ao ambiente implantado.
4. Confirmar permissões existentes: acesso-base `financial.view`; leitura por Configurações ou Fluxo de Caixa; gestão com `financial.settings.view/manageBudgets`. Composição nominal exige `financial.personnelCosts.view`, e edição/conferência exige também `edit`. Perfis sem acesso nominal recebem somente agregados. Conversão exige administrador padrão. APIs validam escopo de unidades; Firestore direto dos orçamentos permanece fechado. Não há permissão nova nem elevação automática de perfis.
5. Conferir no primeiro mês a prévia e a geração de um envelope de teste. O agendador roda diariamente às 03:30, fuso `America/Belem`, para gerar a competência corrente e, somente para regras com antecedência ativada, a próxima, de forma idempotente.

## Verificação

Rodar `npm run verify`, `npm run check:rules` e `npm run test:integration`. O E2E em `tests/e2e/financial/budgets.spec.ts` usa somente projeto demo e emuladores e requer autorização específica de execução. Nesta tarefa, foi escrito, mas não executado: navegador não autorizado. Se Functions forem alteradas na implantação, verificar também seu build. Conferir interface em homologação somente quando autorizado.

Limites: 100 envelopes por mês/listagem, 100 regras, 2.000 despesas por competência, 100 pessoas por composição e 100 despesas por projeto. Projeção consulta até 12 meses de compra, 300 envelopes e 13 competências; DRE até 100 envelopes por competência e reaproveita despesas já carregadas. Conversão: 20 origens/100 destinos por lote. Desligamento: 100 envelopes futuros por pessoa, bloqueando acima do limite. Consultas têm sentinela contra truncamento, não polling. Nomes: páginas de 50 (até duas consultas de 51 para perfil restrito).

Despesas legadas sem `competenceMonth` canônico não entram na consulta mensal; revisar antes de usar histórico. Índices derivados `purchaseMonths` e `compositionEmployeeIds` são mantidos nos novos snapshots. Orçamentos legados sem composição continuam compatíveis. A estimativa por consumo só aceita estoque da matriz e não substitui previsão operacional de vendas/receitas.
