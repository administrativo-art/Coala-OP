# Auditoria de observabilidade no Google/Firebase

## Escopo e método

Auditoria somente leitura realizada em 26/08/2026 no projeto Google/Firebase já associado ao Coala-OP. Foram consultados metadados de App Hosting, Cloud Run, Cloud Functions, Cloud Logging, Error Reporting, Cloud Monitoring e IAM por APIs e CLIs oficiais. Nenhuma configuração remota foi alterada.

Valores de variáveis de ambiente, identidades IAM, mensagens, stacks e payloads de logs não fazem parte deste documento. Consultas de conteúdo produziram somente contagens e classificações agregadas.

## Resultado executivo

O ecossistema Google existente foi aprovado como central inicial, sem contratar outro fornecedor, condicionado à conclusão de três pontos:

1. validar após rollout a saída do sink adaptado ao formato explicitamente reconhecido pelo Error Reporting;
2. criar alertas e canais de notificação compatíveis com a política operacional aprovada;
3. manter a proteção automatizada que impede a redistribuição ampla dos secrets do PDV nas Functions.

Cloud Logging e Error Reporting já recebem e agrupam erros do App Hosting e das Functions. Não há evidência que justifique adicionar Sentry nesta fase.

## Inventário da infraestrutura

| Superfície | Evidência observada |
|---|---|
| Firebase App Hosting | Um backend ativo, `studio`, em `us-central1`, conectado ao repositório GitHub do Coala-OP. |
| App Hosting builds | 713 builds retornados pela API; o mais recente observado foi `build-2026-08-25-006`, estado `READY`. |
| App Hosting rollouts | 714 rollouts retornados; o rollout correspondente ao build mais recente estava `SUCCEEDED`. |
| Vínculo de release | O build mais recente estava ligado ao commit `36a3f45033c5467a34f95d5c2d07c1fdf24b7723`; a revisão ativa observada nos logs era `studio-build-2026-08-25-006`. |
| Cloud Run | 37 serviços: 34 gerenciados por Cloud Functions, o serviço do App Hosting e dois serviços adicionais. |
| Cloud Functions | 34 Functions Gen 2 ativas em Node.js 24; predominância em `us-central1`, com duas funções de evento Firestore em `southamerica-east1`. |
| Cloud Logging | Buckets `_Default` e `_Required`, sem sink customizado e sem métrica baseada em log. |
| Error Reporting | Endpoint respondeu com sucesso e retornou grupos de erro existentes. |
| Alertas | Zero políticas de alerta e zero canais de notificação. |

## Logging e correlação

Uma amostra dos 5.000 registros mais recentes dentro de 30 dias mostrou:

| Indicador | Resultado na amostra |
|---|---:|
| Cloud Run revision | 2.700 |
| Firebase App Hosting backend | 1.671 |
| Cloud Scheduler | 629 |
| `INFO` | 3.235 |
| `WARNING` | 473 |
| `ERROR` | 567 |
| sem severidade explícita | 725 |
| `jsonPayload` | 2.300 |
| `textPayload` | 917 |
| com trace | 1.897 |
| com span | 2.391 |
| com `httpRequest` | 3.770 |
| eventos no novo `SystemErrorEvent` | 0 |

O zero do novo schema é esperado: o código local ainda não foi implantado.

No recorte específico do App Hosting, limitado a 5.000 entradas, 4.332 tinham trace, span e `httpRequest`. A revisão mais recente respondeu por 4.350 entradas. No recorte de Functions, 2.686 de 4.936 entradas amostradas tinham label de execução e 2.294 tinham trace.

Entre erros de Functions, uma amostra limitada a 5.000 entradas do Cloud Run encontrou 2.352 erros distribuídos por seis serviços. `interstatementsync` concentrou 1.924; essa contagem caracteriza volume e não confirma causa ou severidade de negócio.

## Error Reporting

A consulta com janela de 30 dias retornou:

- 11 grupos;
- 2.163 ocorrências agregadas;
- contagem, first seen, last seen, serviço e revisão por grupo;
- grupos tanto do App Hosting quanto de Functions.

Os campos `firstSeenTime` e `lastSeenTime` descrevem o ciclo de vida observado do grupo e podem ultrapassar a janela usada para calcular a contagem.

O maior grupo tinha 1.176 ocorrências e afetava seis Functions; o segundo tinha 931 ocorrências e afetava uma Function de sincronização. Não foi feita leitura nem classificação automática das mensagens representativas nesta auditoria.

### Compatibilidade do novo evento

O `StructuredConsoleSink` local produz JSON estável e adequado à pesquisa por `eventId`, `requestId` e `fingerprint`. Depois da decisão de manter Google como central, o sink foi adaptado para emitir também `ReportedErrorEvent`, `eventTime`, `serviceContext`, severidade reconhecida e `message` com stack sanitizada quando disponível.

A documentação oficial do Google exige uma destas formas para captura determinística:

- stack em `message`, `stack_trace` ou `exception`; ou
- payload no formato `google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent`, com `@type` explícito quando a mensagem não contém stack.

O schema interno continua usando `messageSanitized` e `stackSanitized`; a tradução ocorre somente no sink. O fingerprint do Coala continua sendo a identidade interna pesquisável e usada pela triagem. Não há suposição de que ele controle o grouping nativo do Error Reporting.

