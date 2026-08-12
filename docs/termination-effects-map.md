# Mapa de efeitos decorrentes do desligamento

Este contrato separa referências operacionais de referências históricas. Um desligamento nunca apaga autoria, assinatura, aprovação já concluída ou movimentação passada. Ele encerra ou redireciona somente vínculos que ainda produzem efeito futuro.

## Matriz de tratamento

| Área | Referência | Tratamento no desligamento | Natureza |
|---|---|---|---|
| Autenticação | Firebase Auth | desabilitar login | automático |
| Usuário principal | `users/{uid}` | marcar inativo/encerrado e registrar data/motivo | automático |
| Cadastro RH | `employees.auth_uid/source_user_id` | sincronizar `terminated`, data e inatividade | automático |
| Cache RH | `rh_access_cache` | revogar cache de acesso | automático |
| Escopo e unidades | campos do usuário | deixam de conceder acesso porque a conta fica inativa; dados permanecem para histórico | preservado |
| Responsabilidade estrutural | `dp_unitGroups` e `dp_unitOrganizations` | remover a pessoa, preservar cargo/função e exigir sucessor | automático + pendência |
| Escalas | `dp_schedules/*/shifts` | preservar até o último dia e remover datas posteriores | automático |
| Férias | `dp_vacations` | preservar passado e rejeitar programação posterior ao término | automático |
| Tarefas abertas | `tasks.assignee*` | redirecionar ao cargo ou unidade e exigir revisão | automático + pendência |
| Aprovações abertas | `tasks.approver*` | redirecionar ao cargo ou unidade e exigir revisão | automático + pendência |
| Tarefas encerradas | autoria, executor, aprovador e histórico | não alterar | histórico imutável |
| Observadores | `tasks.watcherUserIds` | remover o usuário desligado | automático |
| Projetos | membros de projetos de tarefas e formulários | remover acesso operacional; preservar `created_by` | automático |
| Formulários/checklists abertos | executor atual | devolver para a fila da unidade | automático + pendência |
| Formulários/checklists em execução | responsável, reivindicação e colaboradores | remover a reivindicação do desligado e devolver a execução para a fila da unidade | automático + pendência |
| Formulários concluídos | executor, respostas, aprovação | não alterar | histórico imutável |
| Metas ativas | `employeeGoals` | encerrar participação na data do desligamento | automático |
| Liderança em metas ativas | `goalPeriods.leadershipRecipients` | retirar o desligado do rateio e exigir liderança substituta | automático + pendência |
| Metas fechadas | metas, cálculo e pagamento | não alterar | histórico imutável |
| Patrimônio ativo | responsável atual | desocupar e exigir nova atribuição | automático + pendência |
| Patrimônio baixado | responsável e movimentações | não alterar | histórico imutável |
| Uniformes em posse | atribuições abertas | não baixar automaticamente; exigir devolução registrada | pendência obrigatória |
| Documentos do colaborador | gerados, assinados, hashes e auditoria | preservar no dossiê conforme retenção | histórico imutável |
| Signatário da empresa | `entities.documentSignatoryUserId` | desocupar e bloquear novos envios até substituição | automático + pendência |
| Assinaturas em andamento do colaborador | `hrSignatureRequests` já enviadas | marcar para decisão pelo fluxo formal; não cancelar indiscriminadamente | automático + pendência jurídica/operacional |
| Compras legadas em aberto | `purchaseSessions.userId` | desocupar a sessão e exigir novo responsável | automático + pendência |
| Requisições, cotações e movimentações já registradas | solicitante, aprovador e executor históricos | não alterar; a etapa operacional aberta continua vinculada à tarefa/cargo correspondente | histórico imutável |
| Consentimento de imagem e voz | decisão e prova | desligamento não equivale a revogação; uso futuro deve respeitar o estado do consentimento | preservado |
| Benefícios e acessos externos | PDV, Bizneo, plano de saúde | revogar no fluxo formal e registrar confirmação | fluxo formal existente |
| Retenção/LGPD | documentos e auditoria | recalcular âncora `employment_end`; respeitar `legalHold` | fluxo formal existente |
| Autoria geral | `createdBy`, `updatedBy`, movimentações e logs | nunca remover | histórico imutável |

## Resultado e reconciliação

Cada desligamento produz `coala-rh/terminationImpactReports/{uid}__{data}` com contadores e pendências. A aplicação grava `terminationEffectsVersion` no usuário para garantir idempotência. Reprocessar o mesmo evento não duplica efeitos.

O relatório também preserva a empregadora jurídica da rescisão (`unitId`, `entityId`, razão social e CNPJ), separada da unidade operacional do colaborador, permitindo auditoria e segmentação por CNPJ.

Pendências que exigem decisão humana permanecem explícitas:

- sucessor de unidade/grupo;
- novo responsável por patrimônio;
- revisão de tarefa/aprovação redirecionada;
- novo signatário empresarial;
- liderança substituta para metas ativas;
- responsável para sessões de compra abertas;
- decisão formal sobre assinaturas em andamento;
- devolução de uniformes.

## Caso Lucas Lima

A auditoria encontrou:

- um vínculo operacional como responsável do grupo `CD`;
- uma máquina ativa atribuída pelo nome;
- o cadastro espelho do RH ainda marcado como ativo;
- tarefas concluídas/rejeitadas vinculadas a ele, preservadas por serem históricas.

Não foram encontradas escalas futuras, férias futuras, metas ativas ou formulários abertos vinculados ao Lucas.
