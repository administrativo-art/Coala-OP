# Especificação técnica do georreferenciamento no registro de ponto

- **Estado:** captura pontual e complemento Entre unidades implementados; ativação real pendente de documentos de privacidade, configuração por unidade/turno, consulta autorizada, teste físico e liberação do kill switch.
- **Escopo:** Coala One web e Coala Go, com a mesma avaliação no servidor.
- **Fluxo relacionado:** [Registro de ponto REP-P](flows/dp-time-recording.md).
- **Última revisão técnica:** 23/10/2026.

## Decisões aprovadas em 22/10/2026

- uma leitura somente quando a pessoa confirma cada batida; nunca em carregamento, segundo plano ou rastreamento contínuo;
- posição ausente, recusada, imprecisa ou externa não bloqueia, invalida, desconta nem pune automaticamente;
- localização é acessória: não há justificativa especial por batida nem fila disciplinar; os direitos gerais da LGPD continuam pelo canal da empresa;
- coordenada exata e evidência permanecem por 1.825 dias (cinco anos), com `expiresAt` e TTL do Firestore;
- acesso direto do cliente às políticas e evidências é negado; na candidata local, a consulta é pelo titular real ou por permissão expressa do DP/diretoria, escopada e auditada, sem concessão automática a administradores;
- política central por unidade contém a lista nominal do piloto. Ativar a unidade não coleta de outros colaboradores, e o servidor ignora coordenadas enviadas por cliente fora dessa lista;
- piloto inicial: Heucilene Ribeiro e Luis, depois de ambos constarem na lista da unidade e receberem o aviso/cláusula aplicável;
- cláusula LGPD nos documentos da empresa e aditivo para os colaboradores atuais; o aceite informa o tratamento, mas não é usado tecnicamente como consentimento revogável para validar a batida.

A implementação adotou as coleções `repP_locationPolicies` e `repP_locationEvidence` no banco dedicado `coala-rep-p`. Os modelos mais detalhados descritos abaixo registram a proposta original; quando divergirem, prevalecem estas decisões e o contrato implementado nos arquivos listados ao fim.

## Complemento Entre unidades — implementado e não ativado

A decisão de 22/10 continua valendo para a coleta pontual. Em 23/10 foi implementado um segundo modo, `workday`, exclusivamente para turnos cujo local de execução é **Entre unidades**. Em 24/10 o programador confirmou que a regra permanece configurada no próprio turno, sem automatismo adicional por cargo. O backend exige `DP_JOURNEY_LOCATION_ENABLED=true`, cujo padrão é falso, além da política nominal da unidade. O acompanhamento só é elegível quando o turno combina `executionUnitPolicy=free` com `locationTrackingPolicy=workday`.

Quando e somente quando todos os gates forem aprovados, o Android poderá manter um serviço em primeiro plano durante a jornada, com amostras periódicas no intervalo operacional definido. A pessoa recebe a explicação antes da permissão contextual; o aplicativo não pede localização ao abrir. O ciclo começa após a finalidade declarada `Início da jornada`, pausa em `Início do intervalo`, retoma em `Volta do intervalo` e encerra em `Fim da jornada`, por ação manual sempre disponível, por revogação da política ou por limite de segurança. Alterar uma classificação reconcilia o ciclo; uma sequência ambígua encerra a coleta. Esse é um efeito operacional, não fiscal, financeiro ou disciplinar.

O servidor é a autoridade da sessão: exige fuso brasileiro explícito na unidade, congela fuso, início e fim escalados, aceita chegada antecipada somente dentro da janela limitada de quatro horas, encerra a tolerância duas horas após o turno, rejeita amostras fora da janela, ordenação invertida, amostra sem início ou durante pausa e qualquer evento depois do encerramento. Cada lote revalida a política. Revogação ou kill switch devolvem instrução terminal: o Android interrompe sensores e indicador sem enfileirar outro evento e elimina os eventos posteriores daquela sessão. Sessões e eventos ficam separados em `dp_journeyLocationSessions` e `dp_journeyLocationEvents`, fora da ARP/PTRP, e só podem apoiar revisão humana.

