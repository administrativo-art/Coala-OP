# Colaboradores, usuários e acesso

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

A [lista DP](../../../src/app/dashboard/dp/collaborators/page.tsx) filtra `activeUsers`/`terminatedUsers` de `useAuth` por unidade com [`canAccessUserByUnit`](../../../src/lib/unit-access.ts). A [ficha](../../../src/app/dashboard/dp/collaborators/[userId]/page.tsx) exige `dp.collaborators.view`, trata `ownProfileOnly` e expõe edição conforme `settings.manageUsers` ou `dp.collaborators.edit`. A [tela de gestão](../../../src/components/user-management.tsx) usa `addUser`, `updateUser`, `terminateUser` e `resetPassword` do contexto de autenticação. A [lista de inativos](../../../src/components/inactive-users-screen.tsx) permite reativação com `settings.manageUsers`.

Para o perfil RH, [`/api/rh/employee-profile/[employeeId]`](../../../src/app/api/rh/employee-profile/[employeeId]/route.ts) confere propriedade/perfil e filtra `field_values` pela [matriz de campos](../../../src/app/api/rh/field-map/route.ts). A ficha também chama integração de acesso PDV Legal e [rotas de documentos do colaborador](employee-documents.md). `users`, `profiles`, cadastros RH e permissões de unidade participam do percurso; ver [configuração DP](dp-configuration.md) e [desligamento](termination-process-center.md).

A visibilidade local não basta para conceder acesso: conferir as funções de `useAuth`, regras Firestore, cada API e a sincronização de conta externa. As variantes de criação, inativação temporária versus término contratual, reativação, redefinição de senha e propagação de perfil estão rastreadas abaixo; a comprovação integrada dessas variantes continua pendente. `npm run check` passou, sem teste integrado de ciclo de acesso registrado.

## Ciclo de conta rastreado

[`POST /api/users`](../../../src/app/api/users/route.ts) exige administrador/gestão de usuários, valida vínculo, perfil e delegação de unidade; somente administrador pode atribuir perfil administrativo. Rejeita e-mail existente; cria Auth com senha aleatória, claims, `users`, empregado RH e link individual de primeiro acesso, nessa ordem. E-mail é posterior e pode falhar mantendo cadastro com aviso; o catch geral tenta remover Auth e os dois documentos com `Promise.allSettled`. Essa compensação não é transação entre serviços.

[`PATCH /api/users/{id}`](../../../src/app/api/users/[userId]/route.ts) exige gestão ou edição/desligamento DP, confere unidade e separa campos de acesso de campos editáveis por DP. Descarta campos geridos pelo servidor, impede elevação de perfil e delegação além do escopo. `resolveCollaboratorCore` resolve cargo/função/perfil. Mudança operacional pode mover/clonar acesso PDV (até dez operações), registra intenção em `systemAccessAudit`, confirma perfil externo e só depois grava usuário+auditoria numa transação que verifica se unidades não mudaram. Erro após atualização externa recebe `failed_after_external_update`; espelho de unidades no RH e vale-transporte são posteriores, sem atomicidade entre bancos.

As callables em [`functions/src/index.ts`](../../../functions/src/index.ts) exigem autenticação e `canManageUserAccess` para inativar/reativar. `terminateUser` aceita apenas inativação temporária: desabilita Auth e marca usuário/histórico; desligamento contratual exige processo formal. `reactivateUser` habilita Auth, limpa marcadores de desligamento, registra histórico e atualiza empregados RH por `auth_uid`. Exclusão permanente exige UID técnico permitido e claim administrativa, remove Auth e usuário sequencialmente. [`AuthProvider`](../../../src/components/auth-provider.tsx) usa `/api/auth/forgot-password` para redefinição e `/api/auth/password-changed` após alteração. Essas operações não apagam automaticamente dossiês/processos. Testes de permissão e falha entre serviços continuam pendentes.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Claims financeiros na main

O [bootstrap](../../../src/app/api/financial/bootstrap/route.ts) ainda constrói claims incluindo a matriz `financial`; a sincronização do documento financeiro ocorre depois. O [gatilho de perfil](../../../functions/src/index.ts) também precisa ser considerado. Não existe o helper `removeLegacyFinancialClaims` nesta base. A correção e seus testes permaneceram no worktree anterior; não afirmar preservação/remoção segura de claims ou sucesso de sincronização com base naquele relatório. Conferir rejeição do Auth, tamanho dos claims e indicadores de sucesso antes de alterar o fluxo.
