# Entradas do dashboard: fluxo e impacto

Este inventário separa as **31 entradas de primeiro nível**. Ele registra o que a página realmente abre, o próximo arquivo a ler, dados/integrações observáveis e uma verificação útil. É um roteiro de investigação: não afirma que todos os subfluxos de uma área têm a mesma permissão. Comece pelo [mapa curto](system-map.md) e abra só a seção pertinente. Os [guias por domínio](modules) reúnem fluxos que atravessam mais de uma entrada.

## Pessoas, DP e documentos

### `users` — redirecionamento

[`users/page.tsx`](../../src/app/dashboard/users/page.tsx) redireciona para [`dp/collaborators`](../../src/app/dashboard/dp/collaborators/page.tsx). Criação e edição devem ser investigadas ali e nas rotas [`api/users`](../../src/app/api/users) e [`api/hr`](../../src/app/api/hr), conforme a ação. A rota antiga não contém a gestão de usuários. Confira acesso, perfil e primeiro acesso no servidor; veja [guia de pessoas](modules/people-hr-dp.md).

### `dp` — painel de departamento pessoal

[`dp/page.tsx`](../../src/app/dashboard/dp/page.tsx) reúne colaboradores, escalas, turnos e férias por hooks de bootstrap e da store de DP. A própria página verifica `permissions.dp?.view`. Para mudar um cartão, siga o hook usado por ele, depois a rota/coleção e a tela de detalhe: [`use-dp-bootstrap.ts`](../../src/hooks/use-dp-bootstrap.ts), [`use-dp-schedules-shifts.ts`](../../src/hooks/use-dp-schedules-shifts.ts), [`vacations/server.ts`](../../src/features/hr/vacations/server.ts). Confirme se um indicador é agregado localmente antes de alterar sua fonte.

### `collaborator` — painel pessoal

[`collaborator/page.tsx`](../../src/app/dashboard/collaborator/page.tsx) renderiza [`collaborator-dashboard-panel.tsx`](../../src/components/collaborator-dashboard-panel.tsx). O painel consulta [`api/collaborator/dashboard`](../../src/app/api/collaborator/dashboard/route.ts) e combina tarefas, reposição, sessões de contagem, escalas, formulários e metas. Uma mudança em um cartão pode exigir verificar o módulo de origem, a unidade e a permissão pessoal. Escalas têm rota própria [`collaborator/schedule`](../../src/app/dashboard/collaborator/schedule/page.tsx).

### `resignation` — pedido do colaborador

[`resignation/page.tsx`](../../src/app/dashboard/resignation/page.tsx) abre [`resignation-self-service.tsx`](../../src/features/hr/termination/resignation-self-service.tsx), que consulta e cria pedidos pela rota [`api/hr/terminations`](../../src/app/api/hr/terminations/route.ts). A carta passa por uma subrota de desligamento. Antes de alterar, confira a separação entre pedido do próprio colaborador e operação do DP; testes de desligamento em [`tests/unit`](../../tests/unit) e [mapa de efeitos](../termination-effects-map.md).

### `processes` — central de desligamentos

[`processes/page.tsx`](../../src/app/dashboard/processes/page.tsx) renderiza [`process-center-page.tsx`](../../src/features/hr/termination/process-center-page.tsx), que usa [`api/processes`](../../src/app/api/processes/route.ts). O nome da rota é genérico, mas a implementação atual pertence ao fluxo de desligamento. Confira também [`termination/server.ts`](../../src/features/hr/termination/server.ts), documentos, tarefas e provisões antes de alterar estados.

### `documents` — navegação documental

[`documents/page.tsx`](../../src/app/dashboard/documents/page.tsx) lista gestão de modelos/gerador, documentos da empresa, dos colaboradores e central de documentos gerados. A visibilidade usa `hasFormalizationPermission` em [`hr-formalization-permissions.ts`](../../src/lib/hr-formalization-permissions.ts). Cada destino tem rota e política próprias; leia [documentos e privacidade](modules/documents-privacy.md) e o endpoint específico antes de editar acesso, geração ou retenção.

## Finanças

### `financial` — painel financeiro

[`financial/page.tsx`](../../src/app/dashboard/financial/page.tsx) entrega [`financial-dashboard-page.tsx`](../../src/features/financial/pages/financial-dashboard-page.tsx). Essa página agrega diferentes visões; para alterar um número, siga o componente/hook daquele cartão até sua rota ou coleção. Despesas, caixa, solicitações, DRE e conciliação têm fluxos distintos em [Finanças](modules/finance.md). Não derive regra de pagamento de um total do painel.

