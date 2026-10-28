# Monitoração REP no ambiente publicado

Conferência em 27/10/2026, projeto `smart-converter-752gf`. Estado observado por comandos somente leitura, sem implantação ou criação de incidente.

| Item | Evidência observada | Estado |
| --- | --- | --- |
| Sonda HTTPS do coletor | `GET https://op.coalashakes.com/api/dp/time-recording/availability` retornou `200`, corpo `{"status":"ok"}` | Disponível na consulta realizada |
| Relay `repPAvailabilityAlertRelay` | `gcloud functions describe ... --gen2 --region=southamerica-east1` retornou 404; listagem v2 pelo nome não retornou função | Não localizado |
| Uptime check específico REP | `gcloud monitoring uptime list-configs` retornou somente o check de `/login` | Ausente na listagem |
| Alert policy REP | `gcloud monitoring policies list --filter='displayName:REP'` retornou lista vazia | Ausente na seleção |
| Rota do relay sem credencial | `POST` com corpo vazio retornou `401`; nenhuma credencial ou mensagem válida foi enviada | Recusa pública conferida |
| Tópico `rep-p-availability-alerts` | Existe com `messageRetentionDuration=604800s` | Retenção de sete dias |
| Assinatura do tópico | `gcloud pubsub subscriptions list --filter='topic:rep-p-availability-alerts'` retornou lista vazia | Sem consumidor localizado |

Não considerar `200` isolado como ensaio do monitor, do relay ou da recuperação. Nenhum evento 08/07 publicado foi comprovado nesta conferência. O nome de display de policy e condição é validado literalmente pela rota, conforme o payload documentado pelo Google.

## Configuração preparada

- [Uptime check](../../../config/rep-p-monitoring/uptime-check.json): HTTPS com validação de certificado, status 200 e conteúdo esperado, período de 60 segundos e três regiões selecionadas. A região USA pode gerar múltiplos verificadores; não confundir três regiões com exatamente três sondas.
- [Policy desabilitada](../../../config/rep-p-monitoring/alert-policy.template.json): falha em pelo menos dois verificadores, sustentada por 120 segundos; notificações de abertura e fechamento. Substituir os dois marcadores pelo ID do check e resource name do canal Pub/Sub existente; não enviar o arquivo com marcadores à API. A policy começa desabilitada para permitir conferência antes do ensaio.
- O segredo dedicado ainda não existe no projeto: a tentativa de rollout de 28/10/2026 falhou ao resolver `REP_P_AVAILABILITY_MONITOR_SECRET`. A referência foi removida do `apphosting.yaml`; criar a versão pelo mecanismo oficial e conceder acesso ao runtime são pré-requisitos para publicar o relay. O valor nunca deve ser lido, copiado ou colocado em arquivo local.
- A Function já existente no código recebe somente o tópico dedicado, valida tamanho, entrega à rota autenticada e lança erro em falha HTTP para permitir redelivery. Não acessar banco fiscal pelo relay.

Esses arquivos são configuração proposta, não recursos criados. Criação de check/policy, deploy do relay e implantação do App Hosting são operações reais de publicação. O `AGENTS.md` requer autorização própria para publicação; a conferência e a preparação não a substituem. Não alterar IAM nem criar chaves para contornar falha de permissão.

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