Antes de mudar o gate para verdadeiro, concluir e publicar: cláusula LGPD e aditivo dos atuais; finalidade específica e base legal já decididas; frequência efetiva; retenção de cinco anos; aviso e transparência; acesso pelo titular; perfis de consulta e auditoria; eliminação e `legalHold`; canal de contestação; RIPD; configuração dos turnos reais; e ensaio em aparelho físico. Até isso ocorrer, telas e contratos podem demonstrar a opção, mas nenhuma coleta periódica real deve iniciar.

## Objetivo e decisão principal

O registro de ponto coleta uma posição somente no clique final que confirma a batida. O servidor compara essa posição com a área configurada para a unidade de execução e produz uma evidência classificada como `inside`, `outside` ou `indeterminate`.

A localização não impede a marcação. Posição externa, baixa precisão, permissão negada, indisponibilidade do sensor ou cliente antigo preservam a batida original e geram somente evidência separada. O piloto não possui fila de ocorrência nem consequência automática. Essa separação protege o registro fiel previsto para o REP-P e evita transformar falhas de GPS ou de permissão em ausência de ponto.

A evidência geográfica será persistida fora da ARP fiscal. Ela não integrará o registro tipo 7, seu hash, o AFD ou o comprovante PDF. A separação permite aplicar acesso e retenção próprios ao dado de localização sem alterar ou apagar a marcação original.

## Escopo funcional

### Incluído

- política versionada de localização por unidade de execução;
- uma área circular por política, com centro e raio;
- captura pontual no navegador durante a confirmação da batida;
- validação e cálculo de distância no servidor;
- política lida na transação da marcação no `coala-rep-p`; a evidência acessória é persistida depois do commit sem alterar ou bloquear a batida;
- replay idempotente da mesma tentativa sem recapturar a posição;
- classificação conservadora que considera a precisão informada pelo aparelho;
- lista nominal de participantes do piloto dentro da política da unidade;
- coleta equivalente no Android, sem permissão de localização em segundo plano;
- TTL de cinco anos para a evidência completa;
- feature flag global e ativação explícita por unidade.

### Fora do primeiro incremento pontual

- rastreamento contínuo, em segundo plano ou fora da ação de bater ponto; o complemento Entre unidades descrito acima pertence a uma rodada posterior e continua desativado;
- bloqueio da batida por localização;
- advertência, desconto, falta, ajuste de jornada ou decisão disciplinar automática;
- biometria, fotografia, reconhecimento facial ou coleta de redes Wi-Fi próximas;
- uso de endereço IP como substituto da posição;
- geocodificação reversa de cada batida;
- inclusão de coordenadas no AFD, AEJ, comprovante, e-mail, push ou aviso do sistema;
- promessa de prevenção de fraude: a posição informada pelo cliente pode ser simulada;
- coordenada no modo off-line: a fila atual assina a batida, não a posição; ao sincronizar, a evidência registra `unavailable` sem aceitar coordenada não vinculada à assinatura do aparelho.

## Regras de produto

1. A hora oficial e o instante fiscal continuam sendo definidos pelo servidor. `capturedAt` informa somente quando o cliente declarou ter obtido a posição.
2. O trabalhador escolhe a unidade de execução pelos critérios atuais. A localização não troca a unidade automaticamente.
3. O cliente nunca decide se está dentro da área. Ele envia a captura; o servidor resolve a política e calcula o resultado.
4. Uma tentativa reutiliza exatamente o mesmo payload de localização até receber resposta conclusiva. Nova captura exige novo `attemptId`.
5. Ausência de localização não altera `canRecord`. O botão pode aguardar a captura até o timeout, mas deve então permitir a marcação com resultado inconclusivo.
6. Resultado externo ou inconclusivo não altera a ARP e não cria entrada, saída, falta ou ajuste no PTRP.
7. Alterações de política não reinterpretam automaticamente evidências antigas. Cada evidência guarda a revisão aplicada.
8. Um cliente anterior ao novo contrato continua conseguindo marcar. O servidor registra `unavailable` quando uma política ativa esperava uma tentativa de captura.
9. Coordenadas exatas não aparecem em listas, logs, métricas ou mensagens. Elas são carregadas somente no detalhe autorizado.
10. A ativação em pessoas reais depende do aviso/cláusula, lista nominal do piloto, parâmetros da unidade e gates jurídicos documentados.
11. Uma política ausente ou corrompida desliga apenas a coleta; nunca derruba a batida.

