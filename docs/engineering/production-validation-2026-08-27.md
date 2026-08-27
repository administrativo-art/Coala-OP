# Evidência operacional — promoção de 27/08/2026

Este registro consolida a validação já concluída antes da reintegração de observabilidade. A tarefa de observabilidade não repetiu rollout nem operação financeira.

## Fonte promovida

- `main`: `b24f44f700a554b188d2b158d4297f6a6c069b0a`
- `production`: merge `a0a76b198039e06b1be1894d1163435ebda218ed`
- tree comum: `388f180a59394bf0bf03adb9ead010e39bb8151d`
- revisão: `studio-build-2026-08-27-002`
- rollout: `rollout-2026-08-27-002`, estado observado `SUCCEEDED`, 100% do tráfego

A tree de `production` foi confirmada idêntica à tree previamente validada de `main`.

## Banco Inter

A execução natural de `/api/jobs/inter/statements/sync` foi observada em `2026-08-27T14:45:21.368862Z`:

- HTTP 200;
- duração aproximada de 45,24 s;
- sem retry de falha observado;
- sem nova ocorrência do erro de `undefined` em `auditHistory` na janela consultada.

Essa evidência confirma operacionalmente `FIN-INTER-STATEMENT-1` na revisão promovida. Ela não valida a fundação de observabilidade reintegrada posteriormente.

## Contrato de promoção

`main` é integração protegida. `production` é a fonte protegida acompanhada pelo App Hosting. Merge em `main` não autoriza deploy; promoção ocorre por PR explícito de SHA previamente validado para `production`.
