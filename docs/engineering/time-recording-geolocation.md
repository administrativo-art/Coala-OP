# Especificação técnica do georreferenciamento no registro de ponto

- **Estado:** proposta para implementação; nenhuma coleta de localização está ativa.
- **Escopo:** Coala One web e, em etapa posterior, Coala Go.
- **Fluxo relacionado:** [Registro de ponto REP-P](flows/dp-time-recording.md).
- **Última revisão técnica:** 19/10/2026.

## Objetivo e decisão principal

O registro de ponto poderá coletar uma posição somente no evento em que o trabalhador abre a confirmação da batida. O servidor comparará essa posição com áreas configuradas para a unidade de execução e produzirá uma evidência classificada como `inside`, `outside` ou `indeterminate`.

A localização não impedirá a marcação. Posição externa, baixa precisão, permissão negada, indisponibilidade do sensor ou cliente antigo devem preservar a batida original e gerar, quando configurado, uma ocorrência para conferência. Essa separação protege o registro fiel previsto para o REP-P e evita transformar falhas de GPS ou de permissão em ausência de ponto.

A evidência geográfica será persistida fora da ARP fiscal. Ela não integrará o registro tipo 7, seu hash, o AFD ou o comprovante PDF. A separação permite aplicar acesso e retenção próprios ao dado de localização sem alterar ou apagar a marcação original.

## Escopo funcional

### Incluído

- política versionada de localização por unidade de execução;
- uma ou mais áreas circulares por política, com centro e raio;
- captura pontual no navegador durante a confirmação da batida;
- validação e cálculo de distância no servidor;
- persistência atômica da referência da marcação e da evidência no banco `coala-rh`;
- replay idempotente da mesma tentativa sem recapturar a posição;
- classificação conservadora que considera a precisão informada pelo aparelho;
- ocorrência separada para os resultados que exigirem conferência;
- consulta da própria evidência pelo trabalhador;
- consulta administrativa com permissão, escopo de unidade e auditoria;
- métricas agregadas sem coordenadas;
- feature flag global e ativação explícita por unidade.

### Fora do primeiro incremento

- rastreamento contínuo, em segundo plano ou fora da ação de bater ponto;
- bloqueio da batida por localização;
- advertência, desconto, falta, ajuste de jornada ou decisão disciplinar automática;
- biometria, fotografia, reconhecimento facial ou coleta de redes Wi-Fi próximas;
- uso de endereço IP como substituto da posição;
- geocodificação reversa de cada batida;
- inclusão de coordenadas no AFD, AEJ, comprovante, e-mail, push ou aviso do sistema;
- promessa de prevenção de fraude: a posição informada pelo cliente pode ser simulada;
- modo off-line; a contingência móvel continua em projeto separado.

## Regras de produto

1. A hora oficial e o instante fiscal continuam sendo definidos pelo servidor. `capturedAt` informa somente quando o cliente declarou ter obtido a posição.
2. O trabalhador escolhe a unidade de execução pelos critérios atuais. A localização não troca a unidade automaticamente.
3. O cliente nunca decide se está dentro da área. Ele envia a captura; o servidor resolve a política e calcula o resultado.
4. Uma tentativa reutiliza exatamente o mesmo payload de localização até receber resposta conclusiva. Nova captura exige novo `attemptId`.
5. Ausência de localização não altera `canRecord`. O botão pode aguardar a captura até o timeout, mas deve então permitir a marcação com resultado inconclusivo.
6. Resultado externo ou inconclusivo não altera a ARP e não cria entrada, saída, falta ou ajuste no PTRP.
7. Alterações de política não reinterpretam automaticamente evidências antigas. Cada evidência guarda a revisão aplicada.
8. Um cliente anterior ao novo contrato continua conseguindo marcar. O servidor registra `not_provided` quando uma política ativa esperava uma tentativa de captura.
9. Coordenadas exatas não aparecem em listas, logs, métricas ou mensagens. Elas são carregadas somente no detalhe autorizado.
10. A ativação em pessoas reais depende das decisões de privacidade e jurídicas listadas nesta especificação.

## Arquitetura proposta

```text
Configuração de Tempo
  PATCH política da unidade
            │
            ▼
dp_timeLocationPolicyHeads ──► dp_timeLocationPolicies imutáveis
            │
            │ política ativa, sem expor centro/raio ao coletor
            ▼
GET options ──► confirmação da batida ──► captura pontual no aparelho
                                                │
                                                ▼
                                  POST /time-recording/markings
                                                │
                         identidade + vínculo + HLB + política vigente
                                                │
                                                ▼
                     transação no coala-rh: ARP original + tentativa
                        + dp_timeLocationEvidence + revisão opcional
                                                │
                     ┌──────────────────────────┴─────────────────────┐
                     ▼                                                ▼
             comprovante e AFD                              conferência do DP
             sem localização                           sem modificar a marcação
```

