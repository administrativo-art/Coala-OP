# Ausências do Departamento Pessoal

## Objetivo e limites

Este fluxo separa quatro responsabilidades:

1. **Configurar** os tipos de ausência e as regras que alcançam cada pessoa.
2. **Solicitar** um período ou horas e anexar a comprovação necessária.
3. **Analisar** o pedido, registrar a decisão e preservar a trilha.
4. **Aplicar** a decisão aprovada na disponibilidade, escala, ponto, indicadores e integrações.

Férias não pertencem a este domínio: continuam no módulo próprio, com aquisição, concessão e efeitos específicos. Pessoa jurídica também não usa ausência trabalhista; eventual indisponibilidade contratual de PJ deve ser tratada em outro fluxo. Os vínculos elegíveis aqui são CLT, Aprendiz e Estágio, cada um com regras configuráveis e sem presumir que compartilham os mesmos limites.

Este documento descreve o domínio de ausências. As **Etapas 1, 2 e 3 estão em produção** desde 17/10/2026: catálogo e pedidos no banco `coala-rh` (recibo `active`) e aplicação na escala com `DP_ABSENCE_OPERATIONAL_GUARD=on` e recibo operacional `ready`. O teste controlado na tela e a homologação funcional pelo DP continuam pendentes. A antiga Etapa 4 foi absorvida pelas Fases 3 e 5 do [plano mestre de ponto, jornada e fechamento](../../plano-jornada-fechamento-rh.md#6-fases).

## Banco e versionamento — decisão de 14/10/2026

O domínio de Tempo e tratamento da jornada usará o banco existente **`coala-rh`**, com coleções próprias por responsabilidade: configurações versionadas, pedidos, ocorrências, reservas, projeções, tratamentos e apurações. Não criar outro banco para o PTRP nem concentrar tudo em um documento/coleção genérica. O armazenamento original do REP-P (ARP) permanece separado, com escrita exclusiva do registrador.

Hoje `dp_absenceTypes`, jornadas, turnos e políticas ainda usam `coala`. A transição exige inventário dos consumidores, migração preservando IDs/versões/vigência, comparação de integridade e troca explícita da fonte; não manter dois catálogos editáveis nem fazer fallback silencioso entre bancos. Nenhuma migração em banco real foi executada neste trabalho. Até a troca, a prévia lê o catálogo atual por adaptador server-only; quando houver persistência de pedidos, `dp_absenceRequests` e a auditoria de suas decisões pertencerão ao RH. Garantias transacionais valem dentro do mesmo banco; efeitos na escala ou em serviços externos exigem intenção persistida, idempotência e reconciliação.

Versionar não depende do nome do banco: publicação conserva histórico e vigência, cada pedido/apuração referencia as versões utilizadas, e revisão/reversão acrescenta histórico. Jornadas, horas extras e tipos de ausência já têm versões; turnos ainda precisam de uma estratégia histórica antes do uso definitivo no ponto.

### Primeiro incremento da Etapa 2 — prévia

Implementadas localmente as consultas autenticadas `GET /api/collaborator/absence-requests/options` e `POST /api/collaborator/absence-requests/preview`, para a própria pessoa. A entrada está no catálogo de **Minhas solicitações** e no menu do card do colaborador. A prévia verifica regra publicada/aplicável, unidade, vigência, datas, prazo e teto por pedido; calcula dias corridos ou horas e devolve apenas os campos públicos da regra aplicada.

A consulta de prévia não grava dados e retorna `canSubmit: false`: não equivale à aceitação de um pedido. Dias previstos na escala ficam sem quantidade até integração da fonte; saldo acumulado e sobreposição não são presumidos nessa consulta. O cadastro usado é o perfil atual, sem certificação histórica de vínculo/lotação; versões arquivadas não são oferecidas nesta prévia.

### Incremento local de pedidos e análise — 15/10/2026

O catálogo administrativo e a prévia usam uma única fonte, selecionada por `DP_ABSENCE_CATALOG_DATABASE` (`coala` por padrão; `coala-rh` no cutover). Em produção, o catálogo foi migrado em 17/10/2026 (recibo `active` emitido, hash `882e153a…`) e o `apphosting.yaml` passou a definir `coala-rh`. As APIs de pedidos exigem fonte RH e recibo `dp_absenceCatalogMigrations/active` pronto. O script reutilizável `scripts/migrate-absence-catalog.mts` compara IDs e conteúdo por páginas de 50 e, sem `--apply`, é somente leitura. Com `--apply` grava no emulador `demo-coala-repository`; em produção exige `--apply --production --confirm-catalog-freeze --backup-dir <pasta>`, recusa emulador configurado e projeto diferente de `smart-converter-752gf`, compara todo o catálogo antes da primeira escrita, grava a cópia de segurança (origem, destino e recibo anterior) e só então cria os tipos ausentes no RH e o recibo. Nunca sobrescreve tipo divergente nem recibo com hash diferente, e recusa catálogo de origem vazio. O congelamento do catálogo vale da execução até a troca de `DP_ABSENCE_CATALOG_DATABASE` para `coala-rh` no `apphosting.yaml`; a execução real depende de autorização própria e é feita pelo operador. Não trocar o seletor nem fabricar um recibo para contornar as verificações.

O recorte implementa criação própria ou por gestor/DP autorizado, preparação privada de comprovantes, edição versionada de rascunho/ajustes, envio, análise atribuída, recusa, confirmação do DP e cancelamento, com versão esperada e operação vinculada ao ator/ação. Origem e autoridade são derivadas no servidor; gestor exige vínculo gerencial comprovado, DP exige permissão e unidade. Autor e titular não aprovam o próprio pedido. A aprovação final cria uma ocorrência estável na transação RH. Reservas por pessoa/dia evitam sobreposição entre pedidos ativos; limites mensais/anuais são repartidos entre competências e passam de reservado a consumido na aprovação. A chave de saldo não inclui lotação: transferência não reinicia o teto. Recusa/ajustes/cancelamento liberam ou estornam os buckets originais. Cancelamento de aprovado exige custodiante DP, regra, motivo e início estritamente futuro; acrescenta reversão, sem apagar ocorrência. Eventos e outbox não presumem atomicidade com outro banco.

A interface inclui criação após prévia e upload, **Meus pedidos de ausência**, fila atribuída na central do DP, detalhe e decisões. Sem `capabilities.canCreate`, permanece apenas a prévia. A hierarquia de responsáveis é configurável por etapa no editor do tipo, com pessoas, função/cargo alternativo e cargo, níveis ordenados e limites técnicos de 20 níveis/candidatos. Primeiro nível elegível recebe a etapa; não há aprovação automática por silêncio. A implementação usa as permissões existentes `dashboard.collaborator`, `dp.requests.view/review` e `dp.settings.manageAbsences`, além da atribuição, titularidade e escopo de unidade no servidor. Perfis restritos precisam das permissões de navegação correspondentes; nenhum perfil real foi alterado.

Superfícies novas: `GET/POST /api/collaborator/absence-requests`, `GET/PATCH /api/collaborator/absence-requests/[requestId]`, `POST /api/collaborator/absence-requests/preparations` e `GET/DELETE /api/collaborator/absence-requests/[requestId]/attachments/[fileId]`. Coleções RH `dp_absenceRequests`, `dp_absencePreparations`, `dp_absenceDayReservations`, `dp_absenceBalances`, `dp_absenceOccurrences`, `dp_absenceOutbox`, `dp_absenceEvents`, `dp_absenceAudit` e `dp_absenceIdempotency` são Admin-only. Arquivos PDF/JPEG/PNG são conferidos por assinatura/MIME/hash (até 5 de 10 MB), sem token de download; preparações expiram em 24h e têm limpeza delimitada. Anexos são tratados conservadoramente como sensíveis neste recorte. Download revalida titular, aprovador atual ou custodiante DP; admin genérico não recebe acesso documental. O `DELETE` legado está bloqueado: não apaga bytes nem altera o pedido.

O detalhe mostra titular, aprovadores previstos e saldos; listas `mine|review|team` filtram pessoa, status, unidade e **data de início**, com cursor. As filas internas também filtram solicitações em análise cujo SLA de 24 horas venceu, ordenadas pelo vencimento e sem varredura integral. Documentos obrigatórios são conferidos antes da criação, no envio e na aprovação final. Revisões e anexos anteriores são preservados. Divergência de perfil exige confirmação DP vinculada ao fingerprint/revisão; nova mudança invalida a confirmação.

O dispatcher do outbox grava avisos privados somente em `coala.userNotifications`. `GET/PATCH /api/user-notifications` pagina e marca somente IDs próprios; o sino carrega 25 (+1) ao abrir, sem polling. `POST /api/collaborator/absence-requests/[requestId]/notifications/reconcile` oferece tentativa explícita respeitando backoff/ACL. IDs estáveis evitam duplicar o aviso e a falha do sino não desfaz a decisão. Por decisão de produto, solicitações de ausência não enviam e-mail nem push ao Coala Go; a infraestrutura geral de push continua disponível para outros fluxos. Revisões e reversões têm coleções RH próprias `dp_absenceRevisions` e `dp_absenceReversals`.

Limitações para liberação real: cutover/migração não executados, gate operacional restrito a demo, bootstrap e índices ainda não comprovados em produção e Storage real não exercitado. Desligamento/vínculo inválido bloqueia aprovação; divergência válida exige confirmação DP. Retenção revalida desligamento e revisão do cadastro antes de permitir remoção pelo custodiante; não há exclusão automática. A integração identificada do sistema continua pendente. O SLA foi fixado em 24 horas corridas por etapa humana; vencimento apenas sinaliza atraso e não aprova, rejeita nem troca o responsável automaticamente. Prazo e atraso são dados internos de gestão e auditoria e não são devolvidos ao solicitante. Storage, `coala` e RH não formam transação distribuída. A Etapa 2 está fechada como implementação local, mas só pode ser declarada liberada depois do cutover, homologação e publicação coordenados.

**Decisão de 14/10/2026:** as próximas etapas devem preservar a separação entre marcação original, ocorrência aprovada e tratamento da jornada, conforme a Portaria MTP nº 671/2021. As definições abaixo são contratos para implementação futura, não funcionalidades já entregues nem declaração de conformidade do produto. O registrador próprio está no [plano de REP-P](../../plano-rep-p-controle-de-ponto.md) e o tratamento no [plano de Jornada e Fechamento](../../plano-jornada-fechamento-rh.md).

## Etapa 1 — catálogo e governança das regras (implementada)

A entrada fica em **Configurações → Pessoal → Tempo → Ausências**. Cada tipo é uma versão imutável depois de publicado e contém:

- nome, descrição e cor;
- solicitação por dia, hora ou ambos;
- quem poderá iniciar: colaborador, gestor, DP ou sistema;
- efeito pretendido na jornada;
- participação ou não no indicador de absenteísmo;
- intenção de bloquear o período na escala quando houver aprovação;
- vigência da versão;
- uma ou mais regras por vínculo e abrangência;
- forma de contagem, limites, antecedência e retroatividade;
- exigência de anexo;
- fluxo de aprovação;
- edição/cancelamento futuro e instruções ao solicitante.

As regras usam a mesma abrangência de Jornadas: empresa, organização, grupo ou unidade, refinada por cargo, função e pessoa. A precedência é **pessoa → função → cargo → abrangência**. Duas regras do mesmo tipo não podem empatar no mesmo nível para vínculos que se interceptam. A simulação por colaborador mostra a regra vencedora sem criar solicitação.

Cada regra pertence exclusivamente ao tipo de ausência em edição. Uma regra criada em **Atestado médico**, por exemplo, não é aplicada a nenhum outro tipo. A tela identifica esse escopo inclusive durante a criação, antes de o novo tipo receber um nome.

Cada bloco do editor possui ajuda contextual aberta por clique ou toque. A unidade da solicitação pode habilitar **Dias**, **Horas** ou ambos; quando ambos estiverem ativos, o pedido futuro escolherá uma unidade por solicitação. Na aba Regras, a ajuda permanece disponível junto a quatro grupos — público e abrangência, contagem e aprovação, limites/prazos/documento e gestão da solicitação — e detalha as opções de cada grupo. Os campos em duas colunas mantêm os controles alinhados mesmo quando um rótulo ocupa duas linhas.

O tipo pode ser identificado por uma paleta ampliada de doze cores. A cor é somente uma distinção visual e não altera precedência, aprovação ou efeito. As instruções ao solicitante podem ser geradas a partir da regra ativa; o texto reflete vínculos, abrangência, unidade, contagem, prazos, anexo, aprovação, efeito e bloqueio da escala, continua editável e só é persistido quando o rascunho for salvo. Para o rascunho existente de **Atestado médico**, a sugestão é preenchida quando ainda não houver instrução gravada.

### Efeito na jornada

O efeito descreve a apuração de tempo da ocorrência aprovada; ele não define sozinho pagamento ou desconto em folha:

- **Ausência justificada:** registra que a pessoa não trabalhou, mas mantém o período classificado como justificado, sem crédito de trabalho ou débito no banco;
- **Ausência não justificada:** mantém o tempo previsto como não cumprido e o encaminha como falta não justificada para os fluxos posteriores de ponto e DP;
- **Crédito como período trabalhado:** considera o período cumprido na jornada, sem marcação de ponto e sem criar hora extra;
- **Débito em banco de horas:** consome do saldo a quantidade aprovada; saldo insuficiente não permite aplicação automática e exige tratamento pelo DP;
- **Revisão manual:** não produz efeito automático até que o DP defina o tratamento da ocorrência.

Na Etapa 1, essas opções são somente configuração. A movimentação efetiva ocorre nas etapas futuras após uma solicitação aprovada e deve ser idempotente e auditável.

### Hierarquia de aprovação

O fluxo é configurado em cada regra por público, depois que vínculo e abrangência definem quem ela alcança:

- **Automática:** o servidor aprova somente depois de todas as validações da regra, sem decisão humana;
- **Gestor:** uma etapa atribuída ao gestor direto vigente do colaborador;
- **Departamento Pessoal:** uma etapa atribuída à fila do DP;
- **Gestor → Departamento Pessoal:** duas etapas sequenciais; o DP só recebe depois da aprovação do gestor.

Uma rejeição encerra as etapas seguintes e respeita a exigência configurada de motivo. Quando o fluxo exigir gestor e não houver um gestor direto válido, o pedido não pode avançar automaticamente nem escolher outro usuário por inferência: fica pendente e sinalizado ao DP. A Etapa 2 congela no pedido o fluxo e a regra aplicados, mas resolve a autorização de quem decide novamente no servidor em cada ação. Cada etapa humana recebe 24 horas corridas a partir de sua atribuição; ao passar de Gestor para DP, começa um novo prazo de 24 horas. O vencimento fica visível somente nas superfícies internas autorizadas, sem decisão ou encaminhamento automático; o solicitante não recebe prazo, atraso ou indicador de SLA. Nenhum substituto é concedido implicitamente.

```text
rascunho --publicar--> publicado --arquivar--> arquivado
                         |
                         +--duplicar--> novo rascunho versionado
```

Somente rascunhos são editáveis ou excluíveis. A publicação de uma nova versão exige início de vigência posterior, arquiva a versão anterior e encerra sua vigência no dia anterior. Nenhum tipo é criado ou publicado automaticamente.

### Persistência, acesso e API

- Coleção: `dp_absenceTypes`.
- Listagem limitada a 100 documentos, carregada apenas na aba administrativa e sem polling.
- `GET/POST /api/dp/time/absence-types`.
- `GET/PATCH/DELETE /api/dp/time/absence-types/[id]`.
- Escritas e transições geram evento em `actionLogs` com a retenção já usada pelas configurações de Tempo.
- A API exige `dp.settings.manageAbsences` e acesso a todas as unidades. Ocultar a aba não substitui a validação no servidor.

O catálogo armazena apenas configuração. Publicar não cria ocorrência, não altera escala, não lança ponto, não movimenta banco de horas e não calcula folha.

## Etapa 2 — solicitação, documentos e decisão

Criar `dp_absenceRequests` com vínculo obrigatório à pessoa, ao tipo e à versão da regra resolvida. O pedido deve guardar um *snapshot* da regra aplicada para que uma publicação posterior não reescreva o histórico.

Reaproveitar vínculo, abrangência, unidade, contagem, limites opcionais por pedido/acumulados, período mensal/anual, antecedência, retroatividade, anexo, fluxo de aprovação e instruções da Etapa 1. Não criar uma política paralela nem tratar o preenchimento desses campos como uma decisão estrutural pendente. Não há condição adicional de elegibilidade aprovada; teto por pedido em branco permanece sem limitação. O documento aceito é descrito nas instruções existentes.

Entradas previstas:

- colaborador em **Minhas solicitações**;
- gestor ou DP no perfil/central de solicitações;
- sistema por uma integração explicitamente identificada.

```text
rascunho -> enviado -> em análise -> aprovado
                            |          |
                            |          +-> cancelado (quando a regra permitir)
                            +-> rejeitado
                            +-> ajustes solicitados -> enviado
```

Antes do envio, a interface deverá mostrar datas/horas no padrão brasileiro, quantidade calculada, documentos obrigatórios, aprovadores, o prazo de 24 horas corridas por etapa humana, retroatividade, limites restantes e o impacto ainda informativo na operação.

Quando a regra exigir documento, o arquivo deve estar anexado e validado no servidor antes da criação do pedido, não somente antes do envio. A preparação/upload pode usar uma referência temporária privada; ela não equivale a pedido aceito e precisa de expiração e limpeza delimitadas. O envio revalida a existência e o vínculo do arquivo. Não existe modalidade de documento obrigatório pendente de entrega posterior. Respeitar os prazos já configurados; não confundir antecedência/retroatividade com SLA do aprovador.

### Motivo, envio em duas etapas e aprovação por decurso de prazo (19/10/2026)

- **Coala Go (Etapa 7):** a entrada Solicitações do app repete as duas etapas com as mesmas rotas (opções, prévia, preparo de anexos, rascunho e `submit`, com as chaves reaproveitadas entre tentativas), mostra a regra de decurso de prazo no resumo e a tag "Aprovada por decurso de prazo" na lista. Anexo depois do envio, edição de rascunho e acompanhamento detalhado seguem na web.

- **Motivo:** campo opcional (`reason`, 10 a 1000 caracteres) na criação e na edição do rascunho; gravado no pedido, exibido ao titular e a quem analisa (detalhe e fila).
- **Envio em duas etapas:** o painel `AbsencePreviewPanel` pede tipo, período, motivo e comprovantes já na primeira etapa (o anexo obrigatório trava "Concluir"); "Concluir" calcula a prévia no servidor e abre o resumo; "Enviar solicitação" cria o rascunho e o envia em seguida (`submit`), com chaves de repetição próprias. Se só o envio falhar, o rascunho fica salvo para enviar pelo detalhe. "Salvar rascunho" continua disponível. O mesmo painel abre no Registro de ponto, com a data do dia "sem batidas" já preenchida.
- **Aprovação por decurso de prazo:** a regra do tipo ganha `tacitApprovalDays` (1 a 30 dias corridos; regras novas vêm com 3; em branco, nunca). A função `absenceTacitApprovalJob` (a cada hora, minuto 5) chama `POST /api/jobs/dp/absences/tacit-approval`, que percorre com cursor os pedidos `in_review` com o prazo de 24 h vencido (índice existente `workspaceId`+`status`+`reviewSla.deadlineAt`; páginas de 100, até 1.000 lidos e 50 aprovados por execução, para que vencidos de regras sem decurso não escondam os que já devem ser aprovados) e aprova a etapa cujo prazo, contado de `reviewSla.startedAt`, venceu. O prazo vale por etapa: no fluxo gestor e depois DP, o pedido pode levar até o dobro (ex.: 6 dias com prazo de 3). A aprovação usa o mesmo caminho da análise humana (reservas, ocorrência, escala, notificação e auditoria) com o ator de sistema `system:absence-tacit-approval` e `operationId` determinístico; o que exigir confirmação humana (perfil, conflito, regra mudada) é pulado e fica com o DP. O pedido grava `tacitApprovals` por etapa, histórico `tacit_approve` e, na aprovação final por decurso, `approvalOrigin: 'tacit_timeout'`; listas, detalhe e Registro de ponto mostram a tag **"Aprovada por decurso de prazo"**. Pedidos pulados ficam em análise com o DP e a rotina devolve só os códigos opacos (`skippedCodes`); o alerta ao DP para pedido vencido que não pode ser aprovado sozinho é pendência. A auditoria (`dp_absenceAudit` e eventos) grava a ação `tacit_approve`. Reverter só com fraude comprovada fica para implementação futura. O motivo é texto livre e pode conter dado sensível: o campo orienta a não descrever diagnóstico (o atestado vai no anexo), e o espelho/fechamento deve referenciá-lo sem reproduzir. Custo: 24 execuções/dia × até 1.000 leituras (normalmente poucas dezenas; consulta vazia ≈ 1 leitura).
- **Competência fechada:** criação, alteração de rascunho, envio, cancelamento e decisão humana conferem todas as competências civis tocadas pelo período; a rotina de decurso faz a mesma conferência antes de aprovar. Se qualquer `ptrp_competenceClosures/{workspace}_{AAAA-MM}` estiver fechado, a ação falha com `PTRP_COMPETENCE_CLOSED`. A checagem é repetida dentro da transação que muda o pedido, serializando a ausência com fechamento/reabertura; para corrigir, o DP precisa reabrir a competência e gerar nova versão do fechamento. **Custo:** uma ação comum de um mês acrescenta uma leitura antes e uma dentro da transação; o limite técnico de 180 dias toca no máximo sete competências, portanto até 14 leituras. No decurso, o custo se aplica somente aos candidatos efetivamente tentados, além das até 1.000 leituras paginadas já descritas; não há listener nem consulta sem limite.

### Responsáveis e documentos — decisões de produto

- Configurar uma hierarquia ordenada com quantos níveis forem necessários, admitindo uma ou mais pessoas, função e cargo. Na ausência de responsável elegível pela função, usar o cargo alternativo explicitamente configurado; não inferir um diretor/presidente fixo.
- A hierarquia resolve responsáveis das etapas humanas, sem substituir as duas decisões obrigatórias de Gestor → DP nem converter um fluxo humano em automático.
- Proposta operacional para implementação: o primeiro nível com responsáveis elegíveis recebe a etapa; entre vários responsáveis do mesmo nível, a primeira decisão válida encerra essa etapa, com proteção contra decisões concorrentes. Nenhum responsável encontrado mantém a pendência sinalizada, sem aprovação automática.
- Falta de ocupante elegível e falta de resposta são situações diferentes. Toda etapa humana tem prazo fixo de 24 horas corridas a partir da atribuição. O sistema sinaliza o vencimento apenas internamente e conserva o responsável; silêncio não aprova, rejeita nem encaminha automaticamente. A auditoria histórica deve preservar etapa, responsáveis, início, limite, decisão e atraso, sem expor esses campos ao solicitante.
- Durante a análise, os aprovadores autorizados da etapa atual podem ler o conteúdo necessário à decisão por sua atribuição contextual. Depois da aprovação final, o conteúdo fica restrito ao titular e ao DP responsável que tenha a permissão de documentos de ausência e escopo da unidade. A trilha da decisão continua acessível conforme as permissões do pedido, sem conceder acesso ao arquivo. Revalidar permissão, unidade, custódia e etapa em cada leitura e revogar acesso de quem deixou a etapa.

Anexos devem ficar em caminho segregado por workspace, pedido e proprietário, sem URL pública. Metadados entram no pedido; conteúdo binário permanece no Storage. Acesso exige vínculo com o pedido e permissão, com auditoria. Uma pasta ampla nunca funciona como autorização. Classificar por tipo como dado pessoal ou sensível conforme o conteúdo; informações de saúde são sensíveis. Não copiar o conteúdo dos comprovantes para logs, notificações, projeções da escala ou arquivos de ponto.

A política escolhida para os anexos deste fluxo é retenção durante o vínculo e por **20 anos após o desligamento**. Antes do desligamento, não há vencimento calculado por esse marco. Guardar a origem/data de desligamento e registrar eventual correção ou readmissão para revisão do vencimento, sem eliminar por uma data desatualizada. Ao vencer, avisar o DP responsável e solicitar autorização para remover; não excluir automaticamente. Registrar autorização, execução e falhas; conservação adicional exige motivo e próxima revisão. Os 20 anos são decisão de produto para este fluxo: a obrigação específica da NR-7 sobre prontuários ocupacionais não transforma todo anexo de ausência em prontuário, nem define por si só a retenção de todos os registros de ponto.

No recorte **server local**, cada anexo reivindicado cria `dp_absenceRetentionCases/{requestId}_{fileId}` e auditoria na mesma transação RH do pedido. A projeção guarda apenas identificadores, custódia DP, marco de revisão, estado/versão e prova de origem do desligamento; nunca bytes ou URL. Um cursor por beneficiário (`dp_absenceRetentionReconciliations`) ancora ou revalida casos em páginas limitadas. `onUserProfileChange` o inicia depois de revogar acesso e antes dos efeitos ocupacionais; uma agenda continua páginas pendentes. A reconciliação entre `coala` e RH é idempotente, mas não atômica entre bancos: readmissão/correção força `needs_revalidation` e impede autorização por data antiga. Data civil pode vir de string ou Timestamp; 29/2 +20 anos cai em 28/2 quando o ano destino não é bissexto.

O detector diário consulta **casos** por estado e `reviewAfter`, não arrays de pedidos; marca `awaiting_authorization` e gera aviso in-app genérico ao custodiante comprovado, com ID idempotente. Custodiante ausente/inválido passa a `needs_revalidation`. `GET /api/dp/absence-retention` lista por workspace/unidade e cursor; `POST /api/dp/absence-retention/[caseId]/decision` exige custodiante DP, motivo, versão esperada e UUID, para autorizar ou conservar até próxima data futura. Autorização e execução são ações distintas.

O executor local de `POST /api/dp/absence-retention/[caseId]/execute` apaga somente o **arquivo comprobatório daquele anexo** depois dos 20 anos e da autorização do custodiante; pedido, ocorrência, aprovações, auditoria e recibo permanecem. Ele congela no caso o bucket, caminho, geração e hash, confere novamente desligamento, data, `sessionVersion` e `employmentCycleVersion`, e cria `absenceDocumentDeletionFence` no cadastro da pessoa antes de chamar o Storage com `ifGenerationMatch`. Desligamento, readmissão, correção cadastral, onboarding e sincronização Bizneo conhecidos usam o guard transacional; scripts administrativos conhecidos param se existir fence. As regras de cliente negam acesso direto, mas Admin SDK externo ao repositório não pode ser contido por Firestore Rules e continua sujeito ao procedimento operacional de não escrever fora desses serviços.

Não existe transação global entre Storage, `coala` e RH. Por isso, resposta incerta mantém o fence em `execution_unknown`; a Function `absenceRetentionExecutionReconciliation`, a cada 15 minutos e em lote de até 20, verifica a geração. Arquivo ausente conclui metadados e recibo; a mesma geração pode ser tentada novamente; geração diferente ou âncora alterada exige revisão humana e não libera a trava por timeout. `dp_absenceRetentionExecutionReceipts` preserva o alvo e o resultado permanentemente no RH. O `DELETE` legado do anexo continua bloqueado para impedir atalho fora desse protocolo. Não há exclusão automática pelo simples vencimento, nem prazo de aprovação, push específico de retenção ou implantação nesta branch.

Na central DP, a seção sob demanda **Retenção de documentos** aparece somente para quem pode revisar pedidos. A consulta exige unidade selecionada e usa estado/cursor, 25 casos por página, sem polling. O painel lateral mostra apenas os metadados públicos do caso; `awaiting_authorization` oferece ao custodiante comprovado as escolhas “Autorizar exclusão” ou “Manter documento”, com motivo de pelo menos 10 caracteres, confirmação inline e, para manter, próxima revisão futura. A UI relê a fila após decidir. `authorized` oferece uma segunda confirmação explícita para remover o arquivo; estados intermediários informam preparação, execução, conferência ou finalização. `needs_revalidation` e `execution_review_required` exigem intervenção humana. A fila não permite ler o anexo. Permissão, unidade, custódia, titularidade, versão e marco do desligamento são revalidados no servidor em cada ação.

### Ocorrência aprovada e contrato para o ponto

A aprovação final cria uma ocorrência histórica própria, vinculada ao pedido e à revisão aprovada, na mesma transação RH da decisão e da auditoria. O identificador é estável e a repetição da aprovação não duplica a ocorrência. A aplicação na escala pertence à Etapa 3 e o tratamento no ponto/folha depende da Etapa 4.

Preservar separadamente:

1. pessoa, workspace, vínculo e período civil, horários/fuso quando parcial;
2. origem, solicitante, beneficiário e ator de cada ação;
3. tipo, versão, cópia da regra e base de cálculo usada, inclusive referência/versão da jornada quando necessária;
4. quantidade e unidade, decisões, etapas, responsáveis, motivos e momentos;
5. efeito pretendido na jornada, classificação/justificativa, quantidade abonada, eventual débito de banco e evento de folha, sem presumir equivalência entre esses efeitos;
6. referências aos documentos privados, revisões, reversões e resultados de aplicação por consumidor.

Histórico aprovado não é sobrescrito para corrigir ou cancelar: acrescentar revisão/reversão, manter o vínculo com a decisão original e invalidar a projeção operacional idempotentemente. Uma reversão nunca apaga batidas. Efeitos entre bancos ou sistemas externos usam intenção persistida, idempotência, tentativas e resultado observável, sem alegar uma transação única distribuída.

## Etapa 3 — disponibilidade operacional

### Primeiro incremento local — projeção-sombra (15/10/2026)

Implementado `POST /api/dp/absence-availability/[requestId]/reconcile`, com schema estrito de versão esperada/UUID, usuário ativo, `dp.schedules.edit` ou admin, workspace e unidade revalidados. A transação RH lê ocorrência aprovada e pedido/reversão comprovados e grava apenas `dp_absenceAvailabilityShadow`, recibo `dp_absenceShadowOperations` e auditoria. Guarda titular, unidade e intervalos, sem nome, tipo, motivo ou documento. Repetição da mesma operação não duplica escrita; versão antiga não reativa cancelamento. Histórico sem versão/segmentos verificáveis falha fechado.

Esse primeiro incremento continua disponível apenas como trilha de sombra. A implementação posterior acrescentou consulta operacional, pré-voo, Natasha, guard de writers conhecidos e aplicação auditada na escala; a sombra não é usada para afirmar disponibilidade.

Nenhuma marcação original de ponto é alterada. A coordenação da escala usa marcadores e fences próprios, e falhas entre bancos exigem reconciliação explícita sem liberar proteção por timeout.

### Incremento local de protocolo operacional (15/10/2026)

O código local acrescenta intenção e CAS no RH antes de preparar, relógios e marcadores por pessoa/dia no banco `coala`, pré-voo limitado de turnos (inclusive início na véspera para horário noturno) e férias aprovadas, fence preparado/ativo/tombstone e reconciliação explícita de ativação, reversão ou aborto. Aprovação final operacional cria ocorrência, auditoria e outbox na mesma transação RH; a ativação Coala é posterior, com confirmação RH separada. Enquanto a confirmação faltar, o marcador preparado permanece bloqueante, sem expiração automática. O DTO distingue `preparing`, `activation_pending`, `active`, `reversal_pending` e `reversed`; não afirma transação entre bancos nem entrega exatamente uma vez. A projeção-sombra permanece independente.

No detalhe web, a situação do pedido e a aplicação operacional aparecem separadas. `preparing` informa o bloqueio temporário e oferece aborto somente quando o DTO autoriza, com confirmação inline de que isso não cancela/rejeita o pedido. `activation_pending` e `reversal_pending` oferecem reconciliação explícita somente a quem recebe `canReconcile`; não há polling. Cada POST operacional usa a versão exibida e é seguido de GET do detalhe, mesmo após erro de rede, antes de apresentar resultado. Um pedido aprovado com ativação pendente não é mostrado como aplicado. `active` indica proteção de disponibilidade, não alteração de turnos ou batidas. O servidor revalida usuário ativo, permissão `dp.schedules.edit`/admin, workspace e unidade; aborto também exige revisor atribuído/custodiante/admin e exclui autor/titular. O teste E2E de interface usa DTO/API interceptados porque o gate operacional não é ativado no ambiente demo padrão; não comprova operação real no navegador.

Ativação em produção (Fase 2, 17/10/2026): `DP_ABSENCE_OPERATIONAL_GUARD=on` é aceito em dois formatos apenas, conferidos por `absenceGuardEnvironmentAccepted` (`guard-environment.ts`): projeto `demo-*` com emuladores Firestore/Auth loopback, ou o projeto `smart-converter-752gf` sem nenhum emulador configurado; qualquer mistura falha fechada (`ABSENCE_OPERATIONAL_GUARD_ENVIRONMENT_INVALID`). Aceitar o ambiente não autoriza escrita: cada transação protegida continua exigindo o recibo `workspace_all` em `ready`, com época, hash de escopo, cobertura e bootstrap completo. Enquanto o guard estiver desligado em ambiente real, a aprovação final segue bloqueada (`ABSENCE_OPERATIONAL_PRODUCTION_NOT_READY`). Ordem obrigatória da virada: bootstrap em produção sob quiescência → recibo `ready` → `DP_ABSENCE_OPERATIONAL_GUARD=on` no `apphosting.yaml` por PR/promoção. Não há escrita no ponto ou Bizneo pela projeção de ausência. O teste E2E de interface usa DTO/API interceptados.

### Incremento local Natasha v2 — fonte operacional limitada (15/10/2026)

As transações Coala de preparo, ativação, reversão e aborto agora mantêm `dp_absenceOperationalAvailability/{requestId}` junto do fence e marcadores. A projeção contém apenas workspace, titular, unidade, versão/revisão/fence, época, datas/intervalos, `blocksSchedule` e estado; não contém tipo, motivo, documento ou nome. A API `GET /api/dp/natasha/availability` versão 2 consulta candidatos autorizados por workspace/unidade/janela e cruza cada projeção com o pedido RH e seu ack. Só `active` com ack RH `active`, mesma versão/fence/época, `blocksSchedule=true` e recibo de readiness com janela coberta entra em `approvedAbsences`. `prepared`, pendência de ativação/reversão, falta de projeção, órfão, divergência ou limite retornam `status: incomplete`, nunca pessoa livre por omissão. O nome vem da equipe candidata autorizada. Férias continuam no relatório; folgas e indisponibilidades externas **não** estão incluídas e continuam perguntas humanas.

O coletor Firestore offline anterior foi bloqueado antes de autenticação/leitura no contrato `natasha-offline-snapshot/v2`, pois não consegue provar ack RH e bootstrap Coala. Não usar o snapshot legado para declarar disponibilidade. A API e o protocolo permanecem **somente locais/demo**: não há recibo de produção, implantação, validação de índices reais ou conferência de histórico real. A Function de desligamento e os scripts conhecidos recebem as barreiras descritas abaixo, mas isso não comprova cobertura de todos os escritores. A projeção-sombra RH segue separada e não alimenta Natasha.

### Bootstrap local e bloqueio dos writers legados (15/10/2026)

`scripts/bootstrap-absence-operational.mts` aceita o projeto `demo-*` em emuladores loopback ou, com `--production`, o projeto de produção sem emulador; sempre exige guard `on` no próprio processo, workspace/janela explícitos e `--confirm-quiescence`. `--dry-run` faz uma passada de leitura e validação sem gravar o recibo e sem exigir quiescência, para achar dados inválidos antes da janela. O limite por fonte é 2.000 por padrão e configurável com `--max-per-source` até 20.000 (produção tinha 1.814 turnos em 17/10). Escalas legadas do formato antigo (uma por mês para todas as unidades, sem `unitId` na escala) são aceitas como histórico somente se trancadas e com todos os turnos antes de `--from`; seus turnos continuam no hash, mas não passam pela checagem de unidade/tipo. Produção tinha 5 escalas assim (dez/2025 a abr/2026, 612 turnos, 5 sem tipo), por isso a janela de produção começa em 2026-05-01. A execução grava `bootstrapping` por CAS e depois faz duas passagens paginadas (100 por página) por 11 fontes Coala/RH; compara hash de dados, caminho, updateTime e contagens, e valida projeções, fences, marcadores, ocorrências e ack do outbox. Apenas o mesmo runId/época/hash-base promove `ready`. Falha conserva `bootstrapping`, nunca libera um `ready` anterior por omissão. Duas passagens **não** são snapshot atômico entre bancos: o operador precisa impedir mutações concorrentes antes e durante a auditoria.

O trigger de desligamento revoga Auth/claims/cache antes de tentar efeitos ocupacionais. Sem recibo, aplica o caminho legado (salvo guard pedido por variável, que deixa pendente). Com recibo `bootstrapping` ou inválido, não executa os efeitos e deixa `terminationEffectsStatus: pending_occupancy_guard`, sem versão 1; nova entrega do trigger com o mesmo marcador não o regrava. Com recibo `ready` válido, as remoções de ocupação (turnos futuros e cancelamento de férias de gozo) são aplicadas em transações de até 150 pessoa/dia que revalidam recibo e época, incrementam os relógios `dp_absenceOccupancyClocks` (mesmo id do app, `functions/src/absence-occupancy-clock.ts`) e recalculam `shiftCount` da escala; se o recibo mudar no meio, o desligamento volta a pendente. A Function `absenceTerminationEffectsResume` (a cada 30 min) só age com recibo `ready`: toca até 20 cadastros pendentes (`terminationEffectsResumeRequestedAt`) para que `onUserProfileChange` reaplique pelo caminho único. Erro de revogação não é tratado como conclusão nem como pending. `migrate-dp`, `sync-shopping --apply` e merge administrativo `--apply/--rollback` recusam escrita quando guard solicitado ou readiness em bootstrap/ready.

### Fechamento local da Etapa 3 — escala e cobertura do DP (15/10/2026)

Quando a ausência aprovada tem `blocksSchedule=true`, a ativação Coala localiza de forma limitada os turnos da pessoa no período, valida horário noturno e remove somente os turnos de trabalho que realmente se sobrepõem. Antes da exclusão, cada documento completo é preservado em `dp_absenceDisplacedShifts`, com caminho original, escala, fence, versão e momento. O contador da escala e as versões de validação de metas/jornada são atualizados na mesma transação. A projeção mínima `dp_absenceOperationalAvailability` recebe `monthKeys`; `GET /api/dp/schedules/[scheduleId]/absences` entrega somente titular, unidade, datas e intervalos à escala, sem tipo, motivo ou documento. A interface mostra a ausência separadamente dos turnos. Cancelamento invalida a projeção; um turno antigo não é restaurado automaticamente por cima de alterações posteriores, e uma tarefa de revisão é criada para o DP.

**Cobertura do turno (27/10/2026, local, sem deploy):** a recomposição deixou de ser só uma nota livre. Logo após a aprovação final, o painel da ausência mostra **Cobertura do turno** para cada documento de `dp_absenceDisplacedShifts` (`src/features/dp/absences/coverage/`). Quem tem `dp.schedules.edit` e acesso à unidade escolhe: **coberto por alguém**, **quiosque fechado nesse turno** ou **desfalque**. A lista de candidatos (`GET /api/dp/absence-coverage/[requestId]/candidates`) traz primeiro as pessoas vinculadas à unidade e, só para quem tem `dp.schedules.assignExternal`, pessoas de outras unidades por busca de nome (variações de maiúsculas). Cada pessoa é conferida pela própria jornada resolvida na data (`validateDPJourneySchedule` antes e depois do turno hipotético: jornada ausente/ambígua, turno não permitido, turno menor, dias seguidos) e pela agenda gravada em ±13 dias (folga, choque de horário inclusive turno noturno, descanso menor que 11h, marcador de ausência e férias aprovadas). Quem não pode cobrir aparece desabilitado com o motivo. `POST /api/dp/absence-coverage/[requestId]` revalida a elegibilidade, grava o turno pelo mesmo `saveWorkShift` do editor (ID determinístico `absence-coverage-*`, cobertura externa com motivo e fora das metas), registra a decisão em `coverage` do turno retirado, avisa o substituto no sino, audita em `actionLogs` e, quando todos os turnos da ausência têm decisão, conclui a pendência `*_schedule_recomposition`. Repetição com o mesmo `operationId` é idempotente. **Lacunas:** "fechado" e "desfalque" ficam registrados na decisão, mas ainda não aparecem marcados na grade da escala nem alteram a demanda de cobertura; cobertura parcial de horário e estimativa de hora extra não existem; regra de descanso semanal em posição fixa do ciclo não é conferida (só dias seguidos); dias seguidos acima de 13 não são detectados pela janela. Custo por consulta de candidatos: até 3+2 consultas de usuários limitadas a 60, catálogo de até 100 jornadas, turnos dos candidatos em ±13 dias (até 28 por pessoa), férias por pessoa e marcadores do dia; sob demanda, sem polling.

A responsabilidade operacional do DP é separada em duas dimensões: **permissão** para executar a atividade e **abrangência** sobre o grupo/unidade. Em **Configurações → Pessoal → Responsabilidades → Coberturas**, quem possui `dp.responsibilities.manage` configura uma hierarquia por atividade e grupo: pessoas, função com cargo alternativo e cargo, em níveis ordenados. O primeiro nível com pessoas ativas que tenham a permissão da atividade e acesso a todas as unidades do grupo é efetivo; todas as pessoas aptas desse nível recebem o aviso no sino, e a primeira que assumir a tarefa vence por CAS. Um grupo sem unidades ou sem pessoa apta pode ficar em rascunho, mas não ser ativado. A retirada da última cobertura ativa é bloqueada até existir substituição válida.

Turnos deslocados criam `dp_responsibilityTasks` paginadas na Central do DP. Sem cobertura, a tarefa fica `unassigned` e o sino avisa somente perfis com `dp.responsibilities.receiveUnassignedAlerts` (ou administrador padrão); ela não desaparece. Mudanças de usuário, perfil/permissão, cargo, função, abrangência, unidade ou grupo acionam reconciliação limitada pelas Functions. Alterar a própria cobertura também reencaminha tarefas pendentes na transação. Assumir e concluir exigem versão esperada, unidade, permissão e auditoria. Não há e-mail ou push neste fluxo.

Inventário de escritores de ocupação (17/10/2026): turnos, escalas e férias são gravados pelas APIs com guard (`shifts`, `shifts/bulk`, `day-offs`, `schedules` estado/exclusão, `hr/vacations`, protocolo de ausências) e pelo desligamento nas Functions (acima). As demais gravações nessas coleções não mudam ocupação: e-mail do contador e conclusão de pagamento em `dp_vacations`, demandas de cobertura em `dp_schedules`. As regras Firestore negam escrita do cliente em `shifts` e `dp_vacations`; o cliente pode atualizar campos não protegidos de `dp_schedules`, que não entram no cálculo de ocupação. Pendentes: homologação e virada em produção (Fase 3). A Etapa 4 permanece fora deste fechamento.

### Contrato para ativação operacional

A partir da ocorrência histórica criada na aprovação final da Etapa 2, o servidor deverá manter uma projeção limitada por pessoa e período para a escala. A ocorrência, e não o texto do pedido, será a fonte operacional.

- A ocorrência aprovada bloqueia somente os períodos configurados para bloquear escala.
- A Natasha recebe a projeção como indisponibilidade autoritativa antes de montar ou refazer uma escala.
- Quando a ausência aprovada bloquear a escala e já existir turno futuro, a aplicação operacional retira o titular daquele turno ativo, preserva o turno e a alteração no histórico, exibe a ausência no período e gera uma pendência para o DP responsável pela escala mensal recompor a cobertura. Responsáveis operacionais da unidade não recebem essa atribuição apenas por sua responsabilidade territorial. Não existe opção de manter simultaneamente a mesma pessoa escalada e ausente.
- Rejeição ou cancelamento não cria indisponibilidade.
- Reversão preserva o histórico e remove/invalida a projeção por operação idempotente.
- Férias continuam chegando pelo domínio próprio e não são duplicadas como ausência.

A análise deve respeitar escopo de unidade e separar `view`, `review` e eventual permissão para reverter decisão. A regra configurada informa o fluxo, mas o servidor volta a resolver autorização a cada ação.

## Etapa 4 — ponto, folha, integrações e indicadores

**Revisão de 17/10/2026:** esta etapa passa a ser executada dentro do [plano mestre](../../plano-jornada-fechamento-rh.md#6-fases): a parte de ponto na Fase 3 (PTRP) e a parte de folha na Fase 5 (eventos e fechamento). O ponto oficial futuro é o REP-P do Coala; não haverá projeção de justificativas no Bizneo, que sai no longo prazo. Os itens abaixo continuam como requisitos dessas fases.

Somente depois da ocorrência aprovada e do PTRP validado:

- aplicar o tratamento da ocorrência no PTRP, sem alterar a marcação original da ARP;
- creditar período trabalhado, debitar banco ou enviar para revisão, conforme o efeito;
- produzir evento para folha sem calcular valor diretamente neste cadastro;
- consolidar absenteísmo apenas quando `includeInAbsenteeism` estiver ativo;
- disponibilizar relatórios por tipo, vínculo, unidade e período;
- reconciliar falhas de integração de forma idempotente, sem polling de coleções completas.

Cada adaptador deve registrar ID externo, tentativa, resultado sanitizado e capacidade de reprocessamento. Erro de integração não pode mudar uma aprovação para rejeição nem expor dados do anexo.

### Requisitos do MTE para o futuro ponto

Conforme a Portaria MTP nº 671/2021 e a orientação oficial do MTE:

- O registrador preserva marcações originais. A ausência e sua decisão pertencem ao tratamento; aprovação, crédito ou abono não fabricam entrada/saída nem modificam a marcação coletada.
- O tratamento complementa omissões e registra ausências/banco ou indica marcações indevidas, mantendo a origem. Correção por esquecimento tem fluxo próprio e não é uma batida original do trabalhador.
- O REP gera AFD; o PTRP gera AEJ e espelho. As exportações devem seguir os leiautes oficiais vigentes e manter a distinção entre registros originais e tratados.
- Um futuro REP-P exige registro do programa no INPI e requisitos técnicos/documentais aplicáveis, inclusive comprovantes, assinaturas e Atestado Técnico e Termo de Responsabilidade. Não confundir esse processo com homologação de equipamento REP-C nem considerar o plano uma certificação.

Como decisões de arquitetura para cumprir esses requisitos, nenhum módulo de ausências escreve na ARP; o PTRP lê a fonte e acrescenta tratamentos rastreáveis. Uma ausência aprovada não deve bloquear a coleta de uma batida real: eventual trabalho no período gera conflito para análise. Efeito de jornada não determina sozinho pagamento/desconto; a apuração deve respeitar a regra aplicável ao vínculo/período e os instrumentos coletivos pertinentes. Fixar regras e versões no resultado para permitir reprocessamento apenas dos períodos afetados; competência fechada exige reabertura versionada, sem alteração silenciosa.

### Referências oficiais

Consultadas em 14/10/2026; conferir a versão vigente novamente antes da implementação/publicação do ponto:

- [Portaria MTP nº 671/2021 compilada](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/PDFPortarian671de8denovembrode2021compilada08.07.2025.pdf), especialmente arts. 74, 82, 83, 89 e 91.
- [MTE — Perguntas e respostas](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP), itens 12, 19, 36, 38, 40, 55 e 56.
- [MTE — Registro Eletrônico de Ponto e leiautes oficiais](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep).
- [NR-7 — texto que estabelece a guarda de prontuário ocupacional](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/sst-portarias/2020/portaria_seprt_6-734_-altera_a_nr_07.pdf), item 7.6.1.1; escopo distinto da política de anexos escolhida acima.

## Regras de produto aprovadas

- Aprendiz é um vínculo próprio e pode receber política de ausência própria.
- PJ fica fora do domínio de ausência trabalhista.
- Estágio pode ser configurado separadamente, sem herdar automaticamente a regra CLT.
- Férias ficam fora desta central.
- Datas apresentadas ao usuário seguem `dd/mm/aaaa`; a API persiste datas civis como `AAAA-MM-DD`.
- Configuração publicada é histórica e imutável; alteração exige nova versão.
- A ausência só afeta a operação depois de uma solicitação/ocorrência aprovada nas etapas futuras.

## Critérios de aceite das próximas etapas

- Nenhum pedido é enviado sem regra única e vigente para a pessoa e a data.
- A regra aplicada fica congelada no pedido.
- As etapas e os aprovadores resolvidos ficam registrados na trilha, com ordem, decisão, autor e data/hora.
- Anexo obrigatório é validado no servidor antes de criar o pedido e revalidado no envio.
- Ações de gestor/DP respeitam permissão e escopo no servidor.
- Aprovar e reverter são idempotentes e auditados.
- Aprovação final e ocorrência são consistentes atomicamente no mesmo banco; revisões/reversões preservam o histórico.
- Aprovador da etapa pode consultar o documento; depois da aprovação final, apenas titular e DP responsável conservam esse acesso.
- Vencimento da retenção notifica e solicita autorização; nenhuma eliminação automática de anexo por mero decurso do prazo.
- Aprovação, cancelamento e integração não alteram batidas originais; ausência/banco entram no tratamento rastreável.
- A escala recebe apenas ocorrências aprovadas e vigentes.
- Alterações entre competências preservam a continuidade, sem duplicar férias.
- Testes cobrem Aprendiz, exclusão de PJ, precedência, empate, vigência, documento obrigatório, concorrência de decisão e integração com disponibilidade.

## Custo e crescimento

Na Etapa 1, uma abertura da aba faz no máximo 101 leituras de configuração e não usa listener nem polling. Com 5 aberturas por dia por administrador, o teto é 505 leituras/dia por administrador. Validações de escrita leem apenas referências selecionadas e são operações administrativas esporádicas. Antes da Etapa 2, pedidos deverão ser consultados por pessoa/status/período com paginação; nunca por listagem integral da coleção.

No incremento local, a UI solicita páginas de 25 (+1 para detectar continuação); a API aceita no máximo 50 (+1) e faz uma leitura pontual adicional para cursor. Cenário de preflight: 26 documentos × 1 abertura/hora × 100 pessoas × 8 horas/dia × 22 dias = **457.600 leituras/mês** de listas, além de autenticação, recibo e cursores. Não há polling ou listener global. Preparações têm até 5 arquivos, consultas de limpeza até 50 e conflitos de férias até 51 resultados, com falha fechada no teto.

Uma transição cobre no máximo 180 dias por limite técnico transacional, não por política trabalhista: até 180 reservas e 7 buckets mensais (ou 2 anuais), mais pedido, catálogo, ocorrência, eventos e outbox. Prévia pode aceitar janela maior, mas isso não autoriza a persistência. A resolução da hierarquia é finita: até 20 níveis, cada consulta função/cargo até 21 candidatos, até 20 pessoas e 20 perfis; fallback por cargo repete esse teto. Não confundir o custo usual do primeiro nível válido com esse pior caso. Não foi medida economia ou cobrança monetária em produção.

A reconciliação da exclusão roda a cada 15 minutos: são 2.880 consultas de fila em um mês de 30 dias mesmo quando vazias. Cada execução pega no máximo 20 casos e faz somente leituras pontuais/transações do caso, pedido, pessoa e recibo necessários; não varre a coleção inteira. O custo real depende de falhas pendentes e não foi medido em produção.

## Pendências de implantação e próxima etapa

Custos adicionais: página do sino até 26 documentos mais cursor; 5 aberturas/dia × 100 pessoas × 22 dias × 26 = 286.000 leituras/mês, além de autenticação/cursores, sem polling. O dispatcher revalida até 20 destinatários e grava somente os avisos internos elegíveis; não consulta dispositivos para ausências. Reconciliação-sombra: até 7 leituras/3 escritas por operação, além da autenticação; repetição da mesma operação não escreve. Dez operações/dia representam teto ilustrativo de 70 leituras/30 escritas diárias. Os índices RH declarados cobrem as combinações de filtros, inclusive SLA vencido; emulador não comprova provisionamento em produção.

- teste controlado na tela e homologação funcional pelo DP (cutover do catálogo, índices, bootstrap e guard já executados em produção em 17/10/2026);
- inventariar e adaptar qualquer writer Admin externo ao repositório que possa contornar os fences;
- executar testes controlados com Storage real para o descarte após 20 anos, sem remover documentos de produção durante a homologação;
- validar os fluxos de encerramento documental e troca de custódia com o DP responsável;
- mapeamento de cada efeito no PTRP e nos eventos de folha (Fases 3 e 5 do plano mestre);
- possibilidade e autoridade para reverter aprovação já exportada.

As políticas concretas e documentos aceitos são preenchidos nas regras/instruções existentes e validados pelo DP/jurídico antes da publicação; não são um questionário estrutural novo. O sistema não transforma exemplos de interface em política trabalhista. Retenção, classificação e acesso definidos acima têm implementação local; ainda exigem inventário operacional de qualquer writer Admin externo, testes com Storage real controlado, migração/cutover e publicação antes de uso real.
