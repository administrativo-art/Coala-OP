# Publicação das escalas do DP

Decisão de produto: 31/10/2026. Estado: implementação local em verificação.

## Situação atual verificada

- No legado, `dp_schedules/{id}/shifts` era a fonte comum. A ausência de `publicationStatus` continua significando publicada, inclusive para novembro de 2026.
- `locked` era um controle distinto e foi retirado da interface e da rota de alteração de estado. Seu campo histórico pode continuar em documentos antigos.
- Solicitações operacionais alteram a revisão oficial imediatamente; o editor de turnos e demandas de cobertura mantém alterações manuais em rascunho.

## Regras aprovadas

- Escala nova nasce **RASCUNHO** e não produz efeitos fora do editor do DP até **Publicar**.
- Todas as escalas já existentes na ativação, inclusive novembro de 2026, são **PUBLICADAS**. Ausência do novo campo de estado significa legado publicado; nenhuma escala existente deve ser ocultada pela transição.
- Uma edição manual de escala publicada cria ou altera um rascunho. A situação exibida passa a **RASCUNHO**, mas os consumidores continuam usando a última revisão publicada. O botão passa a **Publicar novamente**.
- Trocas, ausências e demais eventos operacionais autorizados aplicam-se imediatamente à escala oficial, sem criar rascunho. Um rascunho aberto incorpora esses eventos; conflito sobre o mesmo turno impede republicação silenciosa e exige resolução pelo DP.
- A publicação disponibiliza a revisão oficial inteira e emite um evento de revisão para consumidores de resultados derivados. Leituras críticas usam a fonte oficial diretamente. Reprocessamentos são idempotentes, limitados ao período afetado e observáveis.
- “Trancada” deixa de ser situação e ação. Validação de jornada e snapshot histórico passam a integrar a publicação. Publicar no Bizneo permanece integração separada.

## Contrato de implementação

1. Preservar `dp_schedules/{id}/shifts` para o legado. Novas publicações preparam `revisions/{revisionId}` em lotes e ativam `activeRevisionId` em uma transação. As leituras oficiais resolvem revisão e sobreposição operacional; as manuais usam `draftEdits`.
2. Criar estado de publicação, revisão monotônica, data/ator e sinalização de conflito. Separar permissões de visualizar, editar e publicar no perfil: visualizar sozinho dá somente leitura; publicar exige editar. Validar editar e publicar no servidor.
   A publicação deve adquirir a trava de competência do REP-P antes do preparo e da ativação da revisão; mês em fechamento ou fechado só pode ser republicado após reabertura formal do ponto.
3. Adaptar criação, edição simples e em lote, exclusão, leitura e interface do DP para rascunho. Evitar efeitos derivados nas edições manuais.
4. Publicar com conferência de versão, validação de jornada e atualização atômica do ponteiro. Até 500 alterações e 2.000 turnos totais são preparados em lotes, preservando uma única ativação. O caso de 500 turnos de 500 pessoas distintas passou no emulador. Há limites adicionais por pessoa, histórico e tamanho de documento para proteger o Firestore.
5. Incorporar alterações operacionais imediatas ao rascunho e proteger conflitos. Atualizar os consumidores especiais que ainda usam `locked` ou projeções derivadas.
6. Incrementar `goalEligibilityVersion` em publicação e mutações operacionais. A função de metas relê a escala oficial e recalcula metas ativas por período; o evento de revisão recebe estado processado. Leituras de ponto, autorizações e colaborador usam a escala oficial diretamente.
7. Verificar permissões, migração de leitura legada, escala nova, republicação, troca/ausência com rascunho aberto, rotina de ponto, metas, exportações e custo de consultas. Atualizar guias de engenharia e inventários afetados.

## Pendências técnicas antes da ativação

- O limite aprovado pelo produto é de 500 turnos ou alterações por publicação. O preparo em lotes e ponteiro único foi validado em emulador com 500 turnos de 500 pessoas distintas.
- Homologar a interface e o gatilho de reconciliação de metas em ambiente integrado antes da ativação.
- A exclusão de escala com revisão ativa ainda retorna conflito no serviço legado. O botão de exclusão é ocultado nesse caso; será necessário um fluxo próprio de exclusão de revisão e seus índices antes de reabrir essa operação.
- Executar migração de dados reais somente com autorização específica; a leitura legada deve permanecer publicada mesmo antes de qualquer migração.

## Correção de acesso ao DSR no rascunho — 18/11/2026

A rota de DSR introduzida em #904 exigia `schedule.workspaceId` exatamente igual ao workspace da sessão, mas o tipo/legado da escala e o criador atual (`use-dp-store.addSchedule`) não persistem esse campo. O erro foi reproduzido em emulador como `DP_SCHEDULE_DRAFT_SCOPE_INVALID`/403, sem inferir o usuário da captura ou consultar dados de RH reais.

Compatibilidade delimitada: campo ausente pertence somente ao workspace configurado da implantação (`WORKSPACE_ID`), sem aceitar qualquer workspace da sessão. Campo explícito estrangeiro ou malformado continua negado. Permanecem exigidos permissão de DSR/edição e acesso à unidade; o mesmo escopo é revalidado na transação, além da revisão otimista. Não há migração de documentos nem mudança no cálculo/natureza/publicação do DSR, REP-P ou integração Bizneo. O DSR continua apenas no rascunho até Publicar.

Critérios: adicionar/remover no legado e no explícito autorizado; negar outra unidade/perfil/workspace e campo inválido; impedir mudança concorrente de escopo; preservar fonte oficial e não criar operação Bizneo durante a edição. Nenhuma query adicional (mesmos snapshots já lidos), custo incremental de leituras/escritas zero. Testes demo dirigidos: `npm run test:integration -- --dsr-draft-access`. Revisão Doc Brown exigida por AGENTS antes do commit; publicação deste chamado não autorizada nesta etapa.

Revisão obrigatória Doc Brown concluída em 18/11/2026: **conforme para commit**, quanto a escopo/autorização, rascunho versus oficial, concorrência/rastreabilidade e REP-P/PTRP; seis integrações demo aprovadas, sem alteração de marcações ou chamadas Bizneo. Ressalva futura não bloqueante: uma implantação multiworkspace requer persistir/migrar `workspaceId` com autorização própria; o fallback atual não é um vínculo genérico entre workspaces.