As políticas e as evidências ficam no `coala-rh`, que já recebe a transação do REP-P. Assim a política pode ser lida na mesma transação da marcação, sem uma janela entre bancos. O cadastro geral da unidade em `dp_units`, no banco principal, continua sendo a fonte de identidade, nome, endereço e fuso; não receberá coordenadas da política.

## Modelo de política

### Cabeçalho ativo

Coleção proposta: `dp_timeLocationPolicyHeads`.

```ts
type TimeLocationPolicyHead = {
  schemaVersion: 1;
  workspaceId: string;
  unitId: string;
  revision: number;
  policyId: string;
  updatedAt: Timestamp;
  updatedBy: string;
};
```

O ID deve ser determinístico a partir de `workspaceId` e `unitId`, sem aceitar um ID fornecido pelo cliente. O documento aponta somente para uma revisão já criada.

### Revisão imutável

Coleção proposta: `dp_timeLocationPolicies`.

```ts
type TimeLocationPolicy = {
  schemaVersion: 1;
  workspaceId: string;
  unitId: string;
  policyId: string;
  revision: number;
  status: "active" | "disabled";
  captureMode: "off" | "event";
  evaluationMode: "none" | "observe" | "review";
  zones: Array<{
    zoneId: string;
    label: string;
    latitudeE7: number;
    longitudeE7: number;
    radiusMeters: number;
  }>;
  maximumAccuracyMeters: number;
  maximumAgeSeconds: number;
  contentDigest: string;
  createdAt: Timestamp;
  createdBy: string;
};
```

Regras de validação propostas:

- no máximo cinco áreas por unidade;
- rótulo entre 1 e 80 caracteres;
- latitude inteira entre `-900000000` e `900000000`;
- longitude inteira entre `-1800000000` e `1800000000`;
- raio inteiro entre 20 e 2.000 metros;
- precisão máxima inteira entre 10 e 2.000 metros;
- idade máxima entre 10 e 300 segundos;
- `zones` obrigatório quando `evaluationMode` for `observe` ou `review`;
- revisão monotônica, criação imutável e atualização atômica do cabeçalho;
- `contentDigest` calculado pelo servidor sobre o conteúdo normalizado.

`latitudeE7` e `longitudeE7` evitam diferenças de serialização em números decimais. A interface converte graus decimais para inteiros multiplicados por dez milhões antes de apresentar a prévia, mas o servidor repete a normalização e a validação.

### Parâmetros iniciais para o piloto

Os valores abaixo são pontos de partida técnicos, não regras globais:

| Parâmetro | Valor inicial | Ajuste esperado |
| --- | ---: | --- |
| Raio | 100 m | Definido por unidade após medição no local |
| Precisão máxima | 100 m | Pode ser maior em shopping ou área coberta |
| Idade máxima | 60 s | Deve cobrir o tempo normal da confirmação |
| Timeout do navegador | 10 s | Após o timeout, a batida continua |
| Áreas por unidade | 1 | Ampliar apenas para locais fisicamente separados |

O piloto deve medir a distribuição real de `accuracyMeters` antes de reduzir raios. Um raio uniforme para todas as unidades não deve ser ativado sem essa medição.

## Contrato de captura

O corpo estrito de `POST /api/dp/time-recording/markings` passará a aceitar `locationAttempt`. O campo começa opcional para compatibilidade com clientes anteriores.

```ts
type LocationAttempt =
  | {
      schemaVersion: 1;
      source: "browser" | "android";
      status: "captured";
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: string;
    }
  | {
      schemaVersion: 1;
      source: "browser" | "android";
      status:
        | "permission_denied"
        | "position_unavailable"
        | "timeout"
        | "unsupported";
    };
```

Validação mínima do servidor:

- objeto estrito, sem campos desconhecidos;
- números finitos e dentro das faixas geográficas;
- precisão finita, positiva e limitada a 5.000 metros no transporte;
- `capturedAt` em ISO 8601 válido, sem mais de 30 segundos no futuro;
- coordenadas presentes somente em `captured`;
- combinação `channel=browser` com `source=browser` e `channel=mobile` com `source=android`;
- limite explícito de tamanho do JSON;
- normalização de coordenadas para E7 antes de persistir.

O status de falha é uma declaração do cliente e deve ser armazenado como tal. O servidor não consegue provar que o usuário negou a permissão nem que o sensor estava indisponível.

