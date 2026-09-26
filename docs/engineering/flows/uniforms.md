# Estoque e entrega de uniformes

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e ações

A [página de uniformes](../../../src/app/dashboard/stock/uniforms/page.tsx) monta [`UniformManagement`](../../../src/components/uniform-management.tsx). O componente exige `stock.uniforms.view` para mostrar o estoque, usa [`fetchUniformOverview`](../../../src/features/uniforms/client.ts) e permite ajustar lote a quem tem `stock.uniforms.manageEvaluation` ou `stock.inventoryControl.editLot`. A edição da ficha de produto depende de `registration.items.edit`. Entrega, troca e devolução também são chamadas pelo [cliente de uniformes](../../../src/features/uniforms/client.ts) a partir do [componente do colaborador](../../../src/components/collaborator-uniforms.tsx).

## Percurso confirmado

- [`GET /api/uniforms`](../../../src/app/api/uniforms/route.ts) usa `requireUser`, permite visão a quem tem `stock.uniforms.view` ou `dp.collaborators.view`, e lê `lots` do estoque de uniforme, `uniformAssignments` e `uniformEvents` do workspace. Resolve produtos para completar metadados. Conferir a visibilidade de todos os registros retornados ao perfil DP antes de alterar o escopo.
- [`PATCH /api/uniforms`](../../../src/app/api/uniforms/route.ts) exige gestão de avaliação ou edição de lote; valida quantidade, condição e estado, verifica que o lote pertence ao estoque próprio, e atualiza `lots` com `movementHistory` dentro de uma transação quando há diferença de quantidade.
- [`POST /api/uniforms/deliver`](../../../src/app/api/uniforms/deliver/route.ts) exige `stock.uniforms.deliver`, valida lote, colaborador, quantidade, data, protocolo e assinaturas. Gera e armazena o termo antes da transação Firestore. Na transação, confirma colaborador ativo, produto de uniforme, lote disponível e saldo; reduz `lots` e cria `movementHistory`, `uniformEvents`, `uniformAssignments` e `uniformTransactions`. Depois tenta arquivar o termo no dossiê e registra `archived` ou `failed` na transação. O protocolo serve para reencontrar transação já criada.
- [`POST /api/uniforms/return`](../../../src/app/api/uniforms/return/route.ts) e [`exchange`](../../../src/app/api/uniforms/exchange/route.ts) seguem o mesmo padrão de termo assinado e transação, envolvendo atribuição, evento e movimento; os ramos de condição, destino do lote e arquivamento são detalhados abaixo; testes de falha continuam pendentes.

## Dependências, limites e verificação

As fontes são `lots`, `products`, `users`, `uniformAssignments`, `uniformEvents`, `uniformTransactions`, `movementHistory`, Storage e dossiê do colaborador. Alterar formato de atribuição, movimento ou termo afeta a visão de [colaboradores](../flow-coverage.md) e documentos. O termo é criado antes do commit Firestore; a rota de entrega tenta apagá-lo se o commit falhar, e o arquivamento posterior tem estado de falha recuperável. Conferir também os casos de retorno/troca sob concorrência e idempotência antes de marcar o grupo como verificado.

[`uniform-terms.test.ts`](../../../tests/unit/uniform-terms.test.ts) testa o núcleo dos termos; `npm run check` passou, mas não testa as quatro rotas ponta a ponta nem falhas entre Storage, transação e dossiê. Verificar permissões de leitura por colaborador, saldo concorrente, protocolo repetido, assinatura inválida e recuperação de arquivo antes do estado `Verificado`.

## Complemento do rastreamento: devolução, troca e termo

A [devolução](../../../src/app/api/uniforms/return/route.ts) exige administrador ou `stock.uniforms.return`. Valida protocolo, quantidade inteira positiva, data, destino e assinaturas. Na transação verifica atribuição/workspace, protocolo existente e quantidade em posse. Atualiza `quantityReturned`, `quantityInPossession` e status, cria evento e transação. Se o destino não for `descartar`, incrementa/cria lote determinístico de produto usado/disponível, lote `devolucao`, e grava movimento; descarte não devolve saldo ao estoque. A condição declarada no termo não muda esse enquadramento do lote de retorno.

A [troca](../../../src/app/api/uniforms/exchange/route.ts) exige administrador ou as duas permissões de entrega e devolução. Confere colaborador ativo, posse anterior, produto de uniforme e saldo disponível não reservado do novo lote. Rejeita troca usando o próprio lote calculado para retorno. Na mesma transação diminui o novo lote, atualiza a atribuição anterior, cria nova atribuição, eventos/movimentos e protocolo; se houver reentrada, aumenta o lote de devolução. Termo é produzido antes do commit; falha sem transação confirmada aciona tentativa de remoção do arquivo. Arquivamento no dossiê ocorre depois e persiste estado `archived`/`failed`, sem rollback do estoque. Concorrência e recuperação precisam de teste integrado, mas seus pontos de escrita estão identificados.

A [leitura do termo](../../../src/app/api/uniforms/terms/[id]/route.ts) confere workspace e permite administrador, próprio colaborador, `stock.uniforms.view` ou `dp.collaborators.view`; baixa o caminho guardado na transação e devolve PDF com cache privado desabilitado. Alterações no protocolo/arquivo afetam estoque, ficha e dossiê simultaneamente.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
