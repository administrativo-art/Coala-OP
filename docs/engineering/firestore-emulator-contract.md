# Contrato de testes do Firestore Emulator

## Estado caracterizado

O projeto usa cinco database IDs em produção: `coala`, `coala-signage`, `coala-financeiro`, `coala-rh` e `coala-checklist`. A seleção ocorre explicitamente com `getFirestore(app, databaseId)` nos clientes e singletons Admin correspondentes; o financeiro usa `coala-financeiro`.

A Firebase CLI fixada no projeto é a `15.15.0`. Nessa versão, a inicialização com o `firebase.json` de produção informa que o Firestore Emulator não oferece suporte à configuração de múltiplos bancos e não associa automaticamente os cinco arquivos de regras aos respectivos IDs. Portanto, adicionar entradas ao bloco `emulators` não resolveria a limitação e nenhuma sintaxe não suportada foi introduzida.

## Estratégia de teste

- `firebase.test.json` configura um único banco padrão fechado pelas regras principais, evitando que chamadas diretas acidentais encontrem um emulador aberto.
- `tests/security/rules.test.mjs` carrega cada ruleset em um projeto `demo-*` isolado por `initializeTestEnvironment`. O database ID lógico é validado antes da inicialização.
- Principal, financeiro, RH e signage possuem operações permitidas e negadas pelas regras. Checklist nega deliberadamente toda operação de cliente; o teste prova leitura e escrita negadas depois de preparar o dado com rules desabilitadas.
- `tests/helpers/firestore-emulator-safety.mjs` aborta sem host local do emulador, com project ID sem prefixo `demo-`, database ID desconhecido ou credencial real desnecessária no ambiente.
- Testes de repository usam Admin SDK separadamente e, por isso, não são evidência de regras de segurança.

## Limitações

Os testes de rules validam o conteúdo dos cinco arquivos, mas a CLI atual não reproduz o roteamento simultâneo desses arquivos para cinco bancos nomeados. A associação entre database ID e rules file continua sendo responsabilidade declarativa do `firebase.json` de produção e deve ser verificada em ambiente de staging quando a CLI/emulador oferecer suporte real a multi-database. Um database ID incorreto não é usado em testes: a guarda central falha antes de qualquer conexão, evitando falso verde em banco implícito.
