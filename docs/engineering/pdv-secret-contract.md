# Contrato de secrets do PDV Legal

## Objetivo

As quatro credenciais usadas para autenticar a integração com o PDV Legal são referências de secret de runtime. Valores nunca fazem parte do repositório, dos testes ou deste documento.

O catálogo versionado contém somente os nomes:

- `PDVLEGAL_COD_EMPRESA`;
- `PDVLEGAL_TOKEN`;
- `PDVLEGAL_USERNAME`;
- `PDVLEGAL_PASSWORD`.

## Consumidores autorizados nas Cloud Functions

| Function | Trigger | Motivo |
|---|---|---|
| `hourlyPdvSync` | Scheduler | autentica e sincroniza vendas por unidade durante a janela operacional |
| `syncGoalsForRange` | callable autenticada | reprocessa um intervalo solicitado por usuário autorizado |

Nenhuma outra Function pode vincular esses secrets. Scripts operacionais locais podem receber os mesmos nomes por ambiente durante uma execução explicitamente autorizada, mas não integram a allowlist de runtime das Functions.

## Declaração permanente

`functions/src/pdv-secret-contract.ts` centraliza o catálogo e a allowlist. As duas Functions autorizadas usam `secrets: [...PDVLEGAL_SECRET_NAMES]`; o código de integração lê `process.env` somente durante a execução, após a injeção feita pela plataforma.

No App Hosting, `apphosting.yaml` mantém os quatro parâmetros com `secret`, nunca com `value`. O módulo `src/lib/integrations/pdv-legal-admin.ts` declara a fronteira `server-only`, impedindo importação por componente cliente.

Não existe fallback de credencial. Parâmetro ausente encerra a operação com erro de configuração, sem substituição por valor versionado.

## Garantia automatizada

`tests/unit/functions-pdv-secret-contract.test.ts` protege:

- catálogo e allowlist exatos;
- presença dos quatro secrets nas duas consumidoras;
- ausência de vínculo em Function não autorizada;
- ausência das chaves em `environmentVariables` e arquivos dotenv das Functions;
- ausência de valor hardcoded associado aos nomes;
- ausência de log nominal das credenciais;
- referências `secret` no App Hosting;
- ausência de `NEXT_PUBLIC_*`, referência em módulo `use client` e importação client-side do módulo administrativo.

O teste compara configuração declarada, não valores. Ele não acessa Secret Manager.

## Evidência remota sanitizada

Auditoria somente leitura em 28/08/2026:

- 34 Functions inspecionadas;
- `hourlyPdvSync`: quatro referências em `secretEnvironmentVariables`, nenhuma das quatro chaves em `environmentVariables`;
- `syncGoalsForRange`: quatro referências em `secretEnvironmentVariables`, nenhuma das quatro chaves em `environmentVariables`;
- demais Functions: nenhuma referência aos quatro secrets;
- os quatro secrets possuíam uma versão habilitada cada; valores não foram acessados;
- `hourlyPdvSync` teve 16 execuções naturais HTTP 200 nas 24 horas auditadas, sem erro geral, de unidade ou autenticação;
- `syncGoalsForRange` não foi disparada para produzir evidência artificial.

Assim, os consumidores declarados localmente e os observados remotamente são o mesmo conjunto: `hourlyPdvSync` e `syncGoalsForRange`.

## Deploy e rotação

Este contrato não autoriza deploy, rotação ou alteração remota. Como o runtime já possui os vínculos equivalentes, um futuro deploy das duas Functions serve para provar que a configuração versionada os reproduz; ele não é necessário para corrigir o estado remoto atual.

Rotação continua sendo um gate separado: criar novas versões sem expor valores, reimplantar somente as consumidoras, validar execução, invalidar a credencial anterior no provedor e só depois desabilitar versões antigas conforme a janela aprovada.