## Arquitetura implementada localmente

```text
Configuração da unidade
  PUT política da unidade
            │
            ▼
repP_locationPolicies ──► subcoleções imutáveis de revisões e auditoria
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
                   transação no coala-rep-p: ARP original + tentativa
                                                │
                         commit soberano da batida│
                                                ▼
                    gravação acessória de repP_locationEvidence
                         (melhor esforço, nunca desfaz a batida)
                                                │
                                                ▼
                                  comprovante e AFD sem localização
```

As políticas e as evidências ficam no `coala-rep-p`, que recebe a transação oficial do REP-P. A política é lida na mesma transação da marcação, sem uma janela entre bancos; a evidência acessória é gravada depois do commit e uma falha nela nunca desfaz nem bloqueia o ponto. O cadastro geral da unidade em `dp_units`, no banco principal, continua sendo a fonte de identidade, nome, endereço e fuso; não receberá coordenadas da política.

## Modelo de política

O desenho inicial abaixo é histórico. A implementação consolidou cabeçalho e estado atual em `repP_locationPolicies/{hash(workspaceId, unitId)}` e grava cada versão nas subcoleções `revisions` e `audit`. O contrato executável está em `location-policy.server.ts`: uma área circular, modos `disabled|observe`, lista nominal de até 20 participantes, aviso HTTPS, referência jurídica e retenção fixa de 1.825 dias.

### Cabeçalho ativo — proposta histórica substituída

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

### Revisão imutável — proposta histórica substituída

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

O corpo estrito de `POST /api/dp/time-recording/markings` aceita `locationAttempt`. O campo é opcional para compatibilidade com clientes anteriores.

```ts
type LocationAttempt =
  | {
      captureId: string;
      status: "captured";
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: string;
      elapsedMs: number;
    }
  | {
      captureId: string;
      status: "denied" | "unavailable" | "timeout" | "unsupported" | "error";
      elapsedMs: number;
    };
```

Validação mínima do servidor:

- objeto estrito, sem campos desconhecidos;
- números finitos e dentro das faixas geográficas;
- precisão finita, positiva e limitada a 100.000 metros no transporte;
- `capturedAt` em ISO 8601 válido; a avaliação, no servidor, trata leitura com mais de 30 segundos no futuro como inconclusiva;
- coordenadas presentes somente em `captured`;
- `elapsedMs` entre zero e 60 segundos;
- marcação offline não aceita `locationAttempt`, pois a assinatura local ainda não cobre a coordenada.

O status de falha é uma declaração do cliente e deve ser armazenado como tal. O servidor não consegue provar que o usuário negou a permissão nem que o sensor estava indisponível.

### Resposta da marcação

```ts
type LocationEvaluationSummary = {
  captureStatus:
    | "captured"
    | "denied"
    | "unavailable"
    | "timeout"
    | "unsupported"
    | "error"
    | "not_requested";
  evaluation: "inside" | "outside" | "indeterminate" | "not_requested";
};
```

A resposta não devolve centro, raio, coordenadas ou detalhes de outras pessoas. Em replay, o serviço lê o resumo guardado em `repP_attempts` e devolve o mesmo resultado sem recapturar.

## Avaliação geográfica

