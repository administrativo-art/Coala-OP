# Design do Coala

Padrões visuais e de comportamento das telas operacionais. Guia vivo: `/dashboard/design`.

Este índice trata do sistema web. O aplicativo Android (Coala Go) tem paleta, componentes e regras próprios, descritos em [Aplicativo Coala Go](app.md).

## Princípios
- Um título por tela antes do primeiro item. Departamento vira menu; subseções ficam na mesma linha do título.
- Tudo que **filtra** a lista fica no painel escuro do topo. Tudo que **age** sobre um item fica no painel lateral.
- Uma ação principal por área.
- A navegação lateral é flutuante, recolhida por padrão e expande ao passar o cursor; o nome do sistema ("Coala One", "Coala Pulse") é a única parte animada da marca.
- O painel escuro do topo usa chips compactos e vira uma faixa fina quando a tela rola.
- Código novo não usa `alert()`, `confirm()` ou `prompt()`: erro fica junto do campo e confirmação é inline.
- Status é só leitura na lista; a troca acontece no painel ou no modal, com o motivo dos bloqueios.
- Toda data apresentada ao usuário segue o padrão brasileiro `DD/MM/AAAA`. ISO (`AAAA-MM-DD`) é formato interno e fica restrito a armazenamento, APIs e integrações; nunca deve aparecer em textos, trilhas, tabelas, painéis ou documentos visíveis.

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
- [Gerenciador de documentos](gerenciador-de-documentos.md)
- [Modais](modais.md)
- [Confirmação e feedback](feedback.md)
- [Movimento, marca e ícones](movimento-marca-e-icones.md)
- [Aplicativo Coala Go](app.md)
- [Decisões](decisoes/)
- [Estado atual × destino](estado-atual.md)
- [Validação visual](validacao-visual.md)

## Tema escuro

Decidido (27/10/2026): o sistema web segue a regra do Coala Go — claro das 06h às 17h59 e escuro das 18h às 05h59 pela hora do aparelho, sem chave manual. A regra é só visual. A paleta escura redefine os tokens `--ds-*` (e os do shadcn usados em diálogos) em `:root[data-ds-theme="dark"]`, com os valores de `Theme.kt` do app. Ela vale apenas nas telas que montam `<ScheduledDarkTheme />` (`src/components/theme/scheduled-dark-theme.tsx`): hoje, Registro de ponto e Painel do colaborador. Antes de ligar em outra tela, remova as cores fixas claras (`bg-white`, `text-gray-*`, hex) dela e dos painéis e diálogos que ela abre; a tela volta ao claro ao ser fechada.

## Checklist de PR
- [ ] Usei tokens e variantes existentes (sem hex solto no componente).
- [ ] Uma ação principal por área; rótulos no formato verbo + objeto.
- [ ] Ação destrutiva afastada e com confirmação inline.
- [ ] Erros em texto junto do campo; sem `alert`/`confirm`/`prompt` no código novo.
- [ ] Dropdowns removem a seta nativa e usam o chevron definido em [Campos](campos.md).
- [ ] Se migrei uma tela real, anexei capturas e preenchi `validacao-visual.md`.
- [ ] Linhas clicáveis usam `LiftRow` e abrem `SidePanel`.
- [ ] Estados de carregando, vazio e sem resultados tratados.
- [ ] Páginas de configuração com salvamento em lote mantêm a barra de alterações pendentes fixa durante a rolagem.
- [ ] Animações respeitam `prefers-reduced-motion` e não são o único sinal de estado.
- [ ] Detalhe de registro abre em painel lateral e o painel de topo encolhe ao rolar (inclusive em listas internas).
- [ ] Drawers laterais encostados à direita mantêm o lado direito reto e usam `rounded-l-[20px]` somente nos cantos esquerdo superior e inferior, com recorte do conteúdo.
- [ ] Datas visíveis usam `DD/MM/AAAA`, data e hora usam `DD/MM/AAAA, HH:mm`, e competências usam “mês de AAAA”; nenhum valor ISO ficou exposto na interface.
