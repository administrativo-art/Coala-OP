# Invariantes de engenharia

Este arquivo registra contratos duráveis da fundação do Coala-OP.

## Semântica dos estados

- `PROPOSTO`: o contrato foi identificado, mas ainda não possui proteção implementada.
- `PARCIALMENTE GARANTIDO`: existe proteção para parte do contrato ou falta uma etapa de enforcement.
- `GARANTIDO`: o contrato está protegido por verificação automatizada aplicável e executada.
- `VALIDADO EM PRODUÇÃO` não é um estado alternativo. É uma evidência operacional adicional, que exige rollout identificado e smoke test ou validação operacional aplicável.

Um invariante pode estar `GARANTIDO` sem estar validado em produção. Nenhum invariante deste checkpoint foi validado em produção.

## ENG-ISSUE-1

- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Uma correção de issue deve identificar o contrato violado e deixar um artefato permanente de proteção.
- **Motivação:** Evitar correções pontuais que não eliminam a classe da falha.
- **Mecanismo de proteção:** `AGENTS.md`, protocolo de issue e template de bug.
- **Teste:** Revisão documental; a qualidade de uma issue ainda depende de revisão humana.
- **Limitações:** Não há enforcement automatizado sobre o conteúdo de issues remotas.
- **Validação em produção:** Não aplicável.

## ENG-VERIFY-1

- **Estado:** PARCIALMENTE GARANTIDO
- **Regra:** Mudanças comuns devem passar por `check`; mudanças que afetem build devem passar por `verify`.
- **Motivação:** Tornar a verificação reproduzível localmente e no CI.
- **Mecanismo de proteção:** Scripts npm e workflow `verify`.
- **Teste:** `npm run check` e `npm run verify`.
- **Limitações:** Permanece parcial até o workflow executar no GitHub e os checks serem exigidos na branch principal.
- **Validação em produção:** Não realizada.

## FIRESTORE-EMU-1

- **Estado:** GARANTIDO
- **Regra:** Testes de regras Firestore deste checkpoint só iniciam com host de emulador local, project ID `demo-*` e sem credenciais reais no ambiente.
- **Motivação:** Impedir que a suíte de segurança alcance um projeto real.
- **Mecanismo de proteção:** Preflight central e Firebase CLI local com versão fixada.
- **Teste:** `tests/unit/firestore-emulator-safety.test.mjs`, executado por `npm run check`, e `tests/security/firestore.rules.test.mjs`, executado por `npm run check:rules`.
- **Limitações:** A suíte reduzida cobre as regras principais em ambiente isolado; não caracteriza todos os bancos Firestore declarados pelo produto.
- **Validação em produção:** Não aplicável.

## FUNCTIONS-BUILD-1

- **Estado:** GARANTIDO
- **Regra:** O pacote independente `functions` deve instalar suas próprias dependências e compilar separadamente da aplicação raiz.
- **Motivação:** O typecheck da raiz não cobre automaticamente o pacote de Functions.
- **Mecanismo de proteção:** Job `functions` no workflow e lockfile próprio.
- **Teste:** `npm --prefix functions ci` e `npm --prefix functions run build`.
- **Limitações:** A execução real do job no GitHub ainda depende da abertura do PR.
- **Validação em produção:** Não realizada.

## Contratos adiados por dependência funcional

Os contratos abaixo continuam válidos, mas não integram o checkpoint reduzido porque as superfícies funcionais correspondentes ainda não estão presentes em `main`.

### HOST-PUBLIC-*

- **Estado:** ADIADO — DEPENDÊNCIA FUNCIONAL AINDA NÃO PRESENTE EM MAIN
- **Abrange:** isolamento de rotas internas no host público e semântica final de não encontrado após rewrite.
- **Próximo passo:** integrar caracterização e testes junto com o middleware/host público da branch funcional.

### FIN-CLOSURE-REPOSITORY-*

- **Estado:** ADIADO — DEPENDÊNCIA FUNCIONAL AINDA NÃO PRESENTE EM MAIN
- **Abrange:** consistência, transições e auditoria do repositório de fechamento financeiro.
- **Próximo passo:** integrar os testes junto com o módulo `cash-closures`.

### API-AUTH-TRANSPORT-*

- **Estado:** ADIADO — DEPENDÊNCIA FUNCIONAL AINDA NÃO PRESENTE EM MAIN
- **Abrange:** transporte autenticado compartilhado e migração do consumidor canônico.
- **Próximo passo:** integrar o contrato junto com os consumidores funcionais correspondentes.

### FIRESTORE-MULTI-DATABASE-*

- **Estado:** PROPOSTO
- **Abrange:** caracterização positiva e negativa de todos os database IDs declarados em `firebase.json`.
- **Próximo passo:** criar uma suíte dedicada quando houver harness capaz de selecionar explicitamente cada database ID sem ambiguidade.