O servidor calcula a distância de Haversine entre a captura e o centro configurado. A precisão declarada pelo aparelho participa da decisão:

```text
inside        quando distância + precisão <= raio
outside       quando distância - precisão > raio
indeterminate nos demais casos
```

Antes da fórmula:

- captura ausente ou falha resulta em `indeterminate`;
- captura mais antiga que `maximumAgeSeconds` resulta em `indeterminate`;
- precisão superior a `maximumAccuracyMeters` resulta em `indeterminate`;
- política desligada resulta em `not_requested` e não solicita localização;
- política ausente ou inválida é tratada como desligada e não impede a batida.

Essa classificação evita declarar que uma pessoa está fora quando o círculo de incerteza do aparelho ainda alcança a área permitida. O valor de `accuracyMeters` também é informado pelo cliente e não constitui atestação independente.

## Evidência persistida

Coleção implementada: `repP_locationEvidence`. O documento usa o mesmo ID determinístico do evento REP-P, mas não faz parte da ARP.

```ts
type TimeLocationEvidence = {
  schemaVersion: 1;
  evidenceId: string;
  workspaceId: string;
  employeeId: string;
  markingId: string;
  executionUnitId: string;
  recordedDate: string;
  recordedAt: Timestamp;
  channelTrust: "client_reported";
  policy: Omit<RepPLocationPolicySnapshot, "participantUserIds">;
  capture: {
    captureId: string | null;
    status: "captured" | "denied" | "unavailable" | "timeout" | "unsupported" | "error";
    elapsedMs: number;
    location: null | {
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: string;
    };
  };
  result: RepPLocationResult;
  digest: string;
  createdAt: Timestamp;
  retentionClass: "time_location_evidence";
  legalHold: false;
  expiresAt: Timestamp;
};
```

`digest` cobre captura, `markingId`, política e resultado. Ele detecta alteração acidental ou indevida, mas não transforma a posição do cliente em localização certificada.

A transação fiscal cria o evento original, a tentativa idempotente e o comprovante pendente. Depois do commit da batida, o servidor tenta gravar a evidência exata em documento separado e determinístico. Falha nessa escrita é registrada sem coordenadas nos logs e **não** desfaz nem impede a marcação. `repP_attempts` armazena somente o resumo `captureStatus/evaluation` e o digest do pedido, nunca uma segunda cópia das coordenadas. A cópia da política dentro da evidência omite `participantUserIds`, para não duplicar a lista das demais pessoas do piloto em cada batida.

### Separação da ARP

Não adicionar localização a `RepPMarkingCandidate`, `serializeRepPType7HashSource`, `RepPReceiptSnapshot` ou `RepPAfdEvent`. Os vetores existentes de hash, AFD e PDF devem continuar produzindo os mesmos bytes para as mesmas entradas fiscais.

A coleção `repP_locationEvidence` tem regras `deny all` para clientes e TTL próprio em `expiresAt`. O prefixo foi mantido para explicitar a origem no registro de ponto, sem tornar a evidência parte da ARP fiscal. A marcação, o comprovante e o AFD não recebem esse vencimento. Suspensão por litígio exige retirar/controlar `expiresAt` antes do descarte automático.

## Conferência administrativa

**Decisão atual:** não há fila de justificativa ou resolução por batida no piloto em observação. A coleção `repP_locationReviews` permanece reservada e negada ao cliente, mas não recebe documentos. A candidata local oferece consulta separada por pessoa/unidade/dia/fonte, com titular real ou permissão expressa `dp.timeRecording.readLocation`, paginação e auditoria antes de devolver coordenadas. A implantação permanece pendente; ver contrato no [guia REP](flows/dp-time-recording.md).

O modelo abaixo fica como proposta histórica para uma eventual fase de conferência e não descreve função ativa.

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

