# Orçamentos financeiros por categoria e projeto

**Base:** main `70aaab65`. Rastreamento estático; integração externa e execução de scheduler não certificadas.

## Entradas e fluxo

[Configurações gerais](../../../src/app/dashboard/settings/page.tsx) e [financeiras](../../../src/features/financial/pages/settings-page.tsx) montam [BudgetsManagement](../../../src/features/financial/components/settings/budgets-management.tsx) e [gestão de projetos](../../../src/features/financial/components/settings/budget-projects-management.tsx). O [fluxo de caixa](cash-flow.md) usa resumos e pode simular residual de orçamento sem criar despesa.

As rotas de [orçamentos](../../../src/app/api/financial/budgets/route.ts), [regras](../../../src/app/api/financial/budget-rules/route.ts), [projetos](../../../src/app/api/financial/budget-projects/route.ts) e [insumos](../../../src/app/api/financial/budget-inputs/route.ts) validam entrada por [schemas](../../../src/features/financial/budgets/schemas.ts) e delegam ao [serviço](../../../src/features/financial/budgets/service.server.ts). Endpoints individuais, prévia, geração e vínculo/desvínculo constam no [inventário](../surface-inventory.md).

## Dados e autorização

`budgetActor` em [access.server](../../../src/features/financial/budgets/access.server.ts) exige sessão. Leitura: administrador padrão ou `financial.view` com `financial.settings.view` ou `financial.cashFlow.view`. Gestão: administrador padrão ou `financial.view`, `financial.settings.view` e `financial.settings.manageBudgets`.

O serviço mantém `financialBudgets`, `financialBudgetRules`, reservas de contas por competência/regra, `financialBudgetProjects`, reservas de despesas por projeto, revisões e eventos. Criação e reservas são transacionais; alteração de limite exige justificativa e registra revisão. Vínculo/desvínculo da despesa ao projeto atualiza projeto, reserva e evento na mesma transação. Consultas de resumo usam competência e limites; conferir erro/limite antes de assumir cobertura completa de coleções crescentes.

## Geração e consumidores

Regras geram IDs por `${ruleId}_${month}`. [financialBudgetGeneration](../../../functions/src/financial-budget-jobs.ts) agenda diariamente às 03h30 de Belém e chama por POST a [rota de geração](../../../src/app/api/jobs/financial-budgets/generate/route.ts), que valida segredo do scheduler. `generateScheduledBudgetMonths` gera mês atual e seguinte, neste último aplicando antecipação das regras; erros de domínio por regra retornam resultado ignorado. Existência do export não prova configuração ou execução em produção. Despesas existentes alimentam comprometimento; simulação de caixa não autoriza pagamento.

## Verificação e limites

Referências: [consumo](../../../tests/unit/financial-budget-consumption.test.ts), [estimativa de insumos](../../../tests/unit/financial-budget-input-estimate.test.ts), [consumo por projeto](../../../tests/unit/financial-budget-project-consumption.test.ts) e [E2E de orçamento](../../../tests/e2e/financial/budgets.spec.ts). Não executamos navegador nem scheduler nesta integração documental. Antes de mudanças, validar perfis restritos, concorrência de reserva, revisão justificada, competência, vínculo repetido e falha de geração. Ver [verificação por grupo](../flow-verification.md).

## Composição pessoal, escopo e conversão

Orçamentos/regras podem pertencer a centro de resultado. [Referências](../../../src/features/financial/budgets/references.server.ts) conferem todas as unidades do centro; consulta sem centro exige acesso a todas. [Reservas de contas](../../../src/features/financial/budgets/claims.ts) distinguem global e centro e impedem sobreposição. Composição pessoal registra pessoa, conta, valor e data esperada de compra; vínculos canônicos OP/RH e elegibilidade na competência são conferidos no servidor.

[Permissões nominais](../../../src/features/financial/budgets/personnel-access.ts): leitura requer `financial.personnelCosts.view`; edição de composição requer também `personnelCosts.edit` e gestão de orçamento. Respostas sem leitura nominal omitem composição, snapshots e textos pessoais por lista explícita de campos. [Serviço](../../../src/features/financial/budgets/service.server.ts) confirma cobertura com justificativa/revisão em transação; elegibilidade RH é preflight separado, sem transação entre bancos.

[Conversão](../../../src/features/financial/budgets/forecast-conversion.server.ts) de provisões VT exige administrador padrão. Prévia produz fingerprint; confirmação revalida fonte e grava cancelamento, vínculos e `financialBudgetConversions` em transação. Repetição retorna operação persistida. [Desligamento](../../../src/features/financial/budgets/termination.server.ts) interrompe expectativas futuras com revisão auditável, preservando documento real/pagamento.

Testes adicionais disponíveis: [composição](../../../tests/unit/financial-budget-unit-composition.test.ts), [conversão](../../../tests/unit/financial-budget-conversion.test.ts), [integração](../../../tests/integration/financial-budgets.test.mjs). Ver [implantação e limites existentes](../financial-budgets-rollout.md); não executar conversão real só por integrar documentação.
