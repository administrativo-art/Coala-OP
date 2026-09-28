# Organograma e modelos de cargo

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

A [página do organograma](../../../src/app/dashboard/hr/org-chart/page.tsx) carrega cargos, funções e departamentos via [`useHrBootstrap`](../../../src/hooks/use-hr-bootstrap.ts), perfis via [`useProfiles`](../../../src/hooks/use-profiles.ts) e usuários via `useAuth`. `buildTree` liga cargos pelo campo `reportsTo` e associa usuários ativos com `jobRoleId`; nós sem pai conhecido viram raiz. A página chama [`updateHrRole` e `updateHrFunction`](../../../src/features/hr/lib/client.ts) para salvar modelos de estágio/atributos, usando [rotas de cargo](../../../src/app/api/hr/roles/[roleId]/route.ts) e [função](../../../src/app/api/hr/functions/[functionId]/route.ts).

Mudanças em cargo/função afetam [recrutamento](recruitment.md), [configuração DP](dp-configuration.md), perfil padrão e possivelmente autorização. Conferir validação de ciclos em `reportsTo`, propagação a usuários e escopo de escrita nas rotas antes de alterar hierarquia. `npm run check` passou; não há validação ponta a ponta da árvore e de efeitos em perfis registrada.

## Propagação e validações observadas

As rotas [cargo](../../../src/app/api/hr/roles/[roleId]/route.ts) e [função](../../../src/app/api/hr/functions/[functionId]/route.ts) exigem `assertHrAccess(request, "manage")`, existência do documento, schema/normalização e consistência de pontuação do formulário. Cargo impede pai/reporte para si mesmo, exige perfil padrão para cargo ativo e confere existência em `profiles` no banco principal. Função impede pai e base salarial para si mesma e confere existência da função-base. Essas checagens não percorrem toda a árvore para detectar ciclos indiretos.

Cada PATCH substitui apenas seu documento de catálogo com `updatedAt`; não atualiza em massa `users`, salários ou perfis já atribuídos. Consumidores que leem o catálogo passam a ver o novo modelo; criação de colaborador e candidatura consultam essas referências nos respectivos fluxos. Mudança de perfil padrão não equivale a migração de permissões de pessoas existentes. Testes de ciclo, perfil e efeitos de atualização ficam na etapa de verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
