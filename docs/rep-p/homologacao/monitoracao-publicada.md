# Monitoração REP no ambiente publicado

Conferência inicial em 27/10/2026; reconciliação publicada em 28/10/2026 no projeto `smart-converter-752gf`. A coleta fiscal permanece desligada durante o ensaio.

| Item | Evidência observada | Estado |
| --- | --- | --- |
| Sonda HTTPS do coletor | `GET https://op.coalashakes.com/api/dp/time-recording/availability` retornou `200`, corpo `{"status":"ok"}` | Disponível na consulta realizada |
| Relay `repPAvailabilityAlertRelay` | Função Gen 2 ativa em `southamerica-east1`, com retry e segredo dedicado, ligada ao tópico `rep-p-availability-alerts` | Publicado |
| Uptime check específico REP | `coala-rep-p-sonda-do-coletor-dvUG2UbsBbU`, HTTPS, 200 + `status:ok`, cinco verificadores | Publicado |
| Alert policy REP | `Coala REP-P — disponibilidade externa`, condição de 120 s e canal Pub/Sub dedicado | Criada desabilitada; habilitar para o ensaio |
| Rota do relay sem credencial | `POST` com corpo vazio retornou `401`; nenhuma credencial ou mensagem válida foi enviada | Recusa pública conferida |
| Tópico `rep-p-availability-alerts` | Existe com `messageRetentionDuration=604800s` | Retenção de sete dias |
| Assinatura do tópico | Assinatura Eventarc criada pelo gatilho da função, retry habilitado e retenção de 24 h | Publicada |

Não considerar `200` isolado como ensaio do monitor, do relay ou da recuperação. Nenhum evento 08/07 publicado foi comprovado nesta conferência. O nome de display de policy e condição é validado literalmente pela rota, conforme o payload documentado pelo Google.

## Configuração publicada

- [Uptime check](../../../config/rep-p-monitoring/uptime-check.json): HTTPS com validação de certificado, status 200 e conteúdo esperado, período de 60 segundos e cinco verificadores selecionados (South America, Europe e três localidades dos EUA).
- [Template da policy](../../../config/rep-p-monitoring/alert-policy.template.json): falha em pelo menos dois verificadores, sustentada por 120 segundos; notificações de abertura e fechamento. A policy materializada foi criada desabilitada para permitir conferência antes do ensaio.
- O segredo dedicado `REP_P_AVAILABILITY_MONITOR_SECRET` possui versão ativa e acesso somente aos runtimes necessários; seu valor nunca deve ser lido, copiado ou colocado em arquivo local.
- A Function recebe somente o tópico dedicado, valida tamanho, entrega à rota autenticada e lança erro em falha HTTP para permitir redelivery. Não acessa o banco fiscal pelo relay.

Os recursos acima já foram publicados; a policy permanece desabilitada até o início da janela de ensaio. Não alterar IAM nem criar chaves para contornar falha de permissão.

## Sequência concreta para publicação e ensaio

1. Concluir a revisão da candidata e CI após commit/push autorizados; manter `REP_P_MARKING_ENABLED=false` e `DP_JOURNEY_LOCATION_ENABLED=false`. Conferir o runtime publicado, não somente o YAML local. Não ativar ponto oficial para testar eventos.
2. Publicar a vinculação do segredo no App Hosting e somente a Function `repPAvailabilityAlertRelay` conforme o fluxo do projeto. Conferir estado ativo, tópico, URL de destino, retry e identidade sem ler o valor do segredo. Conferir subscription, retenção de sete dias, retry e métricas de backlog/idade da mensagem mais antiga.
3. Criar ou reconciliar o check pela configuração preparada, usando os nomes existentes para impedir duplicação. Resolver o ID do check e o resource name do canal Pub/Sub do tópico; conferir a permissão de publicação do serviço de Monitoring, sem ampliá-la para outros tópicos.
4. Materializar a policy substituindo marcadores; conferir os nomes idênticos aos de `apphosting.yaml`, check correto, dois verificadores, duração e os dois prompts. Criar desabilitada e habilitar somente no início da janela de ensaio registrada.
5. **Transporte autenticado com gate fiscal fechado:** publicar um payload sintético de abertura e fechamento no tópico pelo comando oficial `gcloud pubsub topics publish`, com um mesmo `incident_id` de ensaio e `policy_name`/`condition_name` exatos. Conferir logs do relay e resposta `official-collection-disabled` nos dois casos; repetir entrega para comprovar idempotência do transporte. Conferir que não há novos eventos/NSR na ARP. Guardar somente IDs, horários, estados e contagens, sem segredos.
6. **Monitor completo sem derrubar o coletor:** registrar e salvar a configuração atual do check; durante janela controlada e com flag fiscal comprovadamente falsa, fazer o check esperar temporariamente um conteúdo impossível de corresponder. Isso cria falha exclusiva da sonda, não queda do aplicativo. Aguardar o tempo da condição e a entrega real da abertura. Restaurar a configuração original imediatamente, inclusive se ocorrer erro, e acompanhar fechamento e backlog zerado. O ensaio precisa registrar que foi uma falha induzida da sonda; não apresentá-lo como falha real do coletor.
7. **Retenção/reentrega:** em canário isolado, com o mesmo código do relay e destino controlado que responda 503 e depois 200, comprovar falha, mensagem pendente, retomada e confirmação. Não revogar segredo, alterar IAM ou derrubar endpoint compartilhado para simular falha. Este canário requer implantação própria; testes emulados não comprovam retenção real.
8. **Indisponibilidade verdadeira do coletor:** comprovar em staging/canário publicado isolado o comportamento com dependência indisponível e sua recuperação. Não afirmar que o passo 6 substitui esse cenário. Uma falha planejada em produção exige janela e autorização expressas adicionais.

Critérios de encerramento: IDs do check/policy/channel/subscription e da revisão do relay/runtime; confirmação das flags; configuração restaurada; logs correlacionados de abertura/fechamento e redelivery; ausência de NSR de ensaio; backlog/idade normalizados; nenhuma credencial exposta. Se qualquer item faltar, o ensaio continua pendente.

## Custo e limites

Sonda a cada minuto: cada verificador faz 1.440 chamadas/dia e 43.200/mês de 30 dias. A seleção planejada representa cinco verificadores (três em USA, um em EUROPE e um em SOUTH_AMERICA), ou 216.000 chamadas/mês. A sonda faz leitura limitada no banco e consulta nova à Hora Legal; multiplicar pelo número real de verificadores antes de habilitar. Os eventos Pub/Sub dependem de incidentes/reentregas, não de cada sonda. Não há polling de coleções completas. Valores monetários e cotas devem ser conferidos no projeto antes da ativação.

Fontes: [Google sobre uptime checks](https://docs.cloud.google.com/monitoring/uptime-checks), [policy para falha de uptime](https://docs.cloud.google.com/monitoring/alerts/policies-in-json), [payload e notificações Pub/Sub](https://docs.cloud.google.com/monitoring/support/notification-options). Consultadas em 27/10/2026.
