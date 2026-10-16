# Confirmação e feedback

## `InlineConfirm` (destrutivo)
Linha com fundo #fff1f3, borda #fecdd6, raio 12, padding 12px 14px. Texto 12.5/600 #881337 com o nome do item: "Excluir o lote SJ-2409-118? Esta ação não pode ser desfeita." À direita: Cancelar (fundo #fff, borda #fecdd6) e Excluir (danger, 32px).

## Alertas
- **Atenção** (não bloqueia): fundo #fff7e6, borda #f5d9a3, texto #6b4500, raio 14, título 13/800 + descrição 12.5.
- **Informação**: fundo #eef3fe, borda #d7e2fb, texto #1e3a8a.

## Barra de alterações pendentes

Use este padrão somente em páginas de configuração extensas nas quais o usuário pode alterar vários itens antes de confirmar tudo de uma vez.

- A barra aparece apenas quando o estado da página está `dirty` e desaparece depois de salvar ou descartar.
- Ela fica `fixed` no rodapé da janela e acompanha toda a rolagem; não deve morar no final do conteúdo nem depender de o usuário chegar ao fim da página.
- O conteúdo reserva espaço inferior enquanto a barra estiver aberta para que ela não cubra o último campo.
- Em telas largas, fica centralizada e com largura ajustada ao conteúdo. Em telas pequenas, respeita 12px de margem lateral e `safe-area-inset-bottom`.
- Estrutura: indicador âmbar + “Você tem alterações não salvas” + ação secundária “Descartar” + ação primária “Salvar alterações”.
- A barra não substitui validações de campo. Erros continuam junto do campo e o salvamento mantém a barra aberta enquanto houver pendências.
- Use `z-index` suficiente para ficar acima do conteúdo comum, mas abaixo de diálogos, painéis de confirmação e outros overlays.
- Não reutilizar este padrão para seleção em massa: barras de lote exibem quantidade selecionada e seguem o contrato descrito em [Listas e linhas](listas.md).

## Regras
- O destrutivo confirma no próprio lugar, com o botão vermelho à direita.
- Sucesso não precisa de toast quando a mudança já aparece na tela (quantidade atualizada, linha nova no histórico). Usar toast só para ações sem efeito visível (exportar, imprimir etiqueta).
- Código novo nunca usa `alert`, `confirm` ou `prompt`, inclusive formas qualificadas como `window.confirm`. O legado é migrado por fluxo; este PR mantém proteção estrita nos componentes do guia sem obrigar uma migração operacional.
