# Migração do contrato de erro

## Estratégia

A adoção é incremental: abstração central + pilotos + ratchet. Não há migração indiscriminada de todas as rotas.

A baseline foi capturada na tree `388f180a59394bf0bf03adb9ead010e39bb8151d` de `origin/main` antes das mudanças de observabilidade:

- 554 combinações regra/arquivo;
- 1.342 ocorrências legadas;
- nenhuma dessas ocorrências é declarada correta por estar na baseline.

O comando `npm run check:error-contract` falha somente quando uma combinação cresce ou surge fora da baseline. Reduções são aceitas sem exigir limpeza total.

## Padrões controlados

- `error.message` bruto em rotas de API;
- stack próxima de resposta `NextResponse.json`;
- envelopes legados `{ error: ... }` criados diretamente em novas rotas;
- `console.error`/`console.warn` ad hoc;
- logs próximos de Authorization/cookie.

## Pilotos migrados

- frontend: Error Boundaries e captura autenticada de erros globais;
- API: `POST /api/products`;
- job/integração: `POST /api/jobs/inter/cobrancas/reconcile`;
- ingestão: `POST /api/observability/client-errors`.

## Lote sensível de 2026-10-12

O primeiro lote priorizado depois dos pilotos migrou as escritas autenticadas
`POST /api/auth/last-login` e `POST /api/auth/password-changed`. Ambas agora usam
`secureRoute`, exigem usuário ativo, limitam a escrita ao documento do próprio
usuário e expõem apenas erros sanitizados.

O mesmo contrato cobre as superfícies do Inter alteradas no lote: recebimento de
cobranças, recebimento bancário, configuração administrativa do callback e o job
de reconciliação. Esses endpoints não devolvem `error.message` bruto; os callbacks
públicos tratam o conteúdo como sinal declarado pelo cliente e confirmam estados
financeiros pela API autenticada do provedor.

O lote é protegido por testes de origem e pelos ratchets de contratos de erro e
segurança. A baseline histórica continua representando backlog e não foi ampliada.

As demais superfícies permanecem backlog de migração. A baseline não as transforma em bugs confirmados nem autoriza alterar comportamento sem caracterização.
