# ADR-002 — Depósitos de dinheiro como rota irmã de fechamentos

- **Status:** Aceito
- **Data:** Ago/2026
**Módulo:** Financeiro · Fechamentos e depósitos

---

## Contexto

Fechamentos apuram e aprovam o caixa de uma unidade. Depósitos administram a destinação posterior do numerário e podem acionar uma integração bancária. Embora relacionados, possuem ciclos de vida, responsabilidades, permissões e efeitos distintos.

## Decisão

Depósitos de dinheiro são rota irmã de fechamentos, não aba interna. As permissões de `cashClosures` e `cashDeposits` permanecem separadas. A fila de alocação considera o horário de aprovação. A aprovação do fechamento não emite cobrança automaticamente.

O fluxo esperado é:

```text
aprovação → elegibilidade → fila → ação explícita de emissão → integração bancária
```

Aprovar um fechamento e emitir uma cobrança são comandos distintos. O primeiro altera estado interno do domínio. O segundo produz efeito externo e deve possuir autorização, idempotência, retry, tratamento explícito de falha e auditoria próprios.

## Alternativas rejeitadas

### Aba dentro do fechamento

Rejeitada porque fechamento e depósito têm ciclos de vida, responsabilidades e permissões distintos. O fechamento apura e aprova o caixa; o depósito administra a destinação posterior do numerário. O vínculo existe no domínio, mas não justifica acoplar navegação ou autorização.

### Permissão única

Rejeitada para segregar quem concilia o fechamento de quem administra ou emite a cobrança relacionada ao depósito.

### Cobrança automática na aprovação

Rejeitada porque aprovar fechamento e emitir cobrança são comandos distintos. O primeiro altera estado de domínio; o segundo produz efeito externo e exige autorização, idempotência, retry, tratamento de indisponibilidade e auditoria próprios.

## Consequências

- Navegação e proteção de página permanecem independentes.
- A autorização deve ser validada no servidor para cada comando.
- Aprovação torna o valor elegível; não confirma emissão nem pagamento.
- Falhas bancárias permanecem observáveis e recuperáveis sem regredir o fechamento aprovado.

---

*ADR-002 · Financeiro · Ago/2026*
