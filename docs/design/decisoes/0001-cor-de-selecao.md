# 0001 · Cor de seleção: rosa ou índigo

**Status:** decidido · 07/10/2026

**Decisão:** páginas usam rosa para seleção (`--ds-accent-ink` #a6325b, `--ds-accent-soft` #fbe7ef, `--ds-accent-row` #fbf3f6). Dentro de modais, seleção e progresso usam índigo (`--ds-modal-accent` #5b5bd6, `--ds-modal-accent-soft` #eeeefc, `--ds-modal-accent-ink` #3f3fb0).

**Motivo:** o índigo marca o contexto de edição e separa visualmente a escolha dentro do formulário da ação principal rosa da página. Os protótipos de modal e as telas de lista seguem essa divisão.

**Abrange:** stepper, seleção de categoria/unidade, abas da ficha, estados selecionados e item atual de menu. O foco visível não segue a cor de seleção: é `--ds-accent-ink` em fundo claro e `--ds-accent-kicker-dark` em fundo escuro, inclusive dentro de modais.
