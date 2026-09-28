# Desligamento iniciado pelo RH: CLT e PJ

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** abertura e escolha de ramo traçadas no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. O processamento posterior de cada etapa exige guias complementares.

## Entrada e validação

A [lista de desligamentos](../../../src/features/hr/termination/termination-list-page.tsx) usa o [cliente](../../../src/features/hr/termination/client.ts) para enviar JSON a `POST /api/hr/terminations`. A [rota](../../../src/app/api/hr/terminations/route.ts) valida o corpo com [`managedTerminationCreateSchema`](../../../src/features/hr/termination/schemas.ts) e chama [`createManagedTermination`](../../../src/features/hr/termination/server.ts). Este caminho exige gestor de desligamento; o POST com formulário e carta é o [pedido do colaborador](resignation-request.md).

O schema exige pessoa, CNPJ empregador, data, motivo e `source=hr_manual`. Justa causa exige subtipo. Dispensa sem justa causa exige confirmação, data/local de comunicação presencial, tipo de aviso e motivo interno; a data final não pode anteceder a comunicação. O serviço rejeita pessoa inativa, vínculo diferente de CLT/PJ e motivo incompatível. Para PJ, aceita neste fluxo apenas distrato por acordo entre as partes. [Schema](../../../src/features/hr/termination/schemas.ts), [serviço](../../../src/features/hr/termination/server.ts).

## Percurso e diferenças de vínculo

1. O serviço procura processo ainda ativo para a pessoa; se houver, devolve o existente com `reused=true`. Resolve unidade e empregador, persiste o empregador da pessoa e obtém identidade. Para PJ, captura os dados do contrato de origem; para CLT, resolve contato do contador e calcula prazo de pagamento. [Fonte](../../../src/features/hr/termination/server.ts).
2. A seleção de etapas depende de vínculo e motivo. PJ usa [`createPjTerminationSteps`](../../../src/features/hr/termination/core.ts), com preparação do distrato, obrigações, operação e revogação de acesso. CLT por dispensa sem justa causa usa `createEmployerDismissalSteps`, com comunicação oficial e contador bloqueado até assinatura ou recusa. Outros motivos CLT usam etapas iniciais, liberam em paralelo uniforme/obrigações e bloqueiam contador até ASO aprovado. [Serviço](../../../src/features/hr/termination/server.ts), [etapas](../../../src/features/hr/termination/core.ts).
3. O registro em `terminationProcesses` guarda tipo (`clt_hr_termination` ou `pj_contract_termination`), motivo, datas, empregador, passos, acesso externo e dados específicos PJ. Uma transação em `terminationActiveByEmployee/{id}` evita abertura concorrente de dois processos ativos. [Fonte](../../../src/features/hr/termination/server.ts).
4. Na dispensa sem justa causa, cria vínculo com ASO e tenta gerar/enviar comunicado oficial; se falhar, grava falha e bloqueia a etapa de comunicação. Depois publica projeção, registra evento e cria tarefa de RH. [Fonte](../../../src/features/hr/termination/server.ts). A [central](termination-process-center.md) lê a projeção.

## Dados, acesso e impacto

| Local | Efeito observado |
| --- | --- |
| `users` no banco principal e `employees` no banco RH | Leitura de vínculo/identidade; persistência do empregador confirmado. [Serviço](../../../src/features/hr/termination/server.ts). |
| `terminationProcesses`, `terminationActiveByEmployee` no banco RH | Processo e trava transacional; consulta inicial para reaproveitamento. [Serviço](../../../src/features/hr/termination/server.ts). |
| `processProjections`, eventos e tarefas | Atualização da visão geral e trilha de execução após abertura. [Serviço](../../../src/features/hr/termination/server.ts). |
| ASO e comunicação oficial CLT | Efeitos da dispensa sem justa causa; outras variantes seguem estados próprios. [Serviço](../../../src/features/hr/termination/server.ts). |

**Inferência de impacto:** a persistência do empregador ocorre antes da transação que cria o processo; falha posterior pode deixar esse dado atualizado sem processo novo. A projeção, o evento e a tarefa são operações separadas da transação. Mudanças na abertura exigem conferir retomada, reaproveitamento e visibilidade na central.

## Verificação e limites

Os [testes do núcleo](../../../tests/unit/hr-termination-core.test.ts) cobrem construção de etapas CLT/PJ. O [schema](../../../src/features/hr/termination/schemas.ts) e os efeitos de banco/ASO/comunicação precisam de verificação específica ao alterar a abertura. Conferir também criação repetida e concorrente, motivo PJ incompatível, comunicado com falha e empregador correto. Este guia não cobre o distrato PJ completo nem cada transição posterior.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