| Superfície | Autorização | Resposta e efeitos |
| --- | --- | --- |
| `GET /api/dp/time-recording/options` | Próprio usuário | Acrescenta apenas `locationCapture: off|event`; não expõe áreas |
| `POST /api/dp/time-recording/markings` | Próprio usuário | Aceita captura, registra batida e evidência; nunca marca por terceiro |
| `GET /api/dp/time-recording/location-policies/[unitId]` | `dp.settings.manageTime` e escopo da unidade | Lê a política atual para configuração |
| `PUT /api/dp/time-recording/location-policies/[unitId]` | `dp.settings.manageTime` e escopo da unidade | Cria revisão imutável da política |

A candidata local acrescenta `POST /api/dp/time-recording/location-access`, ainda não publicado. Gestão de unidade não concede automaticamente leitura da localização de pessoas. Titular usa sua identidade real; terceiros exigem concessão expressa `dp.timeRecording.readLocation`, escopo de unidade e auditoria antes da resposta, inclusive administradores.

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

- estado desligado ou observação;
- centro por coordenadas e raio;
- precisão máxima e idade máxima;
- prévia da área;
- aviso de que reduzir o raio pode aumentar falsos alertas;
- revisão, autor e instante persistidos no servidor;
- confirmação explícita para ativar coleta em uma unidade.

O primeiro incremento pode aceitar latitude e longitude e oferecer `Usar minha localização`. Um mapa interativo é opcional e não deve bloquear a entrega. Se for adotado provedor externo, revisar contrato, chaves, telemetria, transferência e custo antes de habilitá-lo.

## Coala Go

O aplicativo Android usa o mesmo contrato e o canal `mobile`. A implementação local:

- solicitar permissão somente quando a pessoa abrir a confirmação;
- tratar permissão precisa, aproximada, negada temporariamente e negada permanentemente;
- preservar o payload da tentativa em armazenamento local até a resposta;
- preserva a atestação já disponível do aplicativo como contexto separado;
- manter `trust.level=client_reported`, pois integridade do app não certifica a coordenada;
- não ativar serviço de localização em segundo plano;
- não associa coordenada à fila off-line enquanto a assinatura local não cobrir também esse dado.

Paridade web e Android significa mesma avaliação e mesma regra no servidor, não mensagens ou APIs de sensor idênticas.

## Privacidade e governança

