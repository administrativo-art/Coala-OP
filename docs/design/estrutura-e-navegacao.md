# Estrutura de página e navegação

Destino arquitetural das telas internas. Este documento orienta migrações futuras; o PR do guia não altera os componentes de layout nem telas operacionais.

## Fundo e largura

O destino visual usa `--ds-bg-page` (#f0eee9) atrás do conteúdo e dos modais. Cards usam `--ds-surface`; formulários de modal usam `--ds-surface-input`.

| Variante de `PageContainer` | Máximo | Uso pretendido |
|---|---:|---|
| `compact` | 1220px | formulários e fluxos lineares |
| `default` | 1440px | páginas comuns |
| `wide` | 1600px | listas, relatórios e tabelas densas |
| `fluid` | sem limite | superfícies espaciais justificadas |

Adotar `PageContainer` em toda página interna é objetivo de longo prazo, não critério deste PR. A prop `surface` ainda existe e só pode ser removida quando todos os consumidores forem migrados e testados.

## Cabeçalho e retorno

Nas páginas internas com a navegação global, o caminho da página (breadcrumb) aparece somente na [faixa preta superior](../../src/components/header.tsx). O corpo começa com o cabeçalho que serve à tela: título simples ou painel contextual com ações, indicadores e filtros. Preserve a hierarquia do [PageHero](cabecalho-e-etapas.md) quando o título faz parte do painel da operação. A composição de corpo `← seção › título` de telas existentes, como **Entenda a meta**, deixa de ser referência para novas telas.

Quando houver um destino de retorno, coloque o [botão com o nome do destino](botoes.md#voltar-para-um-destino) junto ao início do conteúdo. O caminho global continua na faixa preta. Páginas externas sem a faixa global têm navegação própria quando necessário. Uma navegação interna ao conteúdo, como pastas virtuais de um acervo, continua descrevendo o recorte em que a pessoa está trabalhando.

O destino nomeado deve ser explícito e interno. Use a rota correspondente ao rótulo e preserve a seleção que faz sentido para o retorno, como mês, unidade e StoneCode ao sair de uma revisão diária. Em entradas diretas, o botão deve levar ao mesmo destino rotulado. O tamanho do histórico do navegador não prova a origem e não deve decidir o destino desse botão.

A [decisão 0009](decisoes/0009-caminho-global-e-retorno.md) substitui a orientação anterior de ícone quadrado e caminho no corpo. A migração de componentes e telas será tratada em trabalho próprio.

## Painel de controle

Telas de lista usam uma casca escura com contexto, indicadores ou abas, busca, filtros, ações e chips. Tudo que filtra a lista fica no painel; ações sobre um item ficam no `SidePanel`.

O painel escuro de controle não projeta sombra sobre o conteúdo abaixo. A separação vem do contraste entre o fundo escuro e o fundo da página. Ao encontrar a faixa cinza difusa sob um painel, confira a classe do componente `ControlPanel` e remova `shadow-ds-panel` ou outra classe de `box-shadow` aplicada ao próprio painel; não compense com margens, overlays ou uma cor artificial no conteúdo seguinte. Essa regra não altera as sombras da navegação lateral, do cabeçalho ou dos modais.

O guia entrega `ControlPanel` e `ControlIndicator` isolados. `ControlIndicator` recebe `tone` semântico, nunca uma cor hexadecimal. Unificar esse componente com implementações operacionais requer uma migração separada.

## Abas de contexto

Abas que trocam a seção ou o tipo de cadastro pertencem à faixa clara de navegação, acima do conteúdo. Elas não ficam dentro do `ControlPanel`: o painel escuro é reservado ao contexto da aba ativa, indicadores, busca, filtros e ações. O estado ativo usa superfície branca e sombra discreta; as demais opções permanecem transparentes. Contagens podem acompanhar o rótulo de forma secundária, sem transformar a aba em indicador de destaque.

Em editores com uma definição principal e regras repetíveis, cada regra ocupa uma aba própria no mesmo trilho: **Definição**, **Regra • 1**, **Regra • 2** e assim por diante. Somente a regra ativa aparece no conteúdo. Criar uma regra acrescenta e seleciona imediatamente sua nova aba; remover uma regra renumera as posteriores e mantém uma aba válida selecionada. O trilho permite rolagem horizontal quando não couber no painel. Em drawers, aplicar o contrato visual, interativo e de ajuda contextual descrito em [painel-lateral.md](painel-lateral.md#abas-internas-e-ajuda-explicativa).

## Barra lateral e cabeçalho que encolhe

A navegação lateral (Coala One e Coala Pulse) e o painel escuro que vira faixa ao rolar estão em [barra-lateral.md](barra-lateral.md) e [cabecalho-e-etapas.md](cabecalho-e-etapas.md). O layout do dashboard reserva 88px à esquerda (trilho de 76px + margem); a barra expandida flutua por cima.

## Índice lateral de páginas extensas

Páginas de detalhe com muitas seções, como o perfil do colaborador, usam um índice local em card branco, separado da navegação global. Em telas largas, o card permanece fixo durante a rolagem até o fim de todas as seções que ele referencia, inclusive blocos sistêmicos posteriores aos campos cadastrais. O contêiner do índice e todo o conteúdo referenciado devem, portanto, compartilhar o mesmo layout estrutural. O card tem largura suficiente para rótulos em até duas linhas e destaca a seção atualmente visível. Não truncar nomes que diferenciam seções.

Os links são agrupados por domínio — por exemplo, cadastro, financeiro e benefícios, operação e acessos, saúde e jornada — e apresentam um indicador pequeno com significado objetivo: proporção de campos preenchidos nas seções cadastrais ou nível de visibilidade nas seções sistêmicas. Em telas estreitas, o mesmo índice se transforma em uma faixa horizontal rolável; os títulos dos grupos podem ser omitidos, mas os nomes e indicadores continuam disponíveis.

## Hierarquia de ações

- uma ação principal por área;
- página: `primary-page`; modal: `primary-modal`;
- ações secundárias do guia: `ds-secondary`, `ds-ghost` e `ds-link`;
- destrutivo no fim do contexto e protegido por `InlineConfirm`;
- estado desabilitado explica o motivo.

## Status e progresso

Status visível informa se a pessoa ainda precisa agir. Verde significa conclusão real. Estados intermediários revisados mas não efetivados continuam pendentes; estados fora do fluxo usam `neutral`.

Fluxos em etapas podem usar a linguagem do `WizardModal`, mas o servidor deve revalidar qualquer condição de bloqueio. Compartilhar aparência não transfere regra de negócio para a interface.

## Acessibilidade

- controles têm nome acessível e foco visível;
- segmentados suportam setas, Home e End;
- linha clicável pura não contém controles interativos;
- linha com ações usa `LiftRow interactive={false}` e oferece um botão explícito para abrir o item;
- confirmações inline recebem foco inicial e devolvem foco ao acionador;
- painéis e modais usam Radix Dialog e respeitam Esc;
- movimento respeita `prefers-reduced-motion`;
- erro é ligado ao campo e anunciado, nunca exibido por diálogo nativo.