### Resposta da marcação

```ts
type LocationEvaluationSummary = {
  evidenceId: string | null;
  captureStatus:
    | "captured"
    | "permission_denied"
    | "position_unavailable"
    | "timeout"
    | "unsupported"
    | "not_provided";
  evaluation: "inside" | "outside" | "indeterminate" | "not_configured";
  reason:
    | "within_zone"
    | "outside_all_zones"
    | "accuracy_overlap"
    | "low_accuracy"
    | "stale_capture"
    | "capture_failed"
    | "client_without_location"
    | "policy_invalid"
    | "policy_disabled";
  reviewCreated: boolean;
};
```

A resposta não devolve centro, raio, coordenadas ou detalhes de outras pessoas. Em replay, o serviço lê a evidência determinística já gravada e devolve o mesmo resumo.

## Avaliação geográfica

O servidor calcula a distância de Haversine entre a captura e cada centro configurado. A zona mais próxima orienta a avaliação, mas a precisão declarada pelo aparelho participa da decisão:

```text
inside        quando distância + precisão <= raio
outside       quando distância - precisão > raio
indeterminate nos demais casos
```

Antes da fórmula:

- captura ausente ou falha resulta em `indeterminate`;
- captura mais antiga que `maximumAgeSeconds` resulta em `indeterminate`;
- precisão superior a `maximumAccuracyMeters` resulta em `indeterminate`;
- política desligada resulta em `not_configured` e não deve solicitar localização;
- nenhuma área válida resulta em `indeterminate` com `policy_invalid`, abre alerta operacional e não impede a batida.

Essa classificação evita declarar que uma pessoa está fora quando o círculo de incerteza do aparelho ainda alcança a área permitida. O valor de `accuracyMeters` também é informado pelo cliente e não constitui atestação independente.

## Evidência persistida

Coleção proposta: `dp_timeLocationEvidence`. O documento usa o mesmo ID determinístico do evento REP-P, mas não faz parte da ARP.

```ts
type TimeLocationEvidence = {
  schemaVersion: 1;
  evidenceId: string;
  workspaceId: string;
  employeeId: string;
  markingId: string;
  establishmentId: string;
  executionUnitId: string;
  recordedDate: string;
  markedAt: string;
  source: "browser" | "android";
  captureStatus:
    | "captured"
    | "permission_denied"
    | "position_unavailable"
    | "timeout"
    | "unsupported"
    | "not_provided";
  coordinates: null | {
    latitudeE7: number;
    longitudeE7: number;
    accuracyMeters: number;
    capturedAtClient: string;
  };
  receivedAtServer: Timestamp;
  policySnapshot: null | {
    policyId: string;
    revision: number;
    contentDigest: string;
    evaluationMode: "none" | "observe" | "review";
    maximumAccuracyMeters: number;
    maximumAgeSeconds: number;
    zones: Array<{
      zoneId: string;
      label: string;
      latitudeE7: number;
      longitudeE7: number;
      radiusMeters: number;
    }>;
  };
  result: {
    evaluation: "inside" | "outside" | "indeterminate" | "not_configured";
    reason: string;
    nearestZoneId: string | null;
    distanceMeters: number | null;
  };
  trust: {
    level: "client_reported";
    appAttestationId: string | null;
  };
  evidenceDigest: string;
  createdAt: Timestamp;
  retentionClass: "time_location_evidence";
};
```

`evidenceDigest` cobre o conteúdo normalizado, o `markingId` e a revisão da política. Ele detecta alteração acidental ou indevida, mas não transforma a posição do cliente em localização certificada.

A transação de marcação cria, nesta ordem lógica, o evento fiscal, a tentativa idempotente, o comprovante pendente e a evidência. Todos são confirmados juntos. `repP_attempts` armazena apenas `evidenceId` e o digest do pedido, nunca uma segunda cópia das coordenadas.

### Separação da ARP

Não adicionar localização a `RepPMarkingCandidate`, `serializeRepPType7HashSource`, `RepPReceiptSnapshot` ou `RepPAfdEvent`. Os vetores existentes de hash, AFD e PDF devem continuar produzindo os mesmos bytes para as mesmas entradas fiscais.

A coleção de evidências precisa de regras `deny all` para clientes, mas não deve receber o prefixo reservado `repP_`: sua retenção poderá terminar antes da ARP. Exclusão por retenção exige serviço específico, auditoria e fence de litígio; não pode usar rotinas genéricas de limpeza.

## Conferência administrativa

Coleção proposta: `dp_timeLocationReviews`. Ela é uma projeção operacional, não parte da ARP nem da evidência original.