Geolocalização vinculada ao trabalhador é dado pessoal. A implantação observará finalidade, adequação, necessidade, livre acesso, transparência, segurança e prestação de contas previstos na [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm). O [relatório do grupo de trabalho sobre proteção de dados no contexto laboral](https://www.gov.br/anpd/pt-br/cnpd-2/grupos-de-trabalho/gt1-relatorio-final-cnpd.pdf/@@display-file/file) recomenda coleta ligada ao evento de jornada em vez de rastreamento contínuo; o relatório é orientação técnica e não substitui norma, decisão da ANPD ou parecer jurídico.

Antes de qualquer piloto com pessoas reais:

1. definir controlador, operadores e base legal por escrito;
2. aprovar finalidade restrita a evidência da marcação e conferência de presença;
3. elaborar Relatório de Impacto à Proteção de Dados com riscos e salvaguardas;
4. publicar aviso com finalidade, campos, duração, compartilhamentos, responsáveis e direitos;
5. registrar o prazo aprovado de cinco anos para a coordenada e a evidência;
6. definir suspensão de descarte por processo judicial, administrativo ou investigação formal;
7. estabelecer quem pode consultar coordenadas e por qual motivo;
8. conferir CCT, ACT e regras aplicáveis aos estabelecimentos e categorias do piloto;
9. validar com advogado que a regra não cria restrição indevida à marcação.

Não selecionar consentimento como base por conveniência técnica. A base deve ser decidida pelo controlador com apoio jurídico e do encarregado, considerando a relação de trabalho e alternativas menos invasivas.

### Retenção

O prazo operacional definido pelo projeto é de 1.825 dias (cinco anos) para a evidência completa, inclusive a coordenada exata; a justificativa e a aprovação jurídica desse prazo para cada modalidade continuam pendentes no RIPD. Cada documento recebe `expiresAt` calculado a partir do instante da batida, e `firestore.rep.indexes.json` configura TTL na coleção `repP_locationEvidence`. A marcação fiscal e seu comprovante permanecem fora desse descarte. Coordenadas não são copiadas para eventos/recibos da ARP, AFD, AEJ, auditorias genéricas ou data warehouse. Suspensão futura por litígio exigirá remover/controlar o vencimento antes da data; não existe botão de deleção manual na interface.

## Segurança e limites probatórios

| Risco | Controle exigido | Limite residual |
| --- | --- | --- |
| Coordenada simulada | Cálculo no servidor, autenticação, replay protegido e atestação mobile quando disponível | Navegador e aparelho continuam capazes de informar posição falsa |
| Reenvio com outra posição | `requestDigest` cobre `locationAttempt`; mesmo `attemptId` com conteúdo diferente retorna conflito | Novo `attemptId` representa nova tentativa válida |
| Política alterada durante a batida | Cabeçalho e revisão lidos na transação do `coala-rep-p`; snapshot e digest na evidência | A política não prova onde o aparelho realmente estava |
| GPS impreciso | Círculo de precisão e resultado `indeterminate` | `accuracyMeters` também é declarado pelo cliente |
| Acesso indevido | Coleções server-only; consulta na candidata com permissão expressa, unidade e auditoria antes da resposta | Publicar, revisar concessões nominais e conferir IAM do runtime |
| Vazamento em logs | Proibir coordenadas em erro, log, métrica, tracing e analytics | Dumps e ferramentas administrativas exigem controle próprio |
| Uso disciplinar automatizado | Nenhum efeito de folha, PTRP ou RH e nenhuma fila disciplinar | Qualquer uso humano futuro ainda dependerá de política e treinamento |
| Dependência de mapa | Nenhuma API de mapa no caminho da batida | Mapa opcional de configuração cria fornecedor adicional |

O sistema deve chamar o dado de `evidência informada pelo dispositivo`, nunca de prova absoluta de presença. A decisão humana deve poder considerar precisão, ambiente coberto, falha do sensor, atividade externa, unidade escolhida e demais fatos.

## Observabilidade

Métricas permitidas, sempre agregadas:

- tentativas com captura solicitada;
- distribuição por `captureStatus` e `evaluation`;
- latência da captura em faixas;
- precisão em faixas, sem coordenadas;
- erros de integridade de política;
- clientes sem suporte ao novo contrato.

Não usar latitude, longitude, endereço, `employeeId`, `markingId` ou `evidenceId` como label de métrica. Logs operacionais recebem apenas código do erro, workspace, unidade quando necessário e `eventId` sanitizado.

Códigos de erro propostos:

- `DP_TIME_LOCATION_INPUT_INVALID`;
- `DP_TIME_LOCATION_POLICY_INVALID`;
- `DP_TIME_LOCATION_POLICY_CONFLICT`;
- `DP_TIME_LOCATION_POLICY_NOT_FOUND`;
- `DP_TIME_LOCATION_EVIDENCE_INCONSISTENT`.

Falha ao interpretar uma captura válida ou política inconsistente não deve ser escondida como `inside`; ela resulta em `indeterminate` com uma evidência mínima. Uma falha transacional do banco aborta toda a operação antes de consumir o NSR, como já ocorre no registrador. Falha posterior apenas na projeção de conferência exige reconciliação; a implementação preferencial cria a projeção na própria transação para evitar esse estado.

## Índices e custo

Índices previstos no `coala-rep-p`:

- política: leitura por ID determinístico, sem consulta composta;
- evidência: ID determinístico igual ao evento e TTL em `expiresAt`; consulta da candidata por pessoa/workspace/unidade/dia, com limite e cursor de ID.

No volume de referência de 50 pessoas, quatro batidas por dia e 26 dias, são cerca de 5.200 batidas mensais. Para participantes de unidade ativa, a solução acrescenta uma leitura de política e uma escrita de evidência por batida. Com evidências entre 0,8 e 1,5 KiB, o crescimento esperado é de aproximadamente 4 a 8 MiB por mês, antes de índices, backups e PITR.

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

### Incremento 0 — decisões e proteção de dados (decisões tomadas; formalização pendente)

- responder às decisões bloqueantes desta especificação;
- concluir análise jurídica e RIPD;
- definir retenção, papéis e aviso de privacidade;
- confirmar que o piloto não usa geofence como bloqueio;
- registrar parâmetros de cada unidade piloto.

### Incremento 1 — domínio e política (implementado localmente)

- criar tipos, schemas e funções puras de normalização, Haversine e avaliação;
- implementar política versionada no `coala-rep-p`;
- criar rotas seguras de leitura e atualização;
- acrescentar regras deny-all e índices;
- implementar configuração sem mapa externo;
- manter feature flag desligada.

### Incremento 2 — coleta web e persistência (implementado localmente)

- ampliar `repPMarkingSchema` com `locationAttempt` opcional;
- capturar posição no hook compartilhado da tela e do botão rápido;
- preservar payload por `attemptId`;
- ler política e gravar evidência na transação REP-P;
- devolver resumo na resposta;
- apresentar feedback sem alterar comprovante ou histórico fiscal.

### Incremento 3 — direitos do titular (canal geral; fila específica retirada do piloto)

- atender solicitações pelos canais gerais de privacidade da empresa;
- desenho inicial: manter coordenadas sem rota de consulta; a candidata posterior acrescentou consulta auditada, descrita acima;
- autorização específica, escopo de unidade e auditoria de leitura foram implementados na candidata posterior, sem ativação real;
- documentar suspensão do TTL para litígio ou investigação formal.

### Incremento 4 — piloto em observação (aguarda publicação, cláusula/aditivo e parâmetros reais)

- usar somente unidades e pessoas formalmente aprovadas;
- iniciar em `observe`, sem fila operacional ou consequência;
- medir precisão, timeout, permissões negadas e falsos alertas;
- ajustar raios por unidade;
- executar teste de acesso, backup, restauração e retenção;
- obter revisão de Doc Brown antes de commit e antes do piloto.

### Incremento 5 — Coala Go (implementado localmente; aparelho real pendente)

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
| Configuração | detalhe da unidade, `location-policy-control.tsx` e rota `api/dp/time-recording/location-policies/[unitId]` |
| Conferência | não implementada nem necessária no piloto em observação |
| Tipos e permissões | contrato existente `dp.settings.manageTime`, escopado por unidade |
| Regras e índices | `firestore.rep.rules`, `firestore.rep.indexes.json` |
| Documentação | este arquivo, guia REP-P, privacidade e matriz de superfícies |
| Android | `apps/coala-one-android`, somente no incremento 5 |

A separação entre ARP e evidência é requisito arquitetural e não deve ser colapsada por conveniência. A proposta histórica de revisão não faz parte do piloto.

## Estratégia de testes

### Testes puros

- coordenadas e limites válidos e inválidos;
- distância conhecida e estabilidade de arredondamento;
- dentro, fora, tangência e sobreposição pela precisão;
- captura antiga, futura, imprecisa ou ausente;
- política desabilitada, corrompida e com revisão inconsistente;
- digest determinístico;
- retenção ativa diferente de 1.825 dias é rejeitada.

### Serviço e emuladores

- evidência criada na mesma transação da batida;
- falha de evidência não consome NSR;
- replay devolve a mesma marcação e a mesma evidência;
- mesmo `attemptId` com outra coordenada retorna conflito;
- política trocada antes da transação usa a revisão atual;
- pessoa fora da lista nominal não recebe política ativa e coordenada adulterada é ignorada;
- pessoa sem vínculo ou unidade continua recusada pelos controles atuais;
- nenhuma coordenada aparece em recibo, AFD, tentativa ou log;
- clientes não acessam evidências diretamente.

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

1. Na captura pontual, nenhuma localização é coletada antes da confirmação nem depois da batida; no complemento Entre unidades, nenhuma amostra é aceita antes do `start`, durante pausa, depois do `stop` ou fora da janela congelada da escala.
2. Toda tentativa produz marcação normal mesmo quando a localização está externa ou indisponível, desde que os demais requisitos do REP-P sejam satisfeitos.
3. Cliente não consegue declarar `inside`, distância, política ou unidade autorizada.
4. Reenvio do mesmo `attemptId` não duplica batida nem evidência.
5. ARP, AFD, hash e comprovante permanecem sem coordenadas e passam nos testes anteriores.
6. Evidência registra política, precisão, cálculo, confiança e digest aplicados no instante da transação.
7. Coordenadas exatas são server-only; a rota de consulta da candidata exige titular real ou permissão expressa, limite por unidade/dia/pessoa e auditoria antes da resposta. Regras cliente permanecem deny all.
8. Nenhum alerta geográfico gera efeito automático em PTRP, folha, escala, ausência ou disciplina.
9. Feature flag e política por unidade permitem desligamento sem migração ou perda da marcação.
10. Retenção, frequência, aviso, acesso do titular, auditoria, eliminação, RIPD, base legal e responsáveis estão aprovados antes do primeiro piloto real; até lá, `DP_JOURNEY_LOCATION_ENABLED` permanece falso.
11. Doc Brown não identifica requisito não conforme antes do commit da implementação.
12. O piloto mede precisão e falsos alertas antes de qualquer promoção para conferência.

## Decisões bloqueantes

| Decisão | Responsável | Necessária antes de |
| --- | --- | --- |
| Finalidade, frequência e base legal do tratamento | Controlador, encarregado e jurídico | Coleta com pessoas reais |
| Suspensão do TTL em caso de litígio (`legalHold`) | Jurídico, DP e privacidade | Primeiro caso concreto de preservação |
| IDs, unidades e parâmetros reais de Heucilene Ribeiro e Luis | DP e operação | Ativação por unidade |
| Raio e precisão máxima por unidade | Operação, DP e desenvolvimento | Política `observe` |
| Acesso do trabalhador às coordenadas, auditoria, eliminação e canal de contestação | DP, jurídico e privacidade | Piloto |
| Necessidade de mapa externo | Produto e desenvolvimento | Configuração visual |
| Validação do Coala Go em aparelho real e atestação de release | Produto e desenvolvimento | Piloto móvel |

Pergunta preparada para o advogado: **a captura pontual e, separadamente, a coleta periódica durante turnos Entre unidades — ambas sem bloquear a marcação e usadas apenas para conferência humana — atendem ao art. 74 da Portaria MTP nº 671/2021 e às regras das categorias e estabelecimentos do piloto? Quais finalidade, base legal, frequência, transparência, prazo de guarda, acesso do trabalhador, auditoria, eliminação e limites de uso disciplinar devem constar da política e do RIPD?**

## Referências

- [Portaria MTP nº 671/2021 e fontes REP-P conferidas](../rep-p/referencias/README.md)
- [Plano REP-P, documentos e conformidade](../planos/plano-rep-p-controle-de-ponto.md)
- [Plano de jornada e fechamento](../planos/plano-jornada-fechamento-rh.md)
- [Fluxo implementado do registro de ponto](flows/dp-time-recording.md)
- [Acesso e privacidade](access-and-privacy.md)
- [Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Relatório do grupo de trabalho sobre proteção de dados no contexto laboral](https://www.gov.br/anpd/pt-br/cnpd-2/grupos-de-trabalho/gt1-relatorio-final-cnpd.pdf/@@display-file/file)
- [Cobrança do Cloud Firestore](https://firebase.google.com/docs/firestore/pricing)
