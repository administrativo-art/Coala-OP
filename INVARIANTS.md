# Invariantes de engenharia

Este arquivo registra contratos duráveis da fundação do Coala-OP.

## Semântica dos estados

- `PROPOSTO`: o contrato foi identificado, mas ainda não possui proteção implementada.
- `PARCIALMENTE GARANTIDO`: existe proteção para parte do contrato ou falta uma etapa de enforcement.
- `GARANTIDO`: o contrato está protegido por verificação automatizada aplicável e executada.
- `VALIDADO EM PRODUÇÃO` não é um estado alternativo. É uma evidência operacional adicional, que exige rollout identificado e smoke test ou validação operacional aplicável.

Um invariante pode estar `GARANTIDO` sem estar validado em produção. Evidência operacional deve identificar revisão, execução e limite da observação.

## ENG-ISSUE-1

- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Uma correção de issue deve identificar o contrato violado e deixar um artefato permanente de proteção.
- **Motivação:** Evitar correções pontuais que não eliminam a classe da falha.
- **Mecanismo de proteção:** `AGENTS.md`, protocolo de issue e template de bug.
- **Teste:** Revisão documental; a qualidade de uma issue ainda depende de revisão humana.
- **Limitações:** Não há enforcement automatizado sobre o conteúdo de issues remotas.
- **Validação em produção:** Não aplicável.

## ENG-VERIFY-1

- **Estado:** GARANTIDO
- **Regra:** Mudanças comuns devem passar por `check`; mudanças que afetem build devem passar por `verify`.
- **Motivação:** Tornar a verificação reproduzível localmente e no CI.
- **Mecanismo de proteção:** Scripts npm, workflow `verify`, required checks e proteção da branch `main` já ativos.
- **Teste:** `npm run check` e `npm run verify`; jobs reais `quality`, `firestore-rules` e `functions` executados no GitHub no checkpoint reduzido.
- **Limitações:** O candidato funcional precisa passar novamente pelo GitHub Actions antes de ser integrado; isso não valida produção.
- **Validação em produção:** A fundação reduzida teve rollout identificado, mas a árvore funcional deste candidato ainda não foi validada.

## FIRESTORE-EMU-1

- **Estado:** GARANTIDO
- **Regra:** Testes de regras Firestore só iniciam com host de emulador local, project IDs `demo-*` e sem credenciais reais no ambiente.
- **Motivação:** Impedir que a suíte de segurança alcance um projeto real.
- **Mecanismo de proteção:** Preflight central e Firebase CLI local com versão fixada.
- **Teste:** `tests/unit/firestore-emulator-safety.test.mjs`, executado por `npm run check`, e suítes de regras executadas por `npm run check:rules`.
- **Limitações:** A suíte funcional carrega rules distintas em projetos isolados; ainda não caracteriza os database IDs nomeados do produto no emulador.
- **Validação em produção:** Não aplicável.

## FUNCTIONS-BUILD-1

- **Estado:** GARANTIDO
- **Regra:** O pacote independente `functions` deve instalar suas próprias dependências e compilar separadamente da aplicação raiz.
- **Motivação:** O typecheck da raiz não cobre automaticamente o pacote de Functions.
- **Mecanismo de proteção:** Job `functions` no workflow e lockfile próprio.
- **Teste:** `npm --prefix functions ci` e `npm --prefix functions run build`; job real `functions` executado no GitHub no checkpoint reduzido.
- **Limitações:** O pacote deste candidato precisa passar novamente pelo job após integração.
- **Validação em produção:** Não realizada para este candidato.

## FIN-INTER-STATEMENT-1

