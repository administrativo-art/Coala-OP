# Pedido de demissão enviado pelo colaborador

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** envio inicial traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Este guia não cobre revisão pelo RH, assinatura posterior, cálculo ou encerramento. Comportamento observado não equivale a [regra aprovada](../business-rules.md).

## Entrada e percurso

[`resignation/page.tsx`](../../../src/app/dashboard/resignation/page.tsx) monta [`resignation-self-service.tsx`](../../../src/features/hr/termination/resignation-self-service.tsx). A tela prepara carta e preferência de aviso, confirma a declaração da carta manuscrita e envia `FormData` para [`POST /api/hr/terminations`](../../../src/app/api/hr/terminations/route.ts). A mesma rota usa JSON para criação gerenciada pelo RH; o tipo de conteúdo distingue as ações.

1. A rota obtém `terminationContext(request)`, exige arquivo e confirmação de carta escrita à mão, datada e assinada, e chama `createEmployeeResignationRequest`. [Fonte](../../../src/app/api/hr/terminations/route.ts).
2. O serviço exige vínculo CLT ativo, telefone verificado, PDF/JPG/PNG até 12 MB e ausência de desligamento ativo para o colaborador. Consulta identidade/CPF, unidade, empregador e contato do contador. [Fonte](../../../src/features/hr/termination/server.ts).
3. Grava o original no Storage em `hr/termination/{processId}/request/original.*` com hash SHA-256. Monta `clt_employee_resignation` em `hr_review`, documento com visibilidade `employee`, etapas iniciais e estados de contador, pagamento e revogação ainda pendentes. Grava em `hrDbAdmin.collection(COLLECTION)` e adiciona evento `REQUEST_CREATED`. [Fonte](../../../src/features/hr/termination/server.ts).
4. Em seguida cria sombra ASO, tenta criar tarefa de conferência da carta para RH, sincroniza projeção e retorna o processo. A leitura com `scope=mine` e a visibilidade por colaborador estão em [`termination/server.ts`](../../../src/features/hr/termination/server.ts).

## Dados, acesso e impacto

| Item | Operação | Evidência e limite |
| --- | --- | --- |
| Usuário, identidade e unidade | Leitura | `requireUser` em `terminationContext`; serviço usa o usuário autenticado e valida vínculo, telefone e CPF. |
| Carta no Storage | Escrita anterior ao processo | Tipo/tamanho, hash e caminho em [`server.ts`](../../../src/features/hr/termination/server.ts). |
| Processo e evento de desligamento | Escritas no banco RH | `clt_employee_resignation` e `REQUEST_CREATED` em [`server.ts`](../../../src/features/hr/termination/server.ts). |
| ASO, tarefa e projeção | Efeitos posteriores | Chamadas após gravação; tarefa falha com `.catch(() => null)`, então sua criação não é garantida pelo retorno 201. |

**Inferência de impacto:** Storage e banco RH não formam uma transação única; alterações no upload ou na criação precisam considerar falhas entre etapas. O colaborador só consulta seus processos salvo permissão de gestão/visualização; ver [`assertTerminationVisible`](../../../src/features/hr/termination/server.ts). [Mapa de efeitos do desligamento](../../termination-effects-map.md).

## Verificação e limites

Testes de núcleo e schemas em [`hr-termination-core.test.ts`](../../../tests/unit/hr-termination-core.test.ts) e [`hr-termination-schema.test.ts`](../../../tests/unit/hr-termination-schema.test.ts) são pontos de partida; confira seus casos antes de atribuir cobertura ao upload, autorização ou efeitos externos. O fluxo completo de RH permanece a detalhar.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