## Compras, estoque e patrimônio

### `purchasing` — redirecionamento para pedidos

[`purchasing/page.tsx`](../../src/app/dashboard/purchasing/page.tsx) redireciona para [`purchasing/orders`](../../src/app/dashboard/purchasing/orders/page.tsx). Cotações, recebimento e financeiro de compras ficam em subrotas separadas, mas compartilham [`api/purchasing/[...path]`](../../src/app/api/purchasing/[...path]/route.ts). Essa rota grava pedidos, recebimentos, despesas e movimentos; veja [guia de compras](modules/commerce-stock.md) e [fluxo implementado](../purchasing-flow-implementation.md).

### `registration` — catálogo de cadastros

[`registration/page.tsx`](../../src/app/dashboard/registration/page.tsx) monta [`registration-catalog.tsx`](../../src/components/registration/registration-catalog.tsx) com a aba base. As telas de produtos base, itens e entidades têm subrotas em [`registration`](../../src/app/dashboard/registration). Para escrita, siga [`api/registry/[...path]`](../../src/app/api/registry/[...path]/route.ts) ou [`api/products`](../../src/app/api/products/route.ts). Compras depende desses cadastros; confira a coleção escolhida pelo caminho e a permissão da operação.

### `items` — página desativada

[`items/page.tsx`](../../src/app/dashboard/items/page.tsx) retorna `null`; o comentário indica que o conteúdo mudou para um modal. Procure o modal invocado pelo fluxo específico em [`components`](../../src/components) ou use as subrotas de [`registration`](../../src/app/dashboard/registration). Não direcione trabalho novo para esta página sem confirmar o ponto ativo.

### `stock` — menu de módulos

[`stock/page.tsx`](../../src/app/dashboard/stock/page.tsx) renderiza [`stock-management.tsx`](../../src/components/stock-management.tsx). Esse componente decide quais atalhos aparecem por `permissions.stock.*`, `permissions.purchasing?.view` e `permissions.reposition.view`. Ele é navegação; transferência, contagem, devolução, reposição e análise são subfluxos. Confirme mutação na subrota, hook e API indicados em [compras e estoque](modules/commerce-stock.md).

### `audit` — auditoria de estoque

[`audit/page.tsx`](../../src/app/dashboard/audit/page.tsx) monta [`stock-session-management.tsx`](../../src/components/stock-session-management.tsx). Ela chama [`api/stock/count-sessions`](../../src/app/api/stock/count-sessions/route.ts) para sessões de contagem, aprovação/rejeição e histórico. **Não confundir** com logs de auditoria em [`api/audit/logs`](../../src/app/api/audit/logs/route.ts). Verifique efeitos no estoque, responsável e testes de contagem; [guia](modules/commerce-stock.md).

### `inventory` — conversor

[`inventory/page.tsx`](../../src/app/dashboard/inventory/page.tsx) monta [`inventory-converter.tsx`](../../src/components/inventory-converter.tsx). Investigue ali a conversão, suas unidades e a atualização de estoque; não use a rota `inventory-control` como sinônimo. Verifique valores antes/depois da conversão e testes pertinentes ao componente.

### `inventory-control` — validade e movimentos

[`inventory-control/page.tsx`](../../src/app/dashboard/inventory-control/page.tsx) monta [`expiry-control.tsx`](../../src/components/expiry-control.tsx) e abre baixa, transferência, histórico, consumo por período e etiquetas. Histórico consulta [`api/stock/movement-history`](../../src/app/api/stock/movement-history/route.ts) pelo modal. Para uma mutação, vá à subrota de estoque correspondente e confira lotes e histórico; [guia](modules/commerce-stock.md).

### `expiry` — controle de validade

