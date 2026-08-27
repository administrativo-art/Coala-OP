# Migração dos secrets do PDV Legal

## Estado confirmado

A auditoria somente leitura encontrou quatro parâmetros usados pela integração do PDV Legal:

- `PDVLEGAL_COD_EMPRESA`;
- `PDVLEGAL_TOKEN`;
- `PDVLEGAL_USERNAME`;
- `PDVLEGAL_PASSWORD`.

Os quatro secrets já existem no Secret Manager e cada um possui uma versão habilitada. Nenhum valor foi lido.

No App Hosting, os quatro parâmetros são referenciados como secrets em `apphosting.yaml`. A auditoria inicial encontrou armazenamento e distribuição excessivos nas Cloud Functions. Nenhuma evidência de uso indevido foi encontrada.

## Consumidores das Functions

A busca por chamadas de `syncDayAdmin` e leitura dos parâmetros identificou somente duas Functions consumidoras:

| Function | Trigger | Necessidade |
|---|---|---|
| `hourlyPdvSync` | scheduler | autentica e sincroniza vendas por unidade |
| `syncGoalsForRange` | callable autenticada | reprocessa um intervalo solicitado por administrador |

Scripts operacionais locais também consomem esses nomes, mas não são Cloud Functions e não recebem vínculo de runtime por esta migração.

## Contrato local

`functions/src/pdv-secret-contract.ts` centraliza os quatro nomes. Somente `hourlyPdvSync` e `syncGoalsForRange` declaram `secrets: [...PDVLEGAL_SECRET_NAMES]` nas opções do Firebase Functions v2.

O código de domínio continua lendo `process.env` durante a execução. O Firebase injeta os secrets vinculados no ambiente da Function; essa escolha evita espalhar acesso ao Secret Manager ou criar uma nova dependência.

O teste `tests/unit/functions-pdv-secret-contract.test.ts` protege:

- o catálogo dos quatro nomes;
- o vínculo somente nas duas Functions consumidoras;
- a ausência de valores no contrato versionado.

O teste também inspeciona apenas os nomes configurados nos arquivos dotenv locais e impede que os quatro parâmetros voltem a ser distribuídos como env comum. Valores não são registrados pelo teste.

## Estado remoto verificado

Em 27/08/2026, depois da correção informada pelo usuário, a consulta somente leitura confirmou:

- 34 Functions inspecionadas;
- nenhuma das quatro chaves em `environmentVariables` comum;
- quatro `secretEnvironmentVariables` em `hourlyPdvSync`;
- quatro `secretEnvironmentVariables` em `syncGoalsForRange`;
- nenhuma outra Function com vínculo a esses secrets.

Os arquivos `functions/.env` e `functions/.env.smart-converter-752gf` também estavam sem as quatro chaves. A consulta e o teste não leram nem imprimiram valores.

A correção remota foi realizada pelo usuário, não pela IA. Não houve deploy ou rollout executado pela IA.

## Rotação posterior — gate separado

Se a credencial anterior ainda não tiver sido rotacionada, o fluxo futuro deve ser:

1. gerar credencial nova pelo fluxo oficial do PDV Legal;
2. adicionar novas versões no Secret Manager sem imprimir os valores;
3. reimplantar somente as duas consumidoras;
4. validar autenticação e sincronização;
5. invalidar a credencial antiga no provedor;
6. desabilitar versões antigas do Secret Manager após a janela de observação.

O estado da rotação no provedor não foi auditado. A ausência de configuração em texto simples não prova, por si só, que a credencial anterior foi invalidada.