Uma revisão é criada na mesma transação quando:

- a política está em `review`; e
- o resultado é `outside` ou `indeterminate`.

```ts
type TimeLocationReview = {
  schemaVersion: 1;
  workspaceId: string;
  reviewId: string;
  evidenceId: string;
  markingId: string;
  employeeId: string;
  executionUnitId: string;
  recordedDate: string;
  evaluation: "outside" | "indeterminate";
  reason: string;
  status: "pending" | "acknowledged" | "dismissed" | "escalated";
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAt: Timestamp | null;
  createdAt: Timestamp;
};
```

A revisão pode mudar de estado, mas nunca modifica a evidência nem a marcação. `dismissed` significa somente que a ocorrência não exige outra ação naquele fluxo; não declara que a posição era verdadeira ou falsa. `escalated` encaminha análise humana e não cria punição automática.

## APIs e autorização

Todas as rotas novas ou alteradas devem usar `secureRoute`, schema estrito, erros sanitizados e auditoria autoritativa.

| Superfície proposta | Autorização | Resposta e efeitos |
| --- | --- | --- |
| `GET /api/dp/time-recording/options` | Próprio usuário | Acrescenta apenas `locationCapture: off|event`; não expõe áreas |
| `POST /api/dp/time-recording/markings` | Próprio usuário | Aceita captura, registra batida e evidência; nunca marca por terceiro |
| `GET /api/dp/time-recording/location-evidence/[evidenceId]` | Próprio titular | Devolve sua evidência e política aplicada, sem dados de terceiros |
| `GET /api/dp/time-location-policies/[unitId]` | `dp.settings.manageTime` e escopo global | Lê a política atual para configuração |
| `PATCH /api/dp/time-location-policies/[unitId]` | `dp.settings.manageTime` e escopo global | Cria revisão imutável e move o cabeçalho |
| `GET /api/dp/time-location-reviews` | Nova permissão `dp.timeRecording.reviewLocation` e unidade | Lista somente resumo, paginado e sem coordenadas |
| `GET /api/dp/time-location-reviews/[reviewId]` | Mesma permissão e unidade | Lê detalhe e registra acesso à coordenada |
| `PATCH /api/dp/time-location-reviews/[reviewId]` | Mesma permissão e unidade | Transição validada e auditada |

Gestão de unidade não deve conceder automaticamente leitura da localização de pessoas. A nova permissão separa manutenção cadastral de conferência de evidências. Administrador padrão continua sujeito a auditoria de acesso e ao escopo do workspace.

As consultas administrativas exigem `workspaceId`, conjunto de unidades autorizado, período máximo, paginação e limite. Nenhuma rota lista evidências sem filtro temporal. O detalhe deve gravar auditoria antes de devolver coordenadas exatas.

## Experiência no Coala One

### Confirmação da batida

Quando a política indicar captura por evento, abrir a confirmação inicia `navigator.geolocation.getCurrentPosition` com alta precisão, `maximumAge: 0` e timeout configurado. O estado deve ser visível:

- `Obtendo localização…`;
- `Localização pronta`;
- `Localização imprecisa — o ponto será registrado para conferência`;
- `Localização não permitida ou indisponível — o ponto será registrado`.

O botão de confirmar pode aguardar a captura em andamento, mas é liberado ao final do timeout ou de qualquer erro. Não deve existir um segundo botão que pareça autorizar tratamento de dados por consentimento. A tela apresenta aviso de privacidade e link para a política aplicável; a base legal deve ser definida fora da interface.

A captura começa na confirmação, não no carregamento do dashboard, na escolha da unidade nem em segundo plano. Fechar a janela descarta uma captura ainda não enviada.

### Depois da batida

O sucesso continua priorizando NSR e comprovante. Uma linha secundária apresenta o resultado:

- `Localização compatível com a unidade`;
- `Localização fora da área — ponto registrado para conferência`;
- `Não foi possível confirmar a localização — ponto registrado`.

Nunca usar textos como `ponto inválido`, `fraude detectada` ou `presença comprovada`.

### Configuração da unidade

A configuração fica em Tempo, ligada à unidade, e exige:

- estado desligado, observação ou conferência;
- centro por coordenadas e raio;
- precisão máxima e idade máxima;
- prévia da área;
- aviso de que reduzir o raio pode aumentar falsos alertas;
- histórico de revisões, autor e instante;
- confirmação explícita para ativar coleta em uma unidade.

O primeiro incremento pode aceitar latitude e longitude e oferecer `Usar minha localização`. Um mapa interativo é opcional e não deve bloquear a entrega. Se for adotado provedor externo, revisar contrato, chaves, telemetria, transferência e custo antes de habilitá-lo.

