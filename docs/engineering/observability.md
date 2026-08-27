# Observabilidade técnica do Coala One

## Estado local

A aplicação expõe um contrato interno independente de fornecedor em `src/lib/observability`. A implementação inicial, `StructuredConsoleSink`, grava uma única linha JSON por evento. A auditoria confirmou que os runtimes gerenciados pelo Google enviam stdout/stderr ao Cloud Logging sem SDK adicional.

```text
aplicação
  → reportSystemError()
  → ErrorSink
  → StructuredConsoleSink
  → stdout/stderr do runtime
```

Adapters futuros podem implementar `ErrorSink`, mas o domínio não deve importar SDK de fornecedor.

O sink acrescenta os campos especiais reconhecidos pelo Google sem remover o contrato interno: severidade do Logging, `ReportedErrorEvent`, `eventTime`, `serviceContext` e `message` com stack sanitizada quando disponível. `K_SERVICE`/`FUNCTION_TARGET` identificam o serviço e `release` identifica a versão. O `fingerprint` do Coala permanece no evento e nas labels para busca e triagem; ele não é apresentado como controlador do algoritmo nativo de agrupamento do Error Reporting.

## Contrato do evento

`SystemErrorEvent` é versionado e validado por Zod. Cada ocorrência capturada inclui `eventId`, classificação, severidade, origem, operação, rota ou job, ambiente, release, fingerprint e dados sanitizados. `requestId` liga uma resposta HTTP ao evento; `correlationId` só é propagado quando um fluxo distribuído já o fornece.

O fingerprint usa código estável, superfície, operação, nome do erro e frames normalizados. Timestamp, UUID, query string e identificadores dinâmicos não participam da identidade do grupo.

## Servidor e APIs

`withApiErrorHandling` resolve e devolve `x-request-id`, preserva respostas de sucesso, reconhece `AppError` e transforma falhas inesperadas em envelope seguro. Quatro superfícies representativas foram migradas como pilotos; a dívida restante está em `error-contract-migration.md`.

Erros esperados e não reportáveis não recebem `eventId`. Falhas inesperadas e erros explicitamente reportáveis recebem referência técnica. A mensagem pública nunca é derivada da causa bruta.

## Navegador

`ClientErrorObserver` captura rejeições não tratadas e erros inesperados em background. O `error.tsx` captura falhas de renderização e envia o mesmo `eventId` exibido à pessoa usuária. O envio usa o transporte autenticado compartilhado e o endpoint `/api/observability/client-errors`.

O endpoint exige Firebase ID token, limita o corpo a 32 KiB, valida schema estrito, sanitiza novamente e aplica limite de 20 eventos por minuto por usuário e instância. Ele não consulta nem grava Firestore. Fluxos anônimos não enviam eventos ao servidor; `global-error.tsx` mantém somente o registro local porque pode ser renderizado sem os provedores da aplicação.

## Jobs e integrações

`runObservedJob` registra duração, tentativa, resultado e correlação. Tentativas intermediárias não geram incidente; a captura ocorre somente quando `isTerminal` está ativo. Logs de domínio existentes continuam sendo a fonte de auditoria do negócio e podem guardar o `eventId` quando uma migração exigir a ligação.

## Sanitização e minimização

O sanitizador usa allowlist, limites de tamanho e redação. Headers de autenticação, cookies, tokens, chaves, documentos pessoais, dados bancários, Pix, remuneração, dados médicos, e-mail, query sensível, corpos de Request/Response e conteúdo de snapshots não são preservados integralmente. Caminhos locais removem o nome do usuário do sistema operacional.

Sanitização é uma defesa adicional; a regra principal continua sendo não enviar o dado sensível.

## Custo técnico introduzido

Esta fundação não adiciona dependência paga, polling, listener, leitura ou escrita no Firestore. O custo variável é apenas o tráfego autenticado de eventos de navegador e a ingestão dos JSONs pelo runtime/provedor já existente.

A auditoria somente leitura de 26/08/2026 mediu aproximadamente `0,223 GiB` ingeridos no mês. Mantido o ritmo observado, a projeção é de aproximadamente `0,27 GiB/mês`, abaixo da franquia vigente de `50 GiB/projeto/mês` do Cloud Logging. A estimativa atual de ingestão de logs é, portanto, `US$ 0/mês`; ela precisa ser reavaliada depois do rollout da captura client-side. Evidências, premissas e limitações estão em `google-observability-audit.md`.

## Limites conhecidos

- A camada central cobre somente as superfícies instrumentadas; o ratchet impede crescimento da dívida, mas não migra automaticamente o legado.
- O rate limit do navegador é por instância e não constitui cota distribuída.
- `release` usa `K_REVISION` ou `GITHUB_SHA` quando disponíveis; caso contrário registra `unknown`.
- Os testes provam o formato JSON esperado, mas a captura e o agrupamento do novo evento no ambiente real só poderão ser validados após rollout autorizado e smoke test.
- `global-error.tsx` não possui transporte autenticado porque pode executar quando a própria árvore de provedores falhou.
