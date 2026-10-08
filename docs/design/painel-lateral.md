# Painel lateral (`SidePanel`)

- 460px (máximo 100vw), entra pela direita, fundo #fffdf9, `--ds-shadow-side`. Véu `--ds-scrim`.
- Fecha pelo ×, por clique no véu ou com **Esc**. O foco vai para o painel ao abrir e volta para a linha ao fechar.
- **Topo escuro** (#15151c, padding 22px 24px): kicker rosa (#f08bb1, 10.5/800 caixa alta) com o identificador, nome 20/800 e especificação 12.5 #a9a8b3; números principais em 26/800.
- **Corpo** (padding 20px 24px, gap 20):
  1. Dados em grade 2 colunas (kicker 10.5/800 #6e737a + valor 13/600).
  2. Ações em grade 2×2, botões `ds-secondary` tamanho `md`.
  3. Formulário inline quando uma ação rápida é aberta (ex.: baixa). Borda #f3c7d5, raio 16. O botão da ação fica em estado ativo (borda #d13670, fundo #fbe7ef).
  4. Histórico: lista em card, ponto verde (#16a34a) para entrada e rosa (#d13670) para saída, quantidade em mono.
  5. Excluir no rodapé (danger-link) → `InlineConfirm`.
- Ações rápidas abrem dentro do painel, sem empilhar outro modal. A edição completa abre o modal.
- Bloqueios aparecem dentro do painel com o motivo ("há 3 lotes vinculados").

## Baixa inline (Controle de Estoque)
Tipo em Segmented: Consumo/Venda · Descarte/Perda · Outros. Quantidade em embalagens, com "disponível" (quantidade − reserva) no rótulo. Validações: quantidade > 0; ≤ disponível; "Outros" exige observação. Confirmar chama `consumeFromLot`.
