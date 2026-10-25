# 0006 · Cor dos alertas em cartões de dia

**Status:** decidido · 19/10/2026

**Decisão:** cartões de dia com alerta de atenção (ex.: saída depois do previsto, intervalo longo) usam o tratamento "mostarda suave": fundo `--ds-caution-bg` (#fffbeb), borda `--ds-caution-border` (#fde68a), bloco da data `--ds-caution-tile` (#fef3c7) com texto `--ds-caution-tile-ink` (#92400e) e textos de atenção em `--ds-caution` (#b45309). Alertas de problema (dia sem batida, batida faltando, intervalo curto) usam o mesmo tratamento em rosado: `--ds-trouble-bg` (#fff5f7) e `--ds-trouble-border` (#fecdd6), com o bloco da data em `--ds-danger-bg`/`--ds-danger`. Não há faixa lateral colorida; o dia de hoje é marcado só pelo bloco da data em `--ds-info`.

**Motivo:** escolhido pelo programador entre seis opções comparadas na maquete do Registro de ponto. A cor de fundo leve separa cada dia sem transformar a lista em faixas de cor, e o laranja `--ds-warn` (#c2410c) lia como erro.

**Abrange:** lista de dias do Registro de ponto. `StatusPill` continua com as variantes de [status](../status.md); estender a outras listas exige nova decisão.
