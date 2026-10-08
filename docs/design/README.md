# Design do Coala

Padrões visuais e de comportamento das telas operacionais. Guia vivo: `/dashboard/design`.

## Princípios
- Um título por tela antes do primeiro item. Departamento vira menu; subseções ficam na mesma linha do título.
- Tudo que **filtra** a lista fica no painel escuro do topo. Tudo que **age** sobre um item fica no painel lateral.
- Uma ação principal por área.
- A navegação lateral é flutuante, recolhida por padrão e expande ao passar o cursor; o nome do sistema ("Coala One", "Coala Pulse") é a única parte animada da marca.
- O painel escuro do topo usa chips compactos e vira uma faixa fina quando a tela rola.
- Código novo não usa `alert()`, `confirm()` ou `prompt()`: erro fica junto do campo e confirmação é inline.
- Status é só leitura na lista; a troca acontece no painel ou no modal, com o motivo dos bloqueios.

## Índice
- [Estrutura de página e navegação](estrutura-e-navegacao.md)
- [Barra lateral](barra-lateral.md)
- [Cabeçalho que encolhe, etapas e prévia no celular](cabecalho-e-etapas.md)
- [Tokens](tokens.md)
- [Botões](botoes.md)
- [Seleção e filtros](selecao-e-filtros.md)
- [Campos](campos.md)
- [Status](status.md)
- [Listas e linhas](listas.md)
- [Painel lateral](painel-lateral.md)
- [Modais](modais.md)
- [Confirmação e feedback](feedback.md)
- [Decisões](decisoes/)
- [Estado atual × destino](estado-atual.md)
- [Validação visual](validacao-visual.md)

## Checklist de PR
- [ ] Usei tokens e variantes existentes (sem hex solto no componente).
- [ ] Uma ação principal por área; rótulos no formato verbo + objeto.
- [ ] Ação destrutiva afastada e com confirmação inline.
- [ ] Erros em texto junto do campo; sem `alert`/`confirm`/`prompt` no código novo.
- [ ] Se migrei uma tela real, anexei capturas e preenchi `validacao-visual.md`.
- [ ] Linhas clicáveis usam `LiftRow` e abrem `SidePanel`.
- [ ] Estados de carregando, vazio e sem resultados tratados.
- [ ] Animações respeitam `prefers-reduced-motion` e não são o único sinal de estado.
- [ ] Detalhe de registro abre em painel lateral e o painel de topo encolhe ao rolar (inclusive em listas internas).