Não foi criada dependência, client library nem `GoogleCloudSink`. Essa abstração só será considerada se o smoke test demonstrar que stdout JSON não satisfaz o contrato operacional.

Referências oficiais:

- <https://cloud.google.com/error-reporting/docs/formatting-error-messages>
- <https://cloud.google.com/logging/docs/structured-logging>

## Retenção e acesso

| Bucket | Região | Retenção | Estado |
|---|---|---:|---|
| `_Default` | global | 30 dias | ativo, não bloqueado |
| `_Required` | global | 400 dias | ativo, bloqueado |

Não foram encontrados papéis dedicados de viewer/admin para Logging, Error Reporting ou Monitoring. O acesso observado deriva de um owner e um editor no projeto. Isso funciona, mas concede escopo maior que o necessário; uma revisão futura deve considerar least privilege sem remover acessos existentes de forma automática.

## Privacidade

Uma varredura por padrões em amostra de 5.000 entradas não encontrou ocorrência de header de autorização/cookie, Bearer token, e-mail, CPF, CNPJ, chave sensível, Pix ou remuneração. O resultado é um sinal de triagem e não prova ausência em todo o histórico.

O sanitizador local continua obrigatório antes do sink, porque filtros posteriores no Logging não impedem a ingestão inicial do dado.

## Incidente de configuração de segredos — mitigado

Na auditoria inicial, as 34 Functions possuíam quatro parâmetros sensíveis do serviço de PDV configurados como variáveis de ambiente em texto simples, inclusive em funções que não aparentavam precisar dessa integração. Nenhum valor foi preservado neste relatório.

Classificação:

- classe: `SECURITY_INCIDENT`;
- severidade inicialmente proposta: `critical` enquanto a configuração ampla permanecesse ativa;
- fatos confirmados: presença em texto simples e distribuição para 34 serviços;
- não confirmado: uso indevido, acesso por terceiro ou vazamento em logs.

Em 27/08/2026, após correção executada pelo usuário, uma nova consulta somente leitura confirmou:

- 34 Functions inspecionadas;
- zero Function com qualquer uma das quatro chaves PDV em `environmentVariables` comum;
- somente `hourlyPdvSync` e `syncGoalsForRange` com os quatro vínculos em `secretEnvironmentVariables`;
- zero leitura de valor de secret durante a verificação.

O armazenamento e a distribuição excessivos foram mitigados. A rotação ou invalidação da credencial anterior não foi verificada e, portanto, não é afirmada como concluída.

## Volume e custo

A métrica mensal consultada em 26/08/2026 retornou:

- `monthly_bytes_ingested`: 239.358.360 bytes, aproximadamente `0,223 GiB`;
- `log_bucket_monthly_bytes_ingested`: 239.535.412 bytes, aproximadamente `0,223 GiB`;
- projeção linear simples para o mês completo: aproximadamente `0,27 GiB`.

Pela tabela vigente do Google Cloud Logging, os primeiros `50 GiB` por projeto por mês não têm cobrança de ingestão. Acima disso, a referência é `US$ 0,50/GiB`. A retenção acima de 30 dias custa `US$ 0,01/GiB/mês`; o bucket `_Required` tem tratamento próprio e retenção obrigatória sem cobrança de retenção.

Estimativa atual de Logging: `US$ 0/mês`.

Mesmo que o volume aumentasse dez vezes depois da captura de navegador, a projeção aproximada de `2,7 GiB/mês` continuaria abaixo da franquia. Isso é cenário, não garantia. O volume deve ser medido novamente entre 7 e 30 dias após rollout.

Referência oficial: <https://cloud.google.com/logging/pricing>.

O cálculo não inclui custos normais de execução do App Hosting, Cloud Run ou Functions. Cada evento de navegador cria uma requisição autenticada adicional; a implementação não adiciona leitura ou escrita no Firestore.

## Configurações remotas recomendadas, não aplicadas

1. Manter Google Cloud Logging + Error Reporting como central inicial, conforme decisão de 26/08/2026.
2. Validar `StructuredConsoleSink` no runtime antes de considerar qualquer adapter ou client library específico do Google.
3. Criar políticas de alerta somente para falha terminal `high`/`critical`, incidentes financeiros, segurança, integridade de dados e regressão.
4. Criar ao menos um canal operacional de notificação depois de definir responsável e SLA.
5. Manter `_Default` em 30 dias neste início; não há justificativa de custo/negócio para aumentar retenção agora.
6. Medir volume, agrupamento, PII e custo depois do rollout antes de considerar outro fornecedor.
7. Manter teste e auditoria de metadados para impedir que secrets do PDV voltem a ser distribuídos às Functions não consumidoras.

## Limitações

- A consulta de logs foi amostral e limitada; ela não representa uma leitura exaustiva de todos os eventos.
- Nenhum evento do novo schema foi observado porque não houve rollout.
- Não foi executado smoke test no domínio real.
- Alertas e canais ainda não existem.
- A triagem local ainda não consulta automaticamente os grupos do Error Reporting; ela aceita export JSON/JSONL.
- A IA não alterou IAM, retenção, secret, alerta, workflow remoto, deploy ou rollout. A correção de secrets informada pelo usuário foi confirmada somente por metadados.
