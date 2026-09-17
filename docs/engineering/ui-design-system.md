# Sistema visual da aplicação

Este documento registra a base compartilhada para evitar diferenças de hierarquia entre módulos como Financeiro e Pessoal.

## Estrutura canônica de página

- Use `PageContainer` para largura e alinhamento do conteúdo.
- Use `PageHeader` para título, descrição e ações do topo.
- O título padrão usa `text-2xl`, peso `bold` e `tracking-tight`.
- A descrição usa o tamanho-base e `text-muted-foreground`.
- Ações primárias e secundárias ficam na propriedade `actions` do `PageHeader`.

## Tipografia

A família global é `Inter Tight Variable`, com fallback para `Inter` e fontes do sistema. Uma página não deve declarar outra família localmente sem uma necessidade de produto documentada.

O módulo de Pessoal ainda possui uma compactação legada aplicada pelo layout. Páginas já revisadas devem usar `system-standard-page` no elemento raiz. Essa classe restaura a escala tipográfica comum sem alterar de uma vez as telas legadas que ainda precisam de revisão visual.

## Migração de telas

Ao consolidar uma tela existente:

1. substituir cabeçalhos locais por `PageHeader`;
2. confirmar a variante correta de `PageContainer`;
3. aplicar `system-standard-page` quando a tela estiver sob a compactação legada de Pessoal;
4. conferir desktop e largura reduzida;
5. preservar componentes compartilhados para cards, botões, campos, badges e diálogos;
6. adicionar um teste de contrato para os elementos estruturais adotados.

As telas de Despesas e Férias são as referências iniciais dessa padronização.