- **Estado:** GARANTIDO
- **Proteção automatizada:** GARANTIDA por teste de regressão e sanitização nas fronteiras de domínio e persistência.
- **Regra:** Itens persistidos em sessões de extrato do Banco Inter não contêm valores `undefined`, inclusive em campos opcionais e objetos aninhados.
- **Motivação:** O Firestore rejeita documentos com `undefined` e interrompia `/api/jobs/inter/statements/sync`.
- **Mecanismo de proteção:** Sanitização no domínio e novamente na fronteira de persistência, sem habilitar `ignoreUndefinedProperties` globalmente.
- **Teste:** `tests/unit/financial-inter-statement.test.ts`.
- **Limitações:** O teste protege os itens da sessão de extrato; não constitui um sanitizador universal para todos os payloads Firestore do produto.
- **Validação em produção:** CONFIRMADA na revisão `studio-build-2026-08-27-002`: execução natural de `/api/jobs/inter/statements/sync` em 27/08/2026 respondeu HTTP 200 sem recorrência do erro de `undefined` na janela observada. Evidência: `docs/engineering/production-validation-2026-08-27.md`.

## OBS-SYSTEM-ERROR-1

- **Estado:** GARANTIDO
- **Regra:** Falhas inesperadas nas superfícies instrumentadas produzem evento estruturado sanitizado, com stack multiline parseável, identidade opaca, correlação e sink provider-agnostic; a resposta pública não expõe detalhe interno.
- **Motivação:** Tornar falhas acionáveis sem transformar observabilidade em nova fonte de vazamento ou indisponibilidade.
- **Mecanismo de proteção:** `src/lib/observability`, Error Boundaries, envelope seguro, pilotos e ratchet do contrato de erro.
- **Teste:** `tests/unit/observability/*.test.ts` e `npm run check:error-contract`.
- **Limitações:** A cobertura é incremental; o pacote independente `functions` ainda não usa o contrato compartilhado.
- **Validação em produção:** Não realizada. Formato local compatível não prova ingestão nem grouping no Google.

## DEPLOY-SOURCE-1

- **Estado:** GARANTIDO
- **Regra:** `main` é a branch protegida de integração; `production` é a branch protegida acompanhada pelo App Hosting. Merge em `main` não autoriza deploy. Promoção ocorre explicitamente por PR de SHA previamente validado para `production`.
- **Motivação:** Separar integração de código da autorização operacional de publicação.
- **Mecanismo de proteção:** Branches protegidas, App Hosting vinculado a `production` e promoção explícita.
- **Teste:** Na promoção de 27/08/2026, `main@b24f44f7` e `production@a0a76b19` produziram a mesma tree `388f180a`.
- **Limitações:** A proteção depende da configuração remota permanecer ativa; esta tarefa apenas revalidou SHAs/trees e não alterou configuração.
- **Validação em produção:** CONFIRMADA para a promoção documentada em `docs/engineering/production-validation-2026-08-27.md`.

## Contratos adiados por dependência funcional

### HOST-PUBLIC-*

- **Estado:** ADIADO — REQUER RECONCILIAÇÃO PRÓPRIA
- **Abrange:** isolamento de rotas internas no host público e semântica final de não encontrado após rewrite.
- **Próximo passo:** integrar caracterização e testes junto com a evolução correspondente do middleware/host público.

### FIN-CLOSURE-REPOSITORY-*

- **Estado:** ADIADO — REQUER RECONCILIAÇÃO PRÓPRIA
- **Abrange:** consistência, transições e auditoria do repositório de fechamento financeiro.
- **Próximo passo:** reconciliar separadamente os testes e o módulo `cash-closures` que não integraram o checkpoint reduzido.

### API-AUTH-TRANSPORT-*

- **Estado:** ADIADO — REQUER RECONCILIAÇÃO PRÓPRIA
- **Abrange:** transporte autenticado compartilhado e migração do consumidor canônico.
- **Próximo passo:** reconciliar o contrato junto com os consumidores funcionais correspondentes.

### FIRESTORE-MULTI-DATABASE-*

- **Estado:** PROPOSTO
- **Abrange:** caracterização positiva e negativa de todos os database IDs declarados em `firebase.json`.
- **Próximo passo:** criar uma suíte dedicada capaz de selecionar explicitamente cada database ID sem ambiguidade.
