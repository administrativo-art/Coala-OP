# Desligamento CLT iniciado pelo RH: demais motivos

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Seleção do ramo

A [lista de motivos CLT](../../../src/lib/hr/employment-relationship.ts) inclui justa causa, pedido de demissão, rescisão indireta, culpa recíproca, acordo e extinção legal, além da dispensa sem justa causa. A [abertura gerenciada](termination-managed-start.md) valida motivo pelo vínculo; [schema](../../../src/features/hr/termination/schemas.ts) exige subtipo em justa causa e rejeita subtipo para os demais motivos. A dispensa sem justa causa tem [percurso próprio](termination-employer-dismissal.md). Pedido digital iniciado pela própria pessoa também tem [percurso próprio](resignation-request.md), embora o motivo possa ser selecionado pelo RH neste ramo manual.

## Estado inicial registrado

Para os motivos CLT exceto dispensa sem justa causa, [`createManagedTermination`](../../../src/features/hr/termination/server.ts) usa [`createInitialTerminationSteps`](../../../src/features/hr/termination/core.ts). Marca `request_validation_notice` como concluída pelo RH, inicia devolução de uniforme e obrigações, deixa ASO pendente e bloqueia contador até aprovação do ASO. Define prazo de pagamento com `calculateMaterialDeadline`, e bloqueia revogação de acesso até a data de término quando ela ainda não chegou. Persiste `terminationReason`, `terminationCause`, datas, empregador e `accessRevocation` em `terminationProcesses`; cria a trava `terminationActiveByEmployee` em transação.

A [rota de detalhe](../../../src/app/api/hr/terminations/[id]/route.ts) expõe ações de `update_step`, sincronização de uniforme, contador, pagamento e revogação. Os efeitos dessas ações são compartilhados com [contador](termination-notice-accountant.md) e [auditoria/pagamento/fechamento](termination-audit-payment-closure.md). **Comportamento observado:** a abertura usa uma única definição de etapas para estes motivos, e a sequência compartilhada é detalhada abaixo; antes de alterar ou usar este fluxo como regra jurídica, conferir cada motivo, os contratos do contador e os documentos produzidos.

## Dados e verificação

Fontes e efeitos: `users` no banco principal; `employees`, `terminationProcesses`, trava e eventos no banco RH; projeção e tarefa após a transação. A persistência do empregador e os efeitos posteriores são separados da transação do processo, como descrito na [abertura](termination-managed-start.md). [`hr-termination-core.test.ts`](../../../tests/unit/hr-termination-core.test.ts) cobre estrutura de etapas; `npm run check` passou. Faltam casos de schema por motivo, permissões por ação, cálculo/prazo, ASO recusado, concorrência, falha de contador e confirmação documental antes de marcar `termination` como `Verificado`.

## Comportamento posterior por motivo

O [serviço](../../../src/features/hr/termination/server.ts) e o [núcleo](../../../src/features/hr/termination/core.ts) distinguem o percurso guiado de `Dispensa sem justa causa` e o acordo PJ. Os demais motivos CLT compartilham a sequência de etapas descrita acima; motivo/subtipo seguem como metadados do processo, documentos e desligamento do cadastro. Não foi encontrada nesses dois componentes uma fórmula posterior própria para cada um desses motivos.

Assim, seguir [contador](termination-notice-accountant.md) e [pagamento/fechamento](termination-audit-payment-closure.md) para as ações compartilhadas: solicitação/documentos contábeis, evidência de pagamento, requisitos de conclusão, revogação de Auth, projeções e tarefas. O motivo não demonstra que o sistema calcula autonomamente todas as verbas de cada hipótese. A verificação pendente é comparar esse percurso e seus documentos com a regra aprovada e testar cada motivo, inclusive recusas, concorrência e efeitos externos; o caminho implementado está rastreado.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
