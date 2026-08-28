# Auditoria de baseline — Google Observability

## Proveniência e limites

Fotografia realizada em 27/08/2026 no projeto de produção por APIs oficiais em modo somente leitura. As janelas de requests encerram aproximadamente entre 23:02 e 23:06 UTC; consultas posteriores de jobs foram até 23:16 UTC. A diferença de poucos minutos explica pequenas variações entre totais de tabelas diferentes.

Esta seção registra o baseline **antes** da Fase A. Durante a auditoria nenhum alerta, canal, métrica, uptime check, dashboard, API, IAM, sink, retenção, secret ou configuração de App Hosting foi criado ou alterado. A conta conseguiu ler Logging, Monitoring, Scheduler e App Hosting. A listagem de Service Usage respondeu `PERMISSION_DENIED`; portanto, o estado de APIs foi inferido por chamadas operacionais oficiais e essa limitação permanece explícita.

As consultas materializaram somente agregações e campos técnicos selecionados. Não foram exportados bodies, Authorization, cookies, tokens, documentos, dados bancários ou dados de RH.

## Inventário pré-ativação

### Cloud Monitoring

| Recurso | Quantidade | Estado |
|---|---:|---|
| alert policies | 0 | inexistentes |
| notification channels | 0 | inexistentes |
| uptime checks | 0 | inexistentes |
| dashboards customizados | 0 | inexistentes |

Cloud Monitoring estava acessível e as métricas nativas do Cloud Run foram consultadas. Naquele corte não existia mecanismo remoto de detecção configurado.

### Cloud Logging

| Recurso | Quantidade/estado |
|---|---|
| log-based metrics definidas pelo usuário | 0 |
| exclusions do projeto | 0 |
| sinks | `_Required` e `_Default`, ativos |
| bucket `_Default` | ativo, retenção de 30 dias, analytics desabilitado |
| bucket `_Required` | ativo, retenção de 400 dias, bloqueado |

Não há sink remoto adicional. A fundação usa a coleta nativa de stdout/stderr do Cloud Run/App Hosting.

### Atualização pós-ativação — 28/08/2026

Após autorização explícita, a Fase A criou e validou:

| Recurso | Quantidade | Estado |
|---|---:|---|
| alert policies | 8 | habilitadas, sem notification channel |
| log-based metrics | 2 | ativas; labels `source`, `error_code` e `job_id` |
| uptime checks | 1 | ativo em `/login`; probes `passed=true` nas três regiões configuradas |
| notification channels | 0 | não criados |
| dashboards customizados | 0 | não criados |

As policies foram criadas desabilitadas, relidas e habilitadas uma por vez. Nenhuma abriu incidente imediato no corte inicial. IAM, sinks e retenções foram comparados antes/depois e permaneceram idênticos. A configuração detalhada está em `observability-phase-a.md`.

### App Hosting, Functions e Scheduler

- backend `studio` acompanha `production`;
- build `build-2026-08-27-003`: `READY`;
- revisão `studio-build-2026-08-27-003`;
- rollout `rollout-2026-08-27-003`: `SUCCEEDED`, 100% do tráfego;
- source SHA: `bb5e439dfce4818d3cf921c88eaded97769da3a3`;
- 34 funções Gen2 estavam `ACTIVE`;
- 23 jobs do Cloud Scheduler estavam `ENABLED`.

Quatro service accounts ativas foram inventariadas: padrão do App Engine, padrão do Compute, Firebase Admin SDK e Firebase App Hosting Compute. Não foi observado service agent de notificação do Monitoring, coerente com a ausência de canais.

## Baseline de requests

### Backend App Hosting `studio`

| Janela | Requests | 4xx | 5xx | Taxa 5xx |
|---|---:|---:|---:|---:|
| 24 h | 2.632 | 1.197 | 113 | 4,29% |
| 7 dias | 22.112 | 5.088 | 1.089 | 4,92% |
| 30 dias | 84.584 | 16.892 | 1.141 | 1,35% |

Os 113 `5xx` das 24 h vieram de revisão anterior; a revisão atual possuía 207 requests e zero `5xx` no corte. A amostra pós-rollout ainda é curta e não sustenta threshold estatístico definitivo.