[`expiry/page.tsx`](../../src/app/dashboard/expiry/page.tsx) monta o mesmo [`expiry-control.tsx`](../../src/components/expiry-control.tsx) usado em `inventory-control`. Mudanças nesse componente afetam as duas entradas. Siga [`use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx) para lotes e movimentos; confirme a autorização das escritas e os cálculos de vencimento.

### `assets` — patrimônio

[`assets/page.tsx`](../../src/app/dashboard/assets/page.tsx) monta [`asset-management.tsx`](../../src/components/asset-management.tsx). A interface usa [`use-assets.ts`](../../src/hooks/use-assets.ts), upload por [`api/assets/upload`](../../src/app/api/assets/upload/route.ts) e permissões `assets.*`; rotas em [`api/assets`](../../src/app/api/assets) tratam cadastro/movimentos. Recebimento de compras também pode criar patrimônio e movimentos. Verifique origem de compra antes de editar campos bloqueados para esse caso; [guia](modules/commerce-stock.md).

## Comercial e operação

### `commercial` — catálogo comercial

[`commercial/page.tsx`](../../src/app/dashboard/commercial/page.tsx) abre [`catalogo-view.tsx`](../../src/components/catalogo/catalogo-view.tsx), que consulta [`api/catalogo`](../../src/app/api/catalogo/route.ts). A página usa [`commercial-permissions.ts`](../../src/lib/commercial-permissions.ts). Confirme quais produtos e preços a API devolve e a permissão da consulta antes de alterar a visualização; [guia](modules/commercial-operations.md).

### `conversions` — conversor de medidas

[`conversions/page.tsx`](../../src/app/dashboard/conversions/page.tsx) monta [`measure-converter.tsx`](../../src/components/measure-converter.tsx). A implementação desta entrada está no componente; confira fórmulas e unidades ali. Ela é distinta do conversor de inventário em `inventory` e das conversões de estoque apresentadas no menu de `stock`.

### `pricing` — menu de preços

[`pricing/page.tsx`](../../src/app/dashboard/pricing/page.tsx) oferece [`pricing/cost-analysis`](../../src/app/dashboard/pricing/cost-analysis/page.tsx) e [`pricing/price-comparison`](../../src/app/dashboard/pricing/price-comparison/page.tsx). Custo e margem usam contexto e cálculos de [`pricing-context.ts`](../../src/lib/pricing-context.ts); comparação tem dados de concorrentes. Verifique origem de custo e venda, parâmetros e permissões da tela específica; testes em [`pricing-context.test.ts`](../../tests/unit/pricing-context.test.ts) e [`pricing-insights.test.ts`](../../tests/unit/pricing-insights.test.ts).

### `goals` — redirecionamento para acompanhamento

[`goals/page.tsx`](../../src/app/dashboard/goals/page.tsx) redireciona no cliente para [`goals/tracking`](../../src/app/dashboard/goals/tracking/page.tsx). Registro, histórico e análise possuem subrotas próprias em [`goals`](../../src/app/dashboard/goals). Para mudar distribuição ou períodos, siga [`goals-context.tsx`](../../src/contexts/goals-context.tsx) e [`goals-distribution.ts`](../../src/lib/goals-distribution.ts); análises de IA passam por [`api/ai/analyze-goals`](../../src/app/api/ai/analyze-goals/route.ts).

### `operations` — painel operacional composto

[`operations/page.tsx`](../../src/app/dashboard/operations/page.tsx) combina produtos e vencimentos, consumo validado, auditoria, alertas de compra, tarefas e reposição. Os pontos de entrada incluem [`use-expiry-products.tsx`](../../src/hooks/use-expiry-products.tsx), [`useValidatedConsumptionData.ts`](../../src/hooks/useValidatedConsumptionData.ts), [`purchase-alert-card.tsx`](../../src/components/purchase-alert-card.tsx) e [`task-manager.tsx`](../../src/components/task-manager.tsx). O impacto depende do cartão; identifique o hook e siga seu módulo de origem. A mesma página pode mostrar dados de estoque e de tarefas.

### `reports` — seleção de análises de estoque

[`reports/page.tsx`](../../src/app/dashboard/reports/page.tsx) mostra um diálogo com atalhos para projeção, consumo, vendas, movimentos e avaliação do estoque. Ela usa permissões `stock.analysis.*` e `stock.inventoryControl.viewHistory`; não calcula o relatório nessa página. Investigue a subrota escolhida em [`stock/analysis`](../../src/app/dashboard/stock/analysis) e a fonte do indicador; [guia](modules/commercial-operations.md).

## Trabalho, formulários e suporte

### `forms` — central de formulários

[`forms/page.tsx`](../../src/app/dashboard/forms/page.tsx) monta [`forms-dashboard-shell.tsx`](../../src/components/forms/forms-dashboard-shell.tsx). O shell reúne projetos, tipos, modelos, templates, execuções e análises. Rotas em [`api/forms`](../../src/app/api/forms) separam gravação e leitura; modelos usam o banco `checklistDbAdmin`. Mudanças de execução podem afetar eventos, análises, retenção e tarefas; consulte [guia de formulários](modules/work-forms.md) e testes em [`tests/unit/forms-analytics`](../../tests/unit/forms-analytics).

### `tasks` — gerenciador de tarefas

[`tasks/page.tsx`](../../src/app/dashboard/tasks/page.tsx) monta [`task-manager.tsx`](../../src/components/task-manager.tsx), que usa [`use-all-tasks.tsx`](../../src/hooks/use-all-tasks.tsx) e [`use-tasks.ts`](../../src/hooks/use-tasks.ts). Rotas em [`api/tasks`](../../src/app/api/tasks) tratam projetos, status, tarefas e sincronização com recebimento de compras. Confirme origem, responsável, permissões e efeito de mudar o status; [guia](modules/work-forms.md).

### `help` — ajuda na interface

[`help/page.tsx`](../../src/app/dashboard/help/page.tsx) contém conteúdo de ajuda, acordeões e tabelas no próprio componente. Ao alterar texto, confira se ainda descreve as rotas atuais. Não há rota de persistência diretamente chamada nessa página; alterações de comportamento devem ocorrer no módulo correspondente.

### `manager-diary` — página desativada

[`manager-diary/page.tsx`](../../src/app/dashboard/manager-diary/page.tsx) retorna `null`. Não há diário ativo nessa entrada no checkout atual. Antes de responder sobre histórico de diário, procure a funcionalidade solicitada no restante do repositório; não presuma que essa rota armazena registros.

## Plataforma e configurações

### `settings` — configurações compostas

[`settings/page.tsx`](../../src/app/dashboard/settings/page.tsx) agrupa cadastro, DP, perfis, metas, compras, finanças, IA e bio pública em abas/componentes. A página usa `PermissionGuard`, `DPRuntimeGuard` e múltiplas permissões `settings.*`, `dp.*`, `financial.*`, `pricing.*`. Escolha a aba efetiva e siga seu componente/rota; os dados não pertencem a uma coleção única. Consulte [plataforma e integrações](modules/platform-integrations.md) e o guia do domínio alterado.

### `signage` — gestão de telas

[`signage/page.tsx`](../../src/app/dashboard/signage/page.tsx) monta [`signage-admin.tsx`](../../src/components/signage/signage-admin.tsx). A interface administra slides, upload, publicação por quiosque e heartbeat pelas rotas em [`api/signage`](../../src/app/api/signage). A rota pública [`public/[kioskId]`](../../src/app/api/signage/public/[kioskId]/route.ts) serve ao player; leia [`signage-auth.ts`](../../src/lib/signage-auth.ts) antes de alterar publicação ou acesso. Verifique a diferença entre rascunho, publicação e entrega ao player.

### `import` — página desativada

[`import/page.tsx`](../../src/app/dashboard/import/page.tsx) retorna `null` e aponta, em comentário, para [`stock/analysis/restock`](../../src/app/dashboard/stock/analysis/restock/page.tsx). Investigue a rota de reposição para o fluxo ativo.

### `predefined` — página desativada

[`predefined/page.tsx`](../../src/app/dashboard/predefined/page.tsx) retorna `null`. O comentário informa que a funcionalidade foi incorporada em outro lugar, sem indicar o destino; localize a ação desejada por nome antes de documentar qualquer fluxo.

### `team` — página desativada

[`team/page.tsx`](../../src/app/dashboard/team/page.tsx) retorna `null`. A entrada não implementa gestão de equipe neste checkout; para colaboradores, siga [`dp/collaborators`](../../src/app/dashboard/dp/collaborators/page.tsx).

## Limite deste nível

Cada seção identifica o primeiro caminho e as dependências visíveis. Para uma mudança concreta, abra a subrota e função específicas, localize validações e autorização no servidor, examine as coleções e regras Firestore usadas por aquela operação e selecione os testes correspondentes. [Regras aprovadas](business-rules.md) ficam separadas do comportamento observado. O [fluxo de recibos de férias](flows/vacation-receipts.md) é um exemplo de rastreamento integral de uma ação; os outros subfluxos ainda devem ser traçados conforme a tarefa.
