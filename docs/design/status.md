# Status (`StatusPill`)

Altura 21px, padding 0 9px, raio 999, 11.5/700, `white-space: nowrap`.

| variant | Fundo | Texto | Exemplo | Regra |
|---|---|---|---|---|
| ok | #e8f5ee | #147337 | Vence em 156 dias / Ativo | Validade acima do limite de urgência |
| warn | #fff1e6 | #c2410c | Vence em 4 dia(s) / Vence hoje | 0 ≤ dias ≤ `product.urgentThreshold ?? 7` |
| danger | #ffe4e8 | #be123c | Vencido há 3 dia(s) | dias < 0 |
| neutral | #eceae5 | #5f646c | Validade indefinida / Desativado | Sem data, ou cadastro arquivado |
| info | #eef3fe | #1d4ed8 | Reserva · 24 | Lote com `reservedQuantity > 0` |

O status é só leitura na lista. A troca (ativar/desativar) acontece no painel ou no modal, onde os bloqueios são explicados.