A janela de 24 h continha 4 revisões, a de 7 dias 26 e a de 30 dias 86. Nas 7 dias, as maiores concentrações de `5xx` estavam em `studio-build-2026-08-25-006` (382), `studio-build-2026-08-22-002` (219), `studio-build-2026-08-24-001` (120), `studio-build-2026-08-23-001` (75) e `studio-build-2026-08-25-001` (59). Nenhuma delas é a revisão atualmente servida.

Das 24 h, 1.187 respostas foram `404`; 873 correspondiam a scanners/probes conhecidos e 230 a assets `/_next` de revisão anterior. Um `404` global, portanto, não é sinal de incidente. `401`/`403` esperados e o `401` do smoke deliberado de `/api/products` também não devem paginar.

Nas 7 dias, 1.042 dos 1.089 `5xx` do App Hosting estavam em `/api/jobs/inter/statements/sync`, concentrados na falha histórica do Banco Inter. O caminho passou a retornar sucesso após a correção e a release atual não apresentou novo `5xx` no corte.

### Projeto inteiro: App Hosting e funções Cloud Run

| Janela | Requests | 4xx | 5xx | Taxa 5xx |
|---|---:|---:|---:|---:|
| 24 h | 3.355 | 1.205 | 236 | 7,03% |
| 7 dias | 27.710 | 5.111 | 2.181 | 7,87% |
| 30 dias | 102.909 | 16.932 | 2.407 | 2,34% |

Esse total não representa incidentes únicos: uma chamada Scheduler → Function → App Hosting pode registrar a mesma falha em mais de um hop. A falha histórica do extrato Inter, por exemplo, aparece no serviço chamador e na rota de destino. Alertas não devem somar cegamente o total do projeto.

## Baseline de `SystemErrorEvent`

Nas 24 h, 7 dias e 30 dias havia exatamente um evento: o smoke sintético autenticado da release atual.

| Dimensão | Valor observado |
|---|---|
| severity | `high`: 1 sintético; demais: 0 |
| source | `browser-unhandled-rejection`: 1 sintético |
| route/job | `/dashboard`: 1 sintético |
| fingerprint | um fingerprint sintético, sem recorrência real |
| eventos reais acionáveis | 0 |
| falhas terminais instrumentadas | 0 |

O evento validou release, `eventId`, fingerprint, sanitização e stack multiline. Ele deve ser sempre excluído das regras operacionais por nome/marcador sintético, não removido dos logs.

As falhas nativas do pacote `functions`/Scheduler ainda não são `SystemErrorEvent` e não possuem fingerprint Coala. Elas são agrupadas por job, status e janela; não se deve fabricar fingerprint a partir de mensagem bruta.

## Falhas de Scheduler observadas

Foram observados 1.264 registros `AttemptFinished` com `ERROR` em 30 dias:

| Job | Tentativas com erro | Dias afetados | Evidência operacional |
|---|---:|---:|---|
| `interStatementSync` | 1.048 | 8 | falha histórica; em 27/08 houve 105 erros até 14:32 UTC e 35 conclusões `OK` a partir de 14:46 UTC |
| `expireQuotations` | 91 | 30 | falha terminal diária recorrente; em 27/08, 2 tentativas terminaram `INTERNAL` |
| `checklistDailyGenerate` | 90 | 30 | falha terminal diária recorrente; em 27/08, 3 tentativas terminaram `INTERNAL` |
| `cashDepositDailyReconciliation` | 24 | 8 | ocorrências entre 05 e 12/08; sem erro recente no corte |
| `interPaymentReconciliation` | 7 | 4 | falhas intermitentes; em 27/08 houve 4 tentativas com erro e 277 conclusões `OK` |
| `checkFieldMapConsistency` | 4 | 4 | ocorrência semanal recorrente a caracterizar |

`AttemptStarted` não é sucesso. As conclusões acima usam apenas `AttemptFinished`: sem status significa conclusão `OK`; status `INTERNAL` significa falha da tentativa. Os registros de `expireQuotations`, `checklistDailyGenerate` e `checkFieldMapConsistency` são dívida operacional conhecida que precisa de triagem separada antes de ativar paging; não devem ser silenciados sem dono, justificativa e prazo, nem chamados de regressão da observabilidade.

## Error Reporting API

A chamada oficial de leitura de grupos respondeu `403 PERMISSION_DENIED` com razão `SERVICE_DISABLED`. A API está desabilitada. A listagem por Service Usage não pôde ser lida com a conta atual, mas a razão retornada pelo próprio endpoint é evidência suficiente do estado operacional.

