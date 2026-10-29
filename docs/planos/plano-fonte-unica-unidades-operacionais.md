# Fonte única das unidades operacionais

**Estado em 28/10/2026:** formato de vigências aprovado pelo usuário; implementação local concluída, revisão Doc Brown estática conforme, verificações finais e publicação em andamento. Nenhuma alteração de dados reais foi realizada.

## Situação verificada

- O editor de colaborador apresenta a união de `assignedKioskIds` com `users.unitIds` como unidades de escala e operação. Para Luis, a consulta de leitura ao banco real encontrou CD/Matriz no primeiro campo e somente Tirirical no segundo. Por isso a tela mostrou duas unidades sem que as duas estivessem gravadas em `users.unitIds`.
- A escala registra o local de cada turno. O turno regular de 28/10/2026 está no CD/Matriz.
- O REP-P resolve o vínculo por pessoa e data na revisão de `dp_employmentReferenceHistories`. A revisão atual de Luis contém somente Tirirical em `unitIds`, embora Tirirical seja também a referência financeira e o empregador cadastrados.
- `users.unitIds` alimenta cadastros e escala; `assignedKioskIds` também participa do escopo de acesso. Publicar a revisão histórica hoje não atualiza o usuário. Editar o usuário não publica revisão histórica. O cadastro RH é espelhado depois da edição do usuário, sem transação entre bancos.

## Regra de produto

Decisão explícita do usuário em 28/10/2026: o campo **Unidades de operação e escala**, dentro do cadastro, terá histórico próprio apresentado como `Vigência 1 — início até fim em branco — Unidade X e Unidade Y`. A última vigência fica sem data final, por prazo indeterminado, até a próxima definição. Ao cadastrar a seguinte, a anterior termina no dia imediatamente anterior ao novo início. Escala e ponto resolvem as unidades pela mesma vigência na data consultada.

- Cada vigência contém início obrigatório e conjunto explícito de unidades operacionais; a última tem fim ausente.
- Datas não podem se sobrepor; o novo início deve ser posterior ao início da última vigência. Não antecipar vigência futura na visão atual.
- O cadastro mostra a vigência válida na data atual e permite consultar as anteriores. Quiosque atribuído não acrescenta uma unidade silenciosamente à vigência.
- A definição das unidades atuais pode receber fim em branco, mas seu início precisa ser verificado antes da inicialização. A admissão, o primeiro turno encontrado e o início do ensaio do REP-P são evidências distintas; nenhuma dessas datas prova isoladamente quando começou a atuação habitual nas duas unidades.
- A vigência de operação/escala não exige que o usuário reedite empregador ou referência financeira a cada mudança de local de trabalho. Preservar a auditoria da alteração e o histórico contratual já existente.

Para o usuário, o **cadastro atual** é a entrada das unidades habituais de trabalho. Uma alteração efetiva exige data inicial e referência auditável; o mesmo fluxo grava a timeline canônica que escala e ponto consultam por data. A referência fiscal legada continua como base de empregador, sem exigir uma segunda edição de unidades. `assignedKioskIds` continua representando atribuições de quiosque e acesso ao PDV, sem provar vínculo operacional. Revisões antigas permanecem imutáveis.

Essa decisão não muda `users.unitId` (financeira), `employerUnitId` nem a unidade de cada turno. Para Luis, a regra confirmada é Tirirical como financeira, empregadora **e** operacional, com CD/Matriz como segunda operacional; João Paulo e Shopping do Automóvel não são habituais.

## Implementação

### Consolidação de Dados contratuais — decisão adicional de 28/10/2026

