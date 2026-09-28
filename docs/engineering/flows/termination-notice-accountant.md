# Desligamento CLT: decisão do aviso e envio à contabilidade

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Outros tipos de desligamento compartilham parte das funções; conferir cada ramo antes de mudar regras.

## Entrada e percurso

A [tela de detalhe](../../../src/features/hr/termination/employee-resignation-detail.tsx) envia `decide_notice` e `send_accountant` por [`PATCH /api/hr/terminations/{id}`](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts). A rota encaminha os campos ao [serviço](../../../src/features/hr/termination/server.ts); `requireManagedProcess` exige permissão de gestão e processo existente.

1. [`decideTerminationNotice`](../../../src/features/hr/termination/server.ts) exige validação do RH e, no fluxo guiado, identidade verificada. Confere data da comunicação e término, calcula datas de aviso trabalhado e prazo material de pagamento, buscando feriados do calendário da unidade quando não foram informados. Atualiza o aviso e os vencimentos das etapas; desbloqueia a contabilidade no fluxo guiado. Salva processo, tenta criar tarefas de prazo e auditoria de documentos e registra `NOTICE_DECIDED`.
2. [`sendTerminationToAccountant`](../../../src/features/hr/termination/server.ts) exige aviso definido e empregadora válida. Usa e-mail informado ou contato configurado, gera token aleatório cujo hash e prazo de 30 dias ficam no processo, baixa cartas/comprovantes atuais do Storage e envia e-mail com resumo, anexos e link `/desligamento/contabilidade/{token}`. Registra comunicação no banco RH, marca etapa `waiting_external` e evento `ACCOUNTANT_SENT`.
3. O [portal do contador](../../../src/app/desligamento/contabilidade/%5Btoken%5D/page.tsx) consulta a [API pública](../../../src/app/api/hr/termination-accountant/%5Btoken%5D/route.ts). [`getTerminationByAccountantToken`](../../../src/features/hr/termination/server.ts) procura o hash e confere vencimento. [`uploadAccountantDocuments`](../../../src/features/hr/termination/server.ts) exige TRCT e demonstrativo, valida valores, prazo e até 20 arquivos de 20 MB, salva versões no Storage, marca documentos anteriores como não atuais, atualiza processo/etapa e notifica o RH. A revisão desses documentos é outra ação.

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `terminationProcesses` e eventos no banco RH | Aviso, prazo, contador e documentos | Permissão de gestão nas ações internas; token com hash e validade no portal. |
| `dp_units`, `dp_calendars` | Calendário e feriados | Leitura para cálculo do prazo material. |
| Storage e provedor de e-mail | Anexos originais, documentos recebidos e envio | Efeitos externos à atualização do processo. |
| `emailCommunications`, notificações e tarefas | Comunicação e próxima análise | Registros auxiliares no banco RH. |

**Inferência de impacto:** envio de e-mail, gravação do token e atualização do processo não formam transação única; falha após aceite do provedor pode deixar comunicação sem estado correspondente. Prazos calculados entram em pagamento, assinatura e encerramento; mudanças em calendário ou decisão exigem conferir esses consumidores. O upload do portal depende da versão atual dos documentos e do hash do token.

## Verificação e limites

Os [testes de núcleo do desligamento](../../../tests/unit/hr-termination-core.test.ts) são ponto de partida; este levantamento não demonstra integração real de e-mail, Storage nem portal. Conferir aviso trabalhado/dispensado, feriados, prazo, destinatário, token vencido, anexos e versionamento antes de alterar o fluxo. A auditoria de documentos, autorização financeira e fechamento ficam em guias posteriores.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
