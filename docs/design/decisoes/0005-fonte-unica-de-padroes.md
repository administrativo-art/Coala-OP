# 0005 · Fonte única de padrões de interface

**Status:** adotada por delegação do desenvolvedor ("pode continuar") · 08/10/2026 — revisar ao fim

**Contexto:** existem duas implementações do mesmo visual. O guia (`src/components/patterns/`, tokens `--ds-*`) e o kit de Cadastros (`src/components/cadastros/cadastros-ui.tsx`, cores em hex). O mapa está em `../unificacao-cadastros-guia.md`.

**Proposta:** o guia é a fonte única. Código novo usa `patterns/` e tokens `--ds-*`. Cada peça do kit é substituída, absorvida pelo guia ou mantida como composição de Cadastros. Nenhuma peça do kit é removida antes de a equivalente do guia estar testada.

**Pendente de decisão:** os cinco pontos de "Diferenças que exigem decisão" do mapa.

**Decisão:** o guia v4 vence nos cinco pontos do mapa. Cadastros passou a usar `--ds-accent` (#d13670) na ação principal, chip ativo rosa, `SidePanel` de 460px, `StatusPill` na lista e `BulkBar`/`SelectBox` absorvidos em `patterns/`. A decisão foi tomada pela sessão sob delegação, sem confirmação ponto a ponto; se algum ponto deve voltar ao visual anterior, reabra aqui.
