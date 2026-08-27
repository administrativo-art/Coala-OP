# Invariantes do Coala One

Este arquivo registra contratos duráveis e o nível real de garantia existente. `GARANTIDO` exige proteção automatizada já executada; `PARCIALMENTE GARANTIDO` identifica cobertura incompleta ou enforcement externo pendente.

## ENG-VERIFY-1

- **ID:** ENG-VERIFY-1
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Pull requests e pushes para a branch principal devem executar qualidade do aplicativo, regras do Firebase e build de Functions em jobs independentes.
- **Motivação:** Impedir que typecheck, lint, testes, build ou regras dependam apenas de disciplina local.
- **Mecanismo de proteção:** `.github/workflows/verify.yml`, scripts `check`, `verify` e `check:rules`.
- **Teste:** `npm run check`, `npm run verify`, `npm run check:rules` e `npm --prefix functions run build`.
- **Limitações:** O workflow existe localmente, mas os required checks e o bloqueio de push direto dependem de branch protection ainda não configurada remotamente.

## HOST-PUBLIC-1

- **ID:** HOST-PUBLIC-1
- **Estado:** GARANTIDO
- **Regra:** Conteúdo de uma rota interna nunca é servido diretamente no host público de recrutamento.
- **Motivação:** Separar a superfície pública de recrutamento da aplicação interna sem depender de uma denylist completa de rotas atuais e futuras.
- **Mecanismo de proteção:** O middleware só permite APIs públicas enumeradas e reescreve os demais caminhos não reservados para a árvore `/vagas`; prefixos internos sensíveis recebem 404.
- **Teste:** `tests/unit/public-recruitment-middleware.test.ts`, incluindo `/escala` fora da denylist e `/__internal-future-route__`; executado com `node --import tsx --test tests/unit/public-recruitment-middleware.test.ts`.
- **Limitações:** O teste garante a decisão do middleware (`next`, `rewrite`, `redirect`, status, destino e headers), não o conteúdo renderizado após um rewrite.

## HOST-PUBLIC-2

- **ID:** HOST-PUBLIC-2
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** No host público, apenas as superfícies públicas previstas podem produzir resposta pública válida; slugs inexistentes devem terminar no comportamento de vaga não encontrada previsto pelo produto.
- **Motivação:** Preservar slugs dinâmicos legítimos sem transformar caminhos desconhecidos em acesso direto a páginas internas.
- **Mecanismo de proteção:** O middleware encaminha caminhos limpos exclusivamente para `/vagas/<slug>` e a página dinâmica consulta a lista pública antes de renderizar uma vaga.
- **Teste:** `tests/unit/public-recruitment-middleware.test.ts` caracteriza slugs previstos e inexistentes com o mesmo rewrite seguro.
- **Limitações:** A página de slug decide “vaga não encontrada” no cliente e não existe neste checkout um harness end-to-end isolado de produção que prove o status HTTP final. Por isso, o contrato semântico final não está marcado como garantido.

## FIREBASE-TEST-1

- **ID:** FIREBASE-TEST-1
- **Estado:** GARANTIDO
- **Regra:** Testes de Firestore abortam antes da inicialização quando não usam emulador local, project ID `demo-*`, database ID conhecido ou quando recebem credencial real desnecessária.
- **Motivação:** Impedir acesso acidental a produção e falso verde causado por erro de digitação no database ID.
- **Mecanismo de proteção:** `tests/helpers/firestore-emulator-safety.mjs`, usado pelos testes de rules e repository.
- **Teste:** Caso “guarda do emulador rejeita projeto, database e credencial inseguros” em `tests/security/rules.test.mjs`; executado por `npm run check:rules`.
- **Limitações:** A Firebase CLI `15.15.0` não associa simultaneamente rulesets a múltiplos bancos nomeados; a estratégia e essa limitação estão registradas em `docs/engineering/firestore-emulator-contract.md`.

## FIN-CLOSURE-REPOSITORY-1

- **ID:** FIN-CLOSURE-REPOSITORY-1
- **Estado:** GARANTIDO
- **Regra:** A persistência de fechamento mantém fechamento, linhas, totais derivados, transições e auditoria consistentes no banco financeiro.
- **Motivação:** Proteger a unidade transacional real do módulo canônico, além dos testes puros de domínio.
- **Mecanismo de proteção:** Transações do repository e teste isolado no Firestore Emulator com database ID `coala-financeiro`.
- **Teste:** `tests/integration/cash-closure-repository.test.mjs`; executado por `npm run test:integration`.
- **Limitações:** O Admin SDK ignora Firestore Rules; autorização do cliente permanece coberta separadamente por `npm run check:rules`.

## API-AUTH-TRANSPORT-1

- **ID:** API-AUTH-TRANSPORT-1
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Componentes não devem obter token, montar `Authorization`, interpretar resposta e normalizar erro por conta própria.
- **Motivação:** Evitar divergência de autenticação, `Content-Type`, `204`, upload, cancelamento e erro entre consumidores.
- **Mecanismo de proteção:** Transporte puro `src/lib/authenticated-api-client.ts` e hook `src/hooks/use-authenticated-api.ts`.
- **Teste:** `tests/unit/authenticated-api-client.test.ts`, com JSON, texto, erro, `204`, headers, body JSON, `FormData`, `AbortSignal` e ausência de token.
- **Limitações:** Apenas `cash-closure-day-page.tsx` foi migrado nesta tarefa. Outros consumidores existentes permanecem no backlog documentado em `docs/engineering/authenticated-transport-inventory.md`.

## ERR-1

