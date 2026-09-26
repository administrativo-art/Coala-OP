# Orçamentos financeiros por categoria e projeto

**Base:** main `70aaab65`. Rastreamento estático; integração externa e execução de scheduler não certificadas.

## Entradas e fluxo

[Configurações gerais](../../../src/app/dashboard/settings/page.tsx) e [financeiras](../../../src/features/financial/pages/settings-page.tsx) montam [BudgetsManagement](../../../src/features/financial/components/settings/budgets-management.tsx) e [gestão de projetos](../../../src/features/financial/components/settings/budget-projects-management.tsx). O [fluxo de caixa](cash-flow.md) usa resumos e pode simular residual de orçamento sem criar despesa.

As rotas de [orçamentos](../../../src/app/api/financial/budgets/route.ts), [regras](../../../src/app/api/financial/budget-rules/route.ts), [projetos](../../../src/app/api/financial/budget-projects/route.ts) e [insumos](../../../src/app/api/financial/budget-inputs/route.ts) validam entrada por [schemas](../../../src/features/financial/budgets/schemas.ts) e delegam ao [serviço](../../../src/features/financial/budgets/service.server.ts). Endpoints individuais, prévia, geração e vínculo/desvínculo constam no [inventário](../surface-inventory.md).

## Dados e autorização

`budgetActor` em [access.server](../../../src/features/financial/budgets/access.server.ts) exige sessão. Leitura: administrador padrão ou `financial.view` com `financial.settings.view` ou `financial.cashFlow.view`. Gestão: administrador padrão ou `financial.view`, `financial.settings.view` e `financial.settings.manageBudgets`.

Projetos usam adicionalmente `projectBudgetActor`: exigem acesso a todas as unidades, pois ainda não têm centro próprio. A projeção global aplica a mesma restrição. Não há nova permissão nem migração de perfis.

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

Conversão de VT rateado por centro: a origem pode conter `isApportioned` quando as parcelas pessoais identificam a mesma pessoa/conta e conservam o total, com centros resolvidos sem ambiguidade. Percentuais devem totalizar 100% e concordar com os valores pessoais (tolerância de um centavo por arredondamento). Os valores pessoais exatos de cada centro são preservados nos destinos, sem redistribuição. Listagem, prévia e confirmação normalizam nomes legados em IDs; a conversão lê essas referências dentro da transação. Rateio só percentual, centro ausente/ambíguo, outra pessoa/conta ou atividade financeira continuam bloqueados. Cobertura de regressão nos testes unitários e de integração acima; nenhuma nova permissão ou rotina recorrente.

## Cronograma de projetos por competência ou período

Ajuste de 2026-09-26: [contrato completo](../project-budget-cashflow.md). O cadastro escolhe um mês ou datas inclusivas; o desembolso pode ser uniforme por dia (etapas mensais) ou até 36 etapas com valores/data exatos. A referência inicial é preservada; revisão do limite exige motivo e cronograma correspondente. Projetos legados só passam a projetar depois de configuração explícita, sem backfill.

Cada despesa pertence a uma única etapa do projeto e reduz apenas seu saldo esperado, considerando rateio elegível. Competência, vencimento e pagamento da despesa não são reescritos; pagar não consome novamente. [POST stages](../../../src/app/api/financial/budget-projects/%5Bid%5D/stages/route.ts) encerra/reabre a expectativa com motivo, confirmação e evidência atual em transação. Revisão sem mudança preserva o encerramento; alteração relevante exige nova conferência. Documento ausente, rateio inválido ou etapa não atribuída suspende a projeção com aviso.

Evidências locais deste ajuste: 1498 testes unitários, 28 de integração no emulador e build concluídos. [Testes do cronograma](../../../tests/unit/financial-project-cash-plan.test.ts) cobrem centavos, limites e não duplicidade. E2E de API incluído na suíte isolada; não confundir esses testes com homologação visual ou execução real.