- Remover da ficha o bloco separado “Vigências do vínculo”. Reutilizar a seção existente “Dados contratuais”, apresentada como informativa e sem edição campo a campo.
- Alterar dados contratuais somente em **Editar colaborador → Identificação**, numa seção própria. Mover os campos editáveis de cargo/função e unidade financeira para esse mesmo lugar, preservando Jornada e Unidades operacionais nas abas correspondentes.
- Exibir tipo de vínculo, admissão, início da experiência, fim dos períodos da experiência, início do prazo indeterminado, unidade financeira, cargo e função. Aproveitar o processo de experiência e os dados de admissão existentes; não criar cópias editáveis dessas datas.
- “Início do prazo indeterminado” sucede o fim da experiência conforme o contrato/configuração aplicável; a admissão permanece desde o início da experiência. O motor já oferece `automatic_at_end`, mas o novo padrão é automático, preservando configuração manual existente e exigindo ciclo/admissão confirmados na automação; não transformar todos os contratos antigos automaticamente.
- Mudanças contratuais pedem data efetiva e justificativa no editor. Gravar antes/depois, ator e instante de registro junto com a alteração, com controle de concorrência. Ações automáticas recebem origem Sistema e motivo da regra aplicada.
- “Ver alterações” expande a trilha na própria seção informativa. Exibir agendamentos sem antecipar seus valores atuais. Preservar entradas antigas sem fabricar motivo/data efetiva.
- Evidência atual: `userAuditDiff`/`logUserAudit` enviam diferenças depois do PATCH, com erro apenas registrado em console; o RH possui `audit_log` com antes/depois e origem. Não existe hoje motivo obrigatório/data efetiva uniforme em todos esses escritores. A consolidação deve aproveitar os registros existentes e corrigir a atomicidade dos novos.

### Vigências operacionais

1. Fazer o editor mostrar separadamente a unidade operacional efetivamente gravada, a atribuição de quiosque e a unidade presente na vigência. Um quiosque atribuído não deve aparecer como vínculo operacional salvo sem identificação de sua origem.
2. No fluxo de alteração operacional do DP, gravar `users.operationalUnitPeriods` e projetar `unitIds` de modo coerente, com verificação de revisão, permissão, escopo e auditoria. Impedir uma segunda rota de gravação que possa recriar a divergência. Preservar períodos anteriores e tratar vigências futuras sem antecipá-las no cadastro atual.
3. Conferir os consumidores de escala, escopo de acesso, PDV Legal, RH e REP-P. Manter o empregador e a referência financeira independentes da unidade do turno.
4. Testar publicação concorrente, idempotência, início futuro e retroativo, edição apenas do quiosque, duas unidades operacionais com uma financeira, falha de sincronização com RH/PDV e leitura do ponto na data de vigência.
5. Somente depois de publicar e verificar o fluxo, reconciliar os dados de Luis pelo DP: manter Tirirical e acrescentar CD/Matriz nas unidades operacionais da vigência aplicável. A referência documental e a data efetiva precisam ser confirmadas pelo DP; não criar documento fictício nem fazer escrita avulsa no banco.

## Limites

- O rollout dos PRs #621 e #622 corrigiu a apresentação e a possibilidade de salvar as duas unidades no cadastro, mas não centralizou as gravações nem alterou os dados de Luis.
- A consulta de produção citada acima foi somente leitura. O resultado não comprova vínculo jurídico nem autoriza alteração de folha ou pagamentos.

## Pré-voo e reversão de dados reais

Nenhuma migração automática. Antes da primeira vigência, conferir pessoa, unidades, início real, referência fiscal e efeitos nas datas anteriores/atuais/futuras. Não usar a data de ensaio nominal como início real. Salvar pelo DP com CAS e auditoria; conferir cadastro, escala e opções do ponto. Para rollback de código, não apagar timelines/auditorias/autorizações: preservar projeções e voltar somente mediante avaliação de compatibilidade, pois consumidores legados não resolvem datas. Erro de período já aplicado exige correção controlada com revisão humana, sem reescrever evidências fiscais. Não executar escrita avulsa no banco.

## Implantação

Integrar por PR/main, índices novos nos bancos principal/RH e Function `activateCollaboratorPeriods`, depois promoção validada a production e conferência do SHA/rollout/HTTP. A Feature não altera sozinha o cadastro de Luís; a data da primeira vigência permanece pendente de confirmação.