- **ID:** ERR-1
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Erro inesperado nunca expõe stack, segredo ou mensagem interna ao cliente.
- **Motivação:** Evitar vazamento de implementação e dados sensíveis.
- **Mecanismo de proteção:** Contrato central de resposta e ratchet de dívida.
- **Teste:** `tests/unit/observability/reporter-api.test.ts` e `npm run check:error-contract`.
- **Limitações:** Rotas legadas ainda não foram migradas.

## ERR-2

- **ID:** ERR-2
- **Estado:** GARANTIDO
- **Regra:** Toda falha inesperada capturada pela camada central recebe `eventId`.
- **Motivação:** Correlacionar referência pública e evento técnico sem PII.
- **Mecanismo de proteção:** Reporter central.
- **Teste:** `tests/unit/observability/reporter-api.test.ts`.
- **Limitações:** Abrange somente superfícies instrumentadas.

## ERR-3

- **ID:** ERR-3
- **Estado:** GARANTIDO
- **Regra:** Toda requisição instrumentada recebe `requestId`.
- **Motivação:** Correlacionar resposta e fluxo de servidor.
- **Mecanismo de proteção:** Helper e wrapper de API.
- **Teste:** `tests/unit/observability/app-error-event.test.ts` e `reporter-api.test.ts`.
- **Limitações:** Não implica instrumentação automática de todas as rotas existentes.

## ERR-4

- **ID:** ERR-4
- **Estado:** GARANTIDO
- **Regra:** Eventos capturados possuem fingerprint determinístico.
- **Motivação:** Agrupar ocorrências sem criar uma issue por evento.
- **Mecanismo de proteção:** Normalizador e gerador de fingerprint.
- **Teste:** `tests/unit/observability/app-error-event.test.ts`.
- **Limitações:** Alterações intencionais do contrato de fingerprint exigem versionamento.

## ERR-5

- **ID:** ERR-5
- **Estado:** GARANTIDO
- **Regra:** Dados sensíveis passam por sanitização antes do sink.
- **Motivação:** Observabilidade não pode virar vazamento.
- **Mecanismo de proteção:** Sanitizador central com allowlist, limites e redação.
- **Teste:** `tests/unit/observability/sanitize.test.ts`.
- **Limitações:** Sanitização reduz risco, mas não substitui a minimização na origem.

## ERR-6

- **ID:** ERR-6
- **Estado:** GARANTIDO
- **Regra:** Erro esperado não gera incidente crítico automaticamente.
- **Motivação:** Separar regra de negócio de falha técnica.
- **Mecanismo de proteção:** Taxonomia e `AppError`.
- **Teste:** `tests/unit/observability/app-error-event.test.ts` e `reporter-api.test.ts`.
- **Limitações:** O impacto pode promover severidade explicitamente.

## ERR-7

- **ID:** ERR-7
- **Estado:** GARANTIDO
- **Regra:** Falha da própria observabilidade nunca interrompe a operação principal.
- **Motivação:** Preservar a falha e o fluxo originais.
- **Mecanismo de proteção:** Reporter sem lançamento e sink assíncrono contido.
- **Teste:** `tests/unit/observability/reporter-api.test.ts` e `observed-job.test.ts`.
- **Limitações:** Falha de processo antes da execução do reporter permanece fora do seu alcance.

## ERR-8

- **ID:** ERR-8
- **Estado:** GARANTIDO
- **Regra:** Nenhuma nova rota pode devolver `error.message` diretamente.
- **Motivação:** Impedir crescimento da dívida de respostas inseguras.
- **Mecanismo de proteção:** Ratchet `check:error-contract`.
- **Teste:** `tests/unit/observability/error-contract-ratchet.test.ts`; comando executado localmente.
- **Limitações:** A dívida histórica será mantida em baseline e migrada por prioridade.

## ERR-9

- **ID:** ERR-9
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Auditoria de negócio não substitui observabilidade técnica.
- **Motivação:** Auditoria explica comandos do domínio; evento técnico explica a falha operacional.
- **Mecanismo de proteção:** Separação documentada e campos de correlação previstos.
- **Teste:** Não aplicável isoladamente; contratos técnicos serão testados.
- **Limitações:** A correlação ainda não está presente em todos os eventos de domínio.

## ERR-10

- **ID:** ERR-10
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Bug acionável exige teste de regressão ou justificativa formal.
- **Motivação:** A correção deve deixar proteção permanente.
- **Mecanismo de proteção:** `AGENTS.md`, protocolo de issue e templates de issue/PR.
- **Teste:** Validação humana do template; enforcement automatizado de conteúdo de PR não foi criado.
- **Limitações:** Required checks e proteção de branch dependem de configuração remota.

## ERR-11

- **ID:** ERR-11
- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Issue não é encerrada como validada sem identificar rollout quando aplicável.
- **Motivação:** Código pronto não prova comportamento em runtime.
- **Mecanismo de proteção:** Protocolo e templates.
- **Teste:** Não há automação de status remoto nesta tarefa.
- **Limitações:** Depende do processo operacional e da configuração do GitHub.

## ERR-12

- **ID:** ERR-12
- **Estado:** GARANTIDO
- **Regra:** Recorrência pós-fix exige comparação de fingerprint e release.
- **Motivação:** Diferenciar repetição histórica, recorrência e regressão real.
- **Mecanismo de proteção:** Schema de evento e triagem local.
- **Teste:** `tests/unit/agent-skills/error-triage.test.ts`.
- **Limitações:** Release precisa estar disponível no runtime ou será registrada como `unknown`.
