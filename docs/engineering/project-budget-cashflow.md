# Orçamento de projeto: competência, período e desembolso

- `periodMode=competence`: um mês. `date_range`: datas inclusivas de duração prevista. Os campos de mês canônicos continuam indexáveis; nenhum vínculo altera competência, vencimento ou pagamento da despesa.
- Projetos legados sem `cashPlan` não ganham previsão automaticamente. Configuração explícita exige motivo; vínculos existentes devem ser associados a etapas antes de projetar.
- `cashPlan` uniforme é materializado em etapas mensais por divisão diária em centavos. Personalizado tem até 36 etapas, com datas no período e soma igual ao limite. Período limitado a 732 dias.
- A primeira configuração é preservada em `originalCashPlan`. Revisões transacionais guardam estado anterior, alterações, autor e motivo. Alterar limite de projeto com planejamento exige distribuir novamente o cronograma.
- Vínculo exclusivo de despesa continua protegido por claim transacional. `expenseStageIds` relaciona cada despesa a uma etapa. Rateio considera apenas contas elegíveis. Despesa real consome o planejamento ao existir, independentemente do pagamento; o fluxo existente mantém o vencimento/agendamento e a baixa real.
- O fluxo adiciona somente `max(0, previsto da etapa - comprometido elegível)`, nunca o total orçado mais o boleto. Estouro de uma etapa não remove silenciosamente a expectativa de outra.
- Encerrar uma expectativa exige motivo, confirmação e evidência atual dos documentos/valores. Não liquida despesas. Mudança monetária/competência ou desvinculação reabre a conferência; mudança apenas de status de pagamento não consome de novo. Expectativa pode ser dispensada mesmo sem despesa, com justificativa.
- Em período personalizado, competência externa produz aviso mas não exclui uma despesa explicitamente vinculada. O contrato legado permanece mensal. Vencimento fora do período nunca é motivo de exclusão.
- Expectativas vencidas são mostradas na data da consulta marcada como revisão pendente; o plano original não é reescrito. Documentos ausentes, rateios inválidos ou vínculos sem etapa suspendem projeção com aviso, não produzem um saldo silenciosamente confiável.

## Escopo e coexistência

Projetos ainda não têm centro próprio: API exige permissão financeira e acesso global às unidades. Configuração exige `settings.view` e `manageBudgets`; projeção exige `cashFlow.view`. Firestore direto permanece negado. Não houve criação de perfis nem migração de usuários.

Projetos aparecem no fluxo em Todas as contas / Todos os centros, sem atribuir banco arbitrariamente. Envelopes mensais nas mesmas contas são excluídos da simulação adicional quando há previsão de projeto. Coexistência com planejamento por colaborador suspende a previsão do projeto e exibe aviso. Provisões avulsas sem vínculo de projeto não podem ser inferidas como duplicatas: a projeção do projeto nas mesmas contas/intervalo é suspensa com aviso, mantendo as provisões. Nenhum lançamento é cancelado automaticamente.

O filtro “Até o mês” permite consultar meses futuros; selecionar três meses até dezembro mostra outubro, novembro e dezembro no mesmo gráfico, listagem e consulta de projeções. A simulação do envelope mensal e o gráfico de competência usam o mês selecionado, não o relógio atual.

Os limites inclusivos da consulta usam o fuso financeiro canônico de Belém, independentemente do fuso do navegador/servidor. Regressão protegida em UTC, Belém, Los Angeles e Tóquio.

## Consultas e publicação

Sem polling: consulta de projetos ativos com `cashPlanningEnabled=true` e `cashPlanStartDate<=to`, limite 51; até 500 IDs de despesas referenciados. Não há consulta irrestrita à coleção de despesas. Índice `financialBudgetProjects(active,cashPlanningEnabled,cashPlanStartDate)` necessário no banco financeiro antes do rollout. Projetos concluídos devem ser inativados.

Estimativa incremental usual: 70 documentos × 2 atualizações/h × 10 usuários × 8h × 22dias = 246.400 leituras/mês; teto operacional de 551 documentos por chamada. GET não escreve. Nenhuma migração em produção é necessária ou automática.

Cobertura: testes unitários de centavos, limites, competência, rateio, pagamento, encerramento e vencidos; integração transacional no emulador; cenário E2E de API em `tests/e2e/financial/budgets.spec.ts`. Execução da suíte de navegador exige autorização específica.
