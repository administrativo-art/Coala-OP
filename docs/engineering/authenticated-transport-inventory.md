# Inventário de transporte autenticado no cliente

## Evidência encontrada

O inventário foi feito com buscas por `getIdToken()`, `Authorization: Bearer`, wrappers de `fetch`, parse de resposta e normalização de erro. Antes desta mudança não havia uma abstração compartilhada que cobrisse em conjunto token, headers, JSON, texto, `204`, `FormData`, `AbortSignal`, cache e erro HTTP.

Implementações existentes atendem domínios específicos:

- `src/features/hr/lib/client.ts` combina timeout, JSON e mensagens de RH, mas força `Content-Type: application/json` e exige o usuário em cada chamada.
- `src/features/reposition/lib/client.ts` possui transporte e parse locais apenas para reposição.
- `src/lib/operational-upload-client.ts` cobre upload autenticado, não respostas gerais.
- `src/lib/client-bootstrap.ts` inclui a revivificação de valores Firestore, uma responsabilidade própria do bootstrap.
- `src/lib/fetch-utils.ts` oferece somente timeout e preservação do `AbortSignal`.

Por isso, nenhum deles foi transformado silenciosamente em padrão global. Foi criada uma camada pura em `src/lib/authenticated-api-client.ts` e um hook fino em `src/hooks/use-authenticated-api.ts`.

## Migração inicial

Somente `src/features/financial/cash-closures/components/cash-closure-day-page.tsx` foi migrado. O autosave, o cache `no-store`, os payloads, as mensagens retornadas pela API e os fluxos de sincronizar, submeter, aprovar, reabrir e dividir depósito foram preservados.

## Backlog identificado, não migrado

Os irmãos do consumidor canônico ainda fazem transporte inline:

- `cash-closure-calendar-page.tsx`;
- `cash-closure-months-page.tsx`;
- `cash-closures-overview-page.tsx`.

A busca também encontrou candidatos em clientes de audit, forms, HR, privacy, reposition, return requests, tasks e uniforms; em hooks de compras; em `client-bootstrap`; e em componentes/páginas operacionais e financeiras. Nem toda ocorrência é duplicação: alguns arquivos acrescentam timeout, upload, revivificação, cache ou coordenação de domínio e precisam de migração caracterizada individualmente.

Comando para atualizar o inventário:

```bash
rg -n "getIdToken\\(|Authorization.*Bearer|Bearer.*Authorization" src/features src/hooks src/lib
```
