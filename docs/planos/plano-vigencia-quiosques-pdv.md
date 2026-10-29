# Plano — Vigência como fonte de quiosques e acesso ao PDV

**Estado em 29/10/2026:** implementação na branch `feat/editar-colaborador-unidades`; publicação autorizada pelo usuário ("pode implantar"). Nenhum dado real foi alterado por script.

Complementa o [plano da fonte única das unidades operacionais](plano-fonte-unica-unidades-operacionais.md), que já tornou a vigência do **Editar colaborador** a fonte de escala e ponto.

## Situação verificada (main `7cb14bbd`)

- A vigência (`operationalUnitPeriods`) já alimenta escala, ponto (`withOperationalTimeline`) e `unitIds`. A seção "Vigências do vínculo" saiu da ficha em 28/10.
- `assignedKioskIds` era editado à mão e somado às unidades no acesso "Onde trabalha" (`getLinkedUnitIds`), nas metas (`functions/src/pdv-sync.ts`), no organograma e na sinalização. Podia divergir da vigência.
- A sincronia com o PDV Legal (`planPdvOperationalUnitSyncs`) só rodava quando o quiosque atribuído mudava, não quando mudava a vigência; não removia acesso, falhava em unidade sem filial (CD) e não rodava na ativação de vigência futura.
- As metas atribuíam venda só por `pdvOperatorIds` (digitado à mão) e quiosque atribuído; acessos criados pela integração (`pdvAccesses`) não contavam.
- O primeiro acesso ao PDV só é criado na admissão (perfil escolhido à mão; senha no primeiro acesso). Inclusões e trocas clonam o perfil do acesso existente.
- Excluir no PDV Legal apaga de verdade o usuário lá; do lado do Coala o acesso fica `inactive` com o ID preservado.

## Decisões do usuário — 29/10/2026

1. A fonte de verdade de onde a pessoa trabalha (escala etc.) são as definições do Editar colaborador.
2. Quiosque atribuído deixa de ser campo: sai da vigência.
3. Switch **Acesso ao PDV — Sim/Não**. Com Sim, mudar a unidade na vigência altera o PDV (entra cria, sai remove, troca move). Com Não, não há cadastro no PDV.
4. Vigência futura: sincroniza por agendamento, na data.
5. Na implantação, cuidado com quem já tem acesso ativo no PDV para o switch não causar remoção.
6. Redesenho do drawer inteiro no modelo de linhas numeradas.

## Implementação

- `PATCH /api/users/[userId]`: com vigência, recalcula `assignedKioskIds` de `unitIds`; valida e autoriza `pdvAccessEnabled`; planeja PDV só nas unidades alteradas com filial; desligar remove todos os acessos ativos. Execução extraída para `src/features/hr/lib/pdv-unit-sync.server.ts`.
- `reconcileOperationalUnitPeriods` marca `operationalFollowUpPending`; `operationalFollowUpJob` → `POST /api/jobs/users/operational-follow-up` conclui quiosques e PDV.
- Metas reconhecem `pdvAccesses` da filial do quiosque, inclusive inativos.
- Drawer: `EditSection`/`EditRow`/`EditFormRow`; quiosques calculados e switch do PDV na linha de Escala e operação; acesso no sistema em `Segmented`.

## Cuidados de implantação (decisão 5)

- `pdvAccessEnabled` ausente vale Sim para quem tem acesso ativo: nenhuma migração e nenhum desligamento implícito.
- A sincronia é por diferença: só as unidades que mudam são tocadas. Acessos que já divergiam da vigência não são removidos automaticamente.
- Acesso sem unidade identificável bloqueia a remoção e pede ajuste manual.
- Quiosques atribuídos de quem tem vigência são recalculados no próximo salvamento ou na ativação de vigência; o drawer mostra antes e depois.

## Pendências

- **Relatório de divergências (somente leitura)** entre vigência, quiosques atribuídos e acessos do PDV, para revisão humana. Exige autorização de leitura de produção.
- **Primeiro acesso ao PDV fora da admissão**: hoje Sim sem acesso só orienta; criar exige perfil e link de primeiro acesso.
- **Metas por período de acesso**: a consulta ainda parte de quem tem o quiosque atribuído hoje; reprocessar dias antigos de quem saiu do quiosque perde a atribuição. Solução prevista: período de validade em `pdvAccesses` e consulta pela filial.
- **Confirmar com o PDV Legal** se cupons de usuário excluído preservam o ID do operador.
- Cadastros sem vigência mantêm os quiosques antigos até a primeira vigência.

## Ordem de execução

1. PR em `main` com código, testes e documentação; promoção para `production`.
2. Deploy das Functions `activateCollaboratorPeriods`, `operationalFollowUpJob` e da sincronia de vendas (`pdv-sync`).
3. Conferir rollout e a primeira execução do job (sem pendências = uma consulta).
4. Relatório de divergências e revisão humana (pendente de autorização).
