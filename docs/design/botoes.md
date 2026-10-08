# Botões

Variantes de `src/components/ui/button.tsx` (cva). As variantes do guia convivem com as antigas do shadcn: `secondary`, `ghost`, `link` e `outline` sem prefixo mantêm o comportamento legado. Nas composições do guia, use os nomes `ds-*` da tabela.

## Variantes
| `variant` no código | Fundo | Texto | Borda | Hover | Uso |
|---|---|---|---|---|---|
| `primary-page` | #d13670 + --ds-shadow-cta | #fff, 800 | — | #b8325f | Criar na página ("+ Adicionar lote") |
| `primary-modal` | #15151c | #fff, 800 | — | #2a2a35 | Salvar/avançar em modal e formulário |
| `ds-secondary` | #fff | --ds-ink, 700 | 1px #dcd9d1 | fundo #f6f4ef | Voltar, Editar, Imprimir etiqueta |
| `ds-ghost` | transparente | #5f646c, 700 | — | fundo #f0eee9, texto --ds-ink | Cancelar, fechar |
| `ds-link` | — | #a6325b, 700 | — | #8e294d + sublinhado | Mostrar/ocultar, selecionar todos |
| `danger-link` | — | #be123c, 700 | — | sublinhado | Excluir (abre confirmação) |
| `danger` | #be123c | #fff, 800 | — | escurece | Somente dentro da confirmação inline |
| `on-dark-secondary` | transparente | #f3f2ee, 700 | 1px rgba(255,255,255,.14) | fundo rgba(255,255,255,.06) | Botões no painel escuro |
| `on-dark-icon` | rgba(255,255,255,.08) | #c8c7d0 | — | rgba(255,255,255,.14) | Ícone dentro de campo (scanner) |

Todos com `white-space: nowrap`.

Os prefixos `ds-` preservam as variantes shadcn preexistentes `secondary`, `ghost` e `link`; o guia não altera a semântica dessas variantes legadas.

## Tamanhos
| size | Altura | Padding | Fonte | Raio |
|---|---|---|---|---|
| xl | 48px | 0 22px | 14 | 14 |
| lg | 44–46px | 0 22px | 13.5–14 | 12–14 |
| md | 42px | 0 16px | 13 | 12 |
| sm | 36–38px | 0 14px | 13 | 11 |
| xs | 30–32px | 0 12px | 12–12.5 | 9 |

48px no painel escuro · 44–46px no rodapé de modal · 42px nas ações do painel lateral · 36–38px em menus e cabeçalho · 30–32px em segmentados. Mínimo de 44px para toque em telas móveis.

## Regras de comportamento
- **Uma ação principal por área.** Página: rosa. Modal: escuro. Nunca dois preenchidos lado a lado.
- **Rótulo é verbo + objeto**: "Adicionar lote", "Salvar alterações", "Confirmar baixa". Evitar "OK" e "Enviar".
- **Ordem no rodapé**: Cancelar (`ds-ghost`) à esquerda; Voltar (`ds-secondary`) e o primário à direita, com o primário por último.
- **Destrutivo afastado**: Excluir nunca fica ao lado de Editar com o mesmo peso. Fica no fim do painel como danger-link.
- **Carregando**: rótulo "Salvando…", fundo #b9b8c2, `cursor: not-allowed`, bloqueia clique duplo.
- **Desabilitado explica**: se depende de permissão ou de dado faltando, mostrar o motivo perto do botão.
- **Hover**: preenchidos escurecem; contornados ganham fundo #f6f4ef; links sublinham. Botões não animam escala.
- **Menu ▾**: um aberto por vez; fecha ao escolher ou ao clicar fora.