## Coala Go

O aplicativo Android usará o mesmo contrato e o canal `mobile`. A implementação posterior deve:

- solicitar permissão somente quando a pessoa abrir a confirmação;
- tratar permissão precisa, aproximada, negada temporariamente e negada permanentemente;
- preservar o payload da tentativa em armazenamento local até a resposta;
- enviar atestação já disponível do aplicativo como contexto separado;
- manter `trust.level=client_reported`, pois integridade do app não certifica a coordenada;
- não ativar serviço de localização em segundo plano;
- não implementar fila off-line dentro deste incremento.

Paridade web e Android significa mesma avaliação e mesma regra no servidor, não mensagens ou APIs de sensor idênticas.

## Privacidade e governança

Geolocalização vinculada ao trabalhador é dado pessoal. A implantação observará finalidade, adequação, necessidade, livre acesso, transparência, segurança e prestação de contas previstos na [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm). O [relatório do grupo de trabalho sobre proteção de dados no contexto laboral](https://www.gov.br/anpd/pt-br/cnpd-2/grupos-de-trabalho/gt1-relatorio-final-cnpd.pdf/@@display-file/file) recomenda coleta ligada ao evento de jornada em vez de rastreamento contínuo; o relatório é orientação técnica e não substitui norma, decisão da ANPD ou parecer jurídico.

Antes de qualquer piloto com pessoas reais:

1. definir controlador, operadores e base legal por escrito;
2. aprovar finalidade restrita a evidência da marcação e conferência de presença;
3. elaborar Relatório de Impacto à Proteção de Dados com riscos e salvaguardas;
4. publicar aviso com finalidade, campos, duração, compartilhamentos, responsáveis e direitos;
5. definir prazo de guarda da coordenada, da revisão e da auditoria;
6. definir suspensão de descarte por processo judicial, administrativo ou investigação formal;
7. estabelecer quem pode consultar coordenadas e por qual motivo;
8. conferir CCT, ACT e regras aplicáveis aos estabelecimentos e categorias do piloto;
9. validar com advogado que a regra não cria restrição indevida à marcação.

Não selecionar consentimento como base por conveniência técnica. A base deve ser decidida pelo controlador com apoio jurídico e do encarregado, considerando a relação de trabalho e alternativas menos invasivas.

### Retenção

O prazo permanece uma decisão obrigatória. Até sua aprovação:

- não configurar TTL;
- não copiar coordenadas para ARP, recibos, auditorias genéricas ou data warehouse;
- usar `retentionClass=time_location_evidence` para permitir política específica;
- manter a revisão operacional sem duplicar coordenadas;
- impedir deleção manual por UI;
- preparar descarte idempotente, auditado e suspenso por `legalHold`.

Ao descartar a evidência, a marcação fiscal e seu comprovante permanecem intactos. A revisão pode conservar somente classificação, motivo e decisão pelo período aprovado, sem latitude e longitude.

## Segurança e limites probatórios

| Risco | Controle exigido | Limite residual |
| --- | --- | --- |
| Coordenada simulada | Cálculo no servidor, autenticação, replay protegido e atestação mobile quando disponível | Navegador e aparelho continuam capazes de informar posição falsa |
| Reenvio com outra posição | `requestDigest` cobre `locationAttempt`; mesmo `attemptId` com conteúdo diferente retorna conflito | Novo `attemptId` representa nova tentativa válida |
| Política alterada durante a batida | Cabeçalho e revisão lidos na transação do `coala-rh`; snapshot e digest na evidência | A política não prova onde o aparelho realmente estava |
| GPS impreciso | Círculo de precisão e resultado `indeterminate` | `accuracyMeters` também é declarado pelo cliente |
| Acesso indevido | Coleções server-only, permissão específica, escopo de unidade e auditoria do detalhe | IAM do Admin SDK precisa de revisão operacional |
| Vazamento em logs | Proibir coordenadas em erro, log, métrica, tracing e analytics | Dumps e ferramentas administrativas exigem controle próprio |
| Uso disciplinar automatizado | Nenhum efeito de folha, PTRP ou RH; revisão humana separada | Processo humano ainda precisa de política e treinamento |
| Dependência de mapa | Nenhuma API de mapa no caminho da batida | Mapa opcional de configuração cria fornecedor adicional |

O sistema deve chamar o dado de `evidência informada pelo dispositivo`, nunca de prova absoluta de presença. A decisão humana deve poder considerar precisão, ambiente coberto, falha do sensor, atividade externa, unidade escolhida e demais fatos.

## Observabilidade

Métricas permitidas, sempre agregadas:

- tentativas com captura solicitada;
- distribuição por `captureStatus` e `evaluation`;
- latência da captura em faixas;
- precisão em faixas, sem coordenadas;
- quantidade de revisões abertas e tempo de resolução;
- erros de integridade de política;
- clientes sem suporte ao novo contrato.

Não usar latitude, longitude, endereço, `employeeId`, `markingId` ou `evidenceId` como label de métrica. Logs operacionais recebem apenas código do erro, workspace, unidade quando necessário e `eventId` sanitizado.

Códigos de erro propostos:

- `DP_TIME_LOCATION_INPUT_INVALID`;
- `DP_TIME_LOCATION_POLICY_INVALID`;
- `DP_TIME_LOCATION_POLICY_CONFLICT`;
- `DP_TIME_LOCATION_POLICY_NOT_FOUND`;
- `DP_TIME_LOCATION_REVIEW_FORBIDDEN`;
- `DP_TIME_LOCATION_REVIEW_NOT_FOUND`;
- `DP_TIME_LOCATION_REVIEW_TRANSITION_INVALID`;
- `DP_TIME_LOCATION_EVIDENCE_INCONSISTENT`.

Falha ao interpretar uma captura válida ou política inconsistente não deve ser escondida como `inside`; ela resulta em `indeterminate` com uma evidência mínima. Uma falha transacional do banco aborta toda a operação antes de consumir o NSR, como já ocorre no registrador. Falha posterior apenas na projeção de conferência exige reconciliação; a implementação preferencial cria a projeção na própria transação para evitar esse estado.

## Índices e custo

Índices previstos no `coala-rh`:

- política: leitura por ID determinístico, sem consulta composta;
- revisões: `workspaceId + status + recordedDate`;
- revisões por unidade: `workspaceId + executionUnitId + status + recordedDate`;
- evidência própria: ID determinístico; consultas administrativas usam a revisão e abrem o detalhe por ID.

No volume de referência de 50 pessoas, quatro batidas por dia e 26 dias, são cerca de 5.200 batidas mensais. A solução robusta acrescenta por batida até duas leituras de política e uma escrita de evidência; somente resultados sinalizados criam uma escrita de revisão. Com evidências entre 0,8 e 1,5 KiB, o crescimento esperado é de aproximadamente 4 a 8 MiB por mês, antes de índices, backups e PITR.

Não há cobrança de API para `navigator.geolocation` nem para Haversine local. Um mapa de configuração é opcional. Os custos do Firestore dependem da região, backups e banco elegível à franquia; devem ser medidos no projeto, conforme a [documentação oficial de cobrança](https://firebase.google.com/docs/firestore/pricing), sem transformar esta estimativa em orçamento garantido.

### Estimativa de esforço e investimento

Faixa inicial para planejamento, considerando a arquitetura e os testes desta especificação:

| Entrega | Esforço estimado |
| --- | ---: |
| Decisões, desenho de proteção de dados e preparação do piloto | 3–5 pessoa-dias |
| Domínio, política versionada, regras e índices | 6–9 pessoa-dias |
| Coleta web, transação REP-P e experiência de marcação | 5–8 pessoa-dias |
| Conferência, autorização, auditoria e direitos do titular | 8–12 pessoa-dias |
| Testes, observabilidade, homologação e piloto | 5–7 pessoa-dias |
| **MVP web até piloto** | **27–41 pessoa-dias** |
| Paridade posterior no Coala Go, incluindo aparelhos reais | **8–12 pessoa-dias adicionais** |

O investimento de desenvolvimento deve ser calculado por `pessoa-dias × custo diário efetivo da equipe`. Como simulação, e não proposta comercial, uma diária carregada entre R$ 1.200 e R$ 2.000 coloca o MVP web entre aproximadamente **R$ 32,4 mil e R$ 82 mil**; a etapa móvel acrescentaria **R$ 9,6 mil a R$ 24 mil**. Revisão jurídica/DPO, eventuais dispositivos de teste, suporte ao piloto e mapa de terceiro não estão incluídos.

O intervalo é deliberadamente amplo porque o custo muda principalmente com a tela administrativa de conferência, a integração com direitos do titular, a quantidade de unidades piloto e a necessidade de mapa. Uma versão apenas de observação, sem fila de revisão, pode ser entregue antes, mas não substitui os controles de privacidade e acesso necessários para produção.

## Plano de implementação

### Incremento 0 — decisões e proteção de dados

- responder às decisões bloqueantes desta especificação;
- concluir análise jurídica e RIPD;
- definir retenção, papéis e aviso de privacidade;
- confirmar que o piloto não usa geofence como bloqueio;
- registrar parâmetros de cada unidade piloto.

### Incremento 1 — domínio e política

- criar tipos, schemas e funções puras de normalização, Haversine e avaliação;
- implementar política versionada no `coala-rh`;
- criar rotas seguras de leitura e atualização;
- acrescentar regras deny-all e índices;
- implementar configuração sem mapa externo;
- manter feature flag desligada.

### Incremento 2 — coleta web e persistência

- ampliar `repPMarkingSchema` com `locationAttempt` opcional;
- capturar posição no hook compartilhado da tela e do botão rápido;
- preservar payload por `attemptId`;
- ler política e gravar evidência na transação REP-P;
- devolver resumo na resposta;
- apresentar feedback sem alterar comprovante ou histórico fiscal.

### Incremento 3 — conferência e direitos do titular

- criar projeção de revisão e máquina de estados;
- adicionar permissão e escopo de unidade;
- implementar lista paginada sem coordenadas e detalhe auditado;
- permitir consulta da própria evidência;
- integrar os pedidos de privacidade e o futuro descarte.

### Incremento 4 — piloto em observação

- usar somente unidades e pessoas formalmente aprovadas;
- iniciar em `observe`, sem fila operacional ou consequência;
- medir precisão, timeout, permissões negadas e falsos alertas;
- ajustar raios por unidade;
- executar teste de acesso, backup, restauração e retenção;
- obter revisão de Doc Brown antes de commit e antes do piloto.

### Incremento 5 — conferência e Coala Go

- promover unidades aprovadas para `review`;
- treinar revisores e acompanhar decisões;
- implementar paridade no Android;
- validar aparelho real, permissão aproximada e atestação;
- manter offline e rastreamento contínuo fora do escopo.

## Arquivos previstos

| Área | Arquivos existentes ou propostos |
| --- | --- |
| Domínio puro | novo `src/features/dp/rep-p/location.ts` |
| Políticas | novo `src/features/dp/rep-p/location-policy.server.ts` |
| Schemas | `src/features/dp/rep-p/schemas.ts` |
| Serviço REP-P | `src/features/dp/rep-p/service.server.ts` |
| Cliente compartilhado | `src/features/dp/rep-p/use-rep-p-marking.ts` |
| Confirmação web | `record-strip.tsx` e `quick-marking-button.tsx` |
| Configuração | componentes de Tempo e rota `api/dp/time-location-policies/[unitId]` |
| Conferência | novos serviço, rotas e componentes `time-location-reviews` |
| Tipos e permissões | `src/types/index.ts`, perfis e telas de permissão |
| Regras e índices | `firestore.rh.rules`, `firestore.rh.indexes.json` |
| Documentação | este arquivo, guia REP-P, privacidade e matriz de superfícies |
| Android | `apps/coala-one-android`, somente no incremento 5 |

Os nomes propostos podem ser ajustados para preservar convenções descobertas durante a implementação. A separação entre ARP, evidência e revisão é requisito arquitetural e não deve ser colapsada por conveniência.

## Estratégia de testes

### Testes puros

- coordenadas e limites válidos e inválidos;
- distância conhecida e estabilidade de arredondamento;
- dentro, fora, tangência e sobreposição pela precisão;
- múltiplas áreas e seleção da mais próxima;
- captura antiga, futura, imprecisa ou ausente;
- política desabilitada, corrompida e com revisão inconsistente;
- digest determinístico;
- transições permitidas da revisão.

### Serviço e emuladores

- evidência criada na mesma transação da batida;
- falha de evidência não consome NSR;
- replay devolve a mesma marcação e a mesma evidência;
- mesmo `attemptId` com outra coordenada retorna conflito;
- política trocada antes da transação usa a revisão atual;
- `outside` e `indeterminate` criam revisão somente em modo `review`;
- pessoa sem vínculo ou unidade continua recusada pelos controles atuais;
- nenhuma coordenada aparece em recibo, AFD, tentativa ou log;
- titular não acessa evidência de outra pessoa;
- revisor sem unidade ou permissão recebe resposta sanitizada;
- acesso ao detalhe administrativo gera auditoria.

### Contratos e regras

- contratos executáveis das rotas novas e alteradas;
- campos desconhecidos recusados;
- clientes não leem nem escrevem políticas, evidências ou revisões diretamente;
- Admin SDK fora do serviço oficial aparece no guard de referências;
- índices e inventário de superfícies atualizados.

### Interface

- permissão concedida, negada, indisponível e timeout com sensor simulado;
- confirmação não fica presa depois da falha;
- fechamento da janela descarta captura não enviada;
- retry mantém o payload;
- teclado, foco, leitores de tela e largura móvel;
- mensagens nunca declaram invalidade ou fraude;
- coleta não acontece ao carregar a página.

### Regressão fiscal

- vetores de hash tipo 7 inalterados;
- bytes do AFD inalterados para os mesmos eventos;
- bytes e assinatura do comprovante sem localização;
- NSR, hora oficial, vínculo, estabelecimento, fuso e unidade preservados;
- exportação e histórico continuam funcionando sem política de localização.

## Verificações de implementação

Executar, no mínimo:

```text
testes unitários novos de localização e contratos REP-P
testes de integração REP-P com Firestore Emulator
npm run check:security-contracts
npm run check:rules
python3 scripts/generate-surface-inventory.py --check
python3 scripts/check-flow-matrix.py
python3 scripts/generate-flow-entrypoints.py --check
python3 scripts/check-engineering-docs.py
npm run verify
```

A homologação exige ainda navegador real com permissão concedida/negada, aparelhos Android reais no incremento móvel e ensaio nas unidades piloto. Testes com coordenadas sintéticas não comprovam precisão física.

## Critérios de aceite

1. Nenhuma localização é coletada antes da confirmação nem depois da batida.
2. Toda tentativa produz marcação normal mesmo quando a localização está externa ou indisponível, desde que os demais requisitos do REP-P sejam satisfeitos.
3. Cliente não consegue declarar `inside`, distância, política ou unidade autorizada.
4. Reenvio do mesmo `attemptId` não duplica batida, evidência ou revisão.
5. ARP, AFD, hash e comprovante permanecem sem coordenadas e passam nos testes anteriores.
6. Evidência registra política, precisão, cálculo, confiança e digest aplicados no instante da transação.
7. Coordenadas exatas são server-only e cada leitura administrativa é autorizada, limitada por unidade e auditada.
8. Nenhum alerta geográfico gera efeito automático em PTRP, folha, escala, ausência ou disciplina.
9. Feature flag e política por unidade permitem desligamento sem migração ou perda da marcação.
10. Retenção, aviso, RIPD, base legal e responsáveis estão aprovados antes do primeiro piloto real.
11. Doc Brown não identifica requisito não conforme antes do commit da implementação.
12. O piloto mede precisão e falsos alertas antes de qualquer promoção para conferência.

## Decisões bloqueantes

| Decisão | Responsável | Necessária antes de |
| --- | --- | --- |
| Finalidade e base legal do tratamento | Controlador, encarregado e jurídico | Coleta com pessoas reais |
| Prazo de retenção e `legalHold` | Jurídico, DP e privacidade | Persistência em produção |
| Unidades e população do piloto | DP e operação | Ativação por unidade |
| Raio e precisão máxima por unidade | Operação, DP e desenvolvimento | Política `observe` |
| Quem pode conferir e quais motivos de decisão | DP e privacidade | Incremento 3 |
| Acesso do trabalhador às coordenadas e canal de contestação | DP, jurídico e privacidade | Piloto |
| Uso admissível da evidência em apuração humana | Jurídico e DP | Modo `review` |
| Necessidade de mapa externo | Produto e desenvolvimento | Configuração visual |
| Extensão ao Coala Go e atestação | Produto e desenvolvimento | Incremento 5 |

Pergunta preparada para o advogado: **a coleta pontual de geolocalização, sem bloquear a marcação e usada apenas como evidência para conferência humana, atende ao art. 74 da Portaria MTP nº 671/2021 e às regras aplicáveis às categorias e estabelecimentos do piloto? Quais base legal, transparência, prazo de guarda, acesso do trabalhador e limites de uso disciplinar devem constar da política?**

## Referências

- [Portaria MTP nº 671/2021 e fontes REP-P conferidas](../rep-p/referencias/README.md)
- [Plano REP-P, documentos e conformidade](../plano-rep-p-controle-de-ponto.md)
- [Plano de jornada e fechamento](../plano-jornada-fechamento-rh.md)
- [Fluxo implementado do registro de ponto](flows/dp-time-recording.md)
- [Acesso e privacidade](access-and-privacy.md)
- [Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Relatório do grupo de trabalho sobre proteção de dados no contexto laboral](https://www.gov.br/anpd/pt-br/cnpd-2/grupos-de-trabalho/gt1-relatorio-final-cnpd.pdf/@@display-file/file)
- [Cobrança do Cloud Firestore](https://firebase.google.com/docs/firestore/pricing)
