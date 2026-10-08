# Confirmação e feedback

## `InlineConfirm` (destrutivo)
Linha com fundo #fff1f3, borda #fecdd6, raio 12, padding 12px 14px. Texto 12.5/600 #881337 com o nome do item: "Excluir o lote SJ-2409-118? Esta ação não pode ser desfeita." À direita: Cancelar (fundo #fff, borda #fecdd6) e Excluir (danger, 32px).

## Alertas
- **Atenção** (não bloqueia): fundo #fff7e6, borda #f5d9a3, texto #6b4500, raio 14, título 13/800 + descrição 12.5.
- **Informação**: fundo #eef3fe, borda #d7e2fb, texto #1e3a8a.

## Regras
- O destrutivo confirma no próprio lugar, com o botão vermelho à direita.
- Sucesso não precisa de toast quando a mudança já aparece na tela (quantidade atualizada, linha nova no histórico). Usar toast só para ações sem efeito visível (exportar, imprimir etiqueta).
- Código novo nunca usa `alert`, `confirm` ou `prompt`, inclusive formas qualificadas como `window.confirm`. O legado é migrado por fluxo; este PR mantém proteção estrita nos componentes do guia sem obrigar uma migração operacional.
