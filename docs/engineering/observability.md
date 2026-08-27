# Observabilidade técnica do Coala One

## Arquitetura

A fundação é independente de fornecedor:

```text
AppError
  → SystemErrorEvent
  → reportSystemError()
  → ErrorSink
  → StructuredConsoleSink
  → stdout/stderr estruturado
  → Cloud Logging
  → Error Reporting
```

O domínio não importa SDK do Google. O App Hosting/Cloud Run já coleta stdout e stderr; por isso não há Sentry, client library adicional, sink remoto, polling ou persistência de eventos no Firestore.

## Contrato de SystemErrorEvent

O schema versionado em `src/lib/observability/system-error-event.ts` valida:

| Campo | Finalidade |
|---|---|
| `eventId` | referência opaca e única da ocorrência |
| `occurredAt` | timestamp ISO da captura |
| `errorCode`, `errorKind`, `severity` | identidade estável e classificação |
| `source`, `operation`, `routeOrJob` | superfície técnica |
| `environment`, `release` | ambiente e revisão/commit observável |
| `requestId`, `correlationId` | propagação HTTP e entre fluxos, quando presente |
| `fingerprint` | identidade interna de agrupamento do Coala |
| `errorName`, `messageSanitized`, `stackSanitized` | diagnóstico sanitizado |
| `metadataSanitized` | contexto técnico minimizado por allowlist |
| `retryAttempt`, `isTerminal` | semântica de retry/job |

Timestamp e UUID são não determinísticos em produção e injetáveis em testes. O fingerprint é determinístico para código, superfície, operação, tipo do erro e frames normalizados; UUIDs, query strings, identificadores dinâmicos e linha/coluna não alteram o grupo.

O fingerprint do Coala serve à busca, triagem e recorrência internas. Ele não controla o algoritmo nativo de agrupamento do Google Error Reporting, que continua dependente principalmente de exceção, mensagem e frames reconhecidos.

## Sanitização e stack

A sanitização acontece antes do sink e novamente na ingestão de eventos do navegador. Ela remove ou omite tokens, Authorization, cookies, senhas, chaves, credenciais, e-mail, CPF/CNPJ, números longos, documentos, dados bancários/Pix, remuneração, dados médicos, bodies e payloads de terceiros não permitidos.

`Request` não preserva body e mantém somente headers explicitamente seguros. `Response` não preserva body. Snapshots Firestore são reduzidos a referência técnica sem executar `data()`.

A stack tem contrato próprio: CRLF é normalizado para newline, as linhas `at ...` permanecem separadas e o limite global é 8.000 caracteres. Truncamento ocorre em quebra de linha e acrescenta marcador próprio. O sink grava uma linha física JSON no stdout/stderr; após o parse JSON, o campo `message` preserva a stack multiline reconhecível.

Falha do sanitizador, sink ou resolução de release é best-effort e nunca substitui a falha original.

## APIs

`withApiErrorHandling` resolve ou gera `requestId`, propaga `correlationId`, preserva respostas de sucesso e converte falhas em envelope seguro:

```json
{
  "error": {
    "code": "UNEXPECTED_ERROR",
    "message": "Ocorreu uma falha inesperada. Tente novamente.",
    "eventId": "uuid",
    "requestId": "id-opaco",
    "correlationId": "id-opaco-opcional"
  }
}
```

Erros esperados de negócio usam `AppError` e só geram evento quando marcados como reportáveis. Falhas inesperadas são reportadas antes da resposta 500. Mensagem e stack internas nunca compõem o envelope público.

O piloto de API é `POST /api/products`. A migração das demais rotas é backlog controlado pelo ratchet, não uma lista de bugs confirmados.

## Navegador

`error.tsx` e `global-error.tsx` exibem referência opaca sem detalhe interno. `ClientErrorObserver` captura falhas globais e rejeições não tratadas relevantes.

O envio para `POST /api/observability/client-errors`:

- exige Firebase ID token;
- limita o corpo a 32 KiB e valida schema estrito;
- aplica limite local de 10 eventos/minuto por aba e limite servidor de 20 eventos/minuto por usuário/instância;
- não lê nem grava Firestore;
- contém falhas de transporte sem quebrar a interface.

Sem sessão autenticada, o evento não é enviado ao servidor. Ruídos conhecidos, extensões e `AbortError` são descartados antes do transporte.

## Revisão de permissões

A fundação não adiciona página nem item de navegação. A ingestão client-side exige Firebase ID token no servidor, não lê nem grava dados de negócio e não concede capacidade além de registrar um evento sanitizado. Por isso não foi criada permissão nova nem é necessário ajustar perfis existentes.

O piloto `POST /api/products` preserva as autorizações server-side já existentes (`registration.items.add`, `purchasing.manageBaseItems` ou administrador padrão). O piloto do job preserva a autenticação por segredo já existente. Error Boundaries apenas exibem fallback público seguro; ocultação de interface não é usada como controle de acesso.

## Jobs e integrações

`runObservedJob` preserva o retorno e relança a falha original. Tentativas intermediárias não criam incidente quando `isTerminal=false`; a falha terminal recebe evento com tentativa, duração e IDs de correlação.

O piloto é `POST /api/jobs/inter/cobrancas/reconcile`. Ele instrumenta o job executado no App Hosting. O pacote independente `functions` ainda depende da captura nativa do runtime e não foi migrado nesta fase; uma fundação compartilhada entre pacotes exige desenho próprio para não duplicar contratos nem criar dependência de deploy fora do pacote.

## StructuredConsoleSink

O sink traduz o evento interno para JSON compatível com o ambiente Google:

- severidade reconhecida pelo Logging;
- `@type` de `ReportedErrorEvent`;
- `eventTime`;
- `serviceContext.service` e `serviceContext.version`;
- `message` com stack sanitizada multiline;
- labels pesquisáveis para `errorCode`, `fingerprint` e `release`.

A compatibilidade estrutural é testada localmente. Captura, agrupamento e pesquisa reais só poderão ser afirmados após rollout autorizado e smoke test.

## Custo e limites

Não há `setInterval`, listener, query ou escrita Firestore. Cada falha client-side aceita gera no máximo uma requisição HTTP e um evento de log. O teto local é 600 requisições/hora por aba em uma tempestade contínua; com o limite máximo de 32 KiB, o teto teórico de payload é 18,75 MiB/hora por aba, não uma carga periódica.

A auditoria histórica de 26/08/2026, preservada em `google-observability-audit.md`, indicou volume muito abaixo da franquia do Logging. O volume deve ser medido novamente após rollout; nenhuma estimativa local substitui essa validação.