Recomendação: **NÃO NECESSÁRIO AGORA**. O Cloud Logging já fornece os sinais necessários para busca, log alerts, métricas de baixa cardinalidade e exports da triagem. O Error Reporting acrescentaria agrupamento/UI nativos, mas não substitui o fingerprint do Coala nem é pré-requisito dos alertas propostos. Segundo a [documentação oficial](https://cloud.google.com/error-reporting/docs/setup/compute-engine), o serviço não tem cobrança direta, embora a ingestão subjacente do Logging possa ter custo.

Se houver gate futuro para habilitação, o operador precisará de `roles/serviceusage.serviceUsageAdmin`; leitura dos grupos requer `roles/errorreporting.viewer`. O caminho atual por stdout não exige `roles/errorreporting.writer` nem SDK adicional.

## Permissões usadas na ativação

O principal autorizado já possuía as permissões necessárias; nenhum papel foi concedido ou alterado.

Operação manual por pessoa autorizada não exige criar uma nova service account. Se a configuração vier a ser tratada como código/automação, usar service account dedicada com os papéis estritamente necessários, não uma das contas de runtime da aplicação.

| Ação | Papel mínimo aplicável |
|---|---|
| alert policies | `roles/monitoring.alertPolicyEditor` |
| notification channels | `roles/monitoring.notificationChannelEditor` |
| log-based metrics | `roles/logging.configWriter` |
| uptime checks | `roles/monitoring.uptimeCheckConfigEditor` |
| uso de `gcloud` nessas APIs | pode exigir `roles/serviceusage.serviceUsageConsumer` |

Um canal Pub/Sub criaria/empregaria o service agent de notificação do Monitoring e exigiria `roles/pubsub.publisher` somente no tópico. Service-agent roles não devem ser concedidas a usuários. Referências: [IAM do Logging](https://cloud.google.com/logging/docs/access-control), [IAM do Monitoring](https://cloud.google.com/monitoring/access-control) e [canais do Monitoring](https://cloud.google.com/monitoring/support/notification-options).

## Custo observado e projetado

O projeto ingeriu 272.316.380 bytes em 30 dias, aproximadamente 0,254 GiB. Isso equivale a cerca de 0,51% da franquia mensal de 50 GiB por projeto. Mantidos volume e retenção atuais e disponível a franquia, o custo direto incremental observado do Logging tende a ser zero; isso é estimativa, não garantia de fatura.

Pela [tabela oficial de preços](https://cloud.google.com/products/observability/pricing), Logging custa US$ 0,50/GiB após a franquia e retenção adicional custa US$ 0,01/GiB/mês. Métricas nativas do Google Cloud não são cobradas como custom metrics. Métricas baseadas em logs são custom metrics; por isso a proposta limita-se a poucos contadores sem fingerprint. Um uptime check a cada 5 minutos em três locais produziria aproximadamente 25.920 execuções/mês, abaixo da franquia atual de 1 milhão por projeto, mas ainda exige revisão da fatura real.

Leituras programáticas do Monitoring custam US$ 0,50 por milhão de time series lidas depois da primeira franquia de 1 milhão por billing account; consultas feitas pela interface do Cloud Console não entram nessa cobrança. A triagem proposta é sob demanda, sem polling, justamente para limitar esse risco.

Políticas de alerta não têm cobrança antes de 01/09/2027 segundo o cronograma atual; depois disso, a tabela anuncia cobrança por condição/métrica e pontos consultados. Provedores dos canais, como telefonia ou PagerDuty, podem cobrar separadamente. Alto volume, alta cardinalidade, labels não controladas e consultas automatizadas excessivas são os maiores riscos indiretos.

## Conclusão

Cloud Logging e Cloud Monitoring bastam para a fase inicial sem Sentry, SDK de logging ou Error Reporting. A Fase A ativa usa sinais de baixa cardinalidade e trata fingerprint somente como chave de pesquisa/triagem. A cobertura provisória é `06:00–23:00 BRT`, mas nenhum SLA por e-mail/paging está ativo porque existem zero notification channels. `checklistDailyGenerate`, `expireQuotations` e `checkFieldMapConsistency` exigem triagem antes de qualquer paging; logs e evidências não foram silenciados.
