# Guia de design do Coala One

Este documento registra os padrões compartilhados de interface do sistema. O objetivo é manter a mesma hierarquia, linguagem e comportamento entre módulos, mesmo quando os fluxos tratam objetos de negócio diferentes.

## Princípios

- Reutilize o mesmo componente para o mesmo padrão de interação.
- Use a linguagem do negócio na interface. Nomes técnicos e estados internos não devem aparecer para o usuário.
- Cor reforça o texto, mas nunca substitui o rótulo ou a explicação.
- Posicione uma ação perto do objeto que ela afeta.
- Mostre no progresso somente etapas reconhecíveis pelo usuário.
- Verde significa conclusão real; não use verde para uma etapa intermediária.

## Estrutura canônica de página

- Use `PageContainer` para largura e alinhamento do conteúdo.
- Use `PageHeader` para título, descrição e ações do topo.
- O título padrão usa `text-2xl`, peso `bold` e `tracking-tight`.
- A descrição usa o tamanho-base e `text-muted-foreground`.
- Ações primárias e secundárias ficam na propriedade `actions` do `PageHeader`.
- Não crie um card ou uma faixa vazia apenas para abrigar uma ação do cabeçalho.

## Amplitude e largura

Use as variantes de `PageContainer`; não declare um `max-width` concorrente dentro do workspace.

- Fluxos operacionais amplos, com tabelas, conciliação ou múltiplas colunas, usam `PageContainer variant="wide"` (`max-w-[1600px]`).
- Extratos bancários e Faturas de cartão usam a mesma variante `wide` e os mesmos recuos externos.
- Quando o fluxo usar uma superfície elevada sobre o fundo global, ative `PageContainer surface` nas páginas relacionadas para manter o mesmo fundo suave, raio e sombra.
- Não envolva uma página ampla em outro painel arredondado com largura menor: aplique borda, fundo e sombra somente aos cards internos.
- Variantes `compact` e `default` só devem ser usadas quando a densidade e o conteúdo justificarem uma área menor.
- Páginas relacionadas devem conservar a mesma amplitude para evitar saltos visuais durante a navegação.

## Voltar

Use a opção `back` de `PageHeader` nas páginas internas. Ela combina o `BackButton` quadrado somente com seta e o breadcrumb `seção anterior › página atual`, além do histórico do navegador e de um destino seguro de fallback.

- O botão de retorno é `iconOnly`; o destino aparece como primeiro item textual do breadcrumb.
- Informe um `ariaLabel` descritivo, como “Voltar para Despesas”.
- Informe um `fallbackHref` interno e validado.
- Não posicione um botão grande “Voltar” entre as ações do lado direito.
- Não crie um botão local quando `PageHeader` e `BackButton` atenderem ao caso.
- Parâmetros `returnTo` devem aceitar apenas rotas internas previstas pelo fluxo.

## Competência

Use `FinancialCompetenceNavigator` nos fluxos financeiros que alternam mês.

- O rótulo usa o formato “Setembro | 2026”.
- O ícone de calendário faz parte da identificação do componente.
- Os controles exibem “Anterior” e “Próxima”, além das setas.
- Um resumo opcional pode informar quantidade de contas ou movimentações.
- Desabilite a navegação somente quando não houver competência adjacente.

## Alternância entre entidades

Quando uma competência possui mais de uma conta, cartão ou entidade equivalente:

- apresente uma opção por card ou botão de seleção;
- mostre nome e identificador útil, como os quatro últimos dígitos;
- marque a opção ativa com `aria-pressed` e diferenciação visual;
- preserve competência e contexto da conta ao alternar;
- permita quebra responsiva, sem transformar opções em uma sequência escondida.

No fluxo de cartões, a página dedicada mostra todos os cartões da conta selecionada. O cartão indicado pela URL inicia ativo; os demais permanecem disponíveis para troca.

## Extratos bancários e faturas de cartão

- O extrato bancário reúne seleção de conta, progresso, auditoria e fechamento.
- O card da conta exibe um único botão “Conciliar cartão”. Ele abre um seletor com nome e final de todos os cartões vinculados, evitando rótulos truncados e mantendo a troca compreensível quando houver mais de um.
- Em largura de desktop, o card da conta ativa e o resumo de conciliação ficam lado a lado.
- O cabeçalho do extrato expõe somente a ação “Importar extrato”; formato e conta são informados no diálogo aberto por ela.
- Cada card de extrato contém sua própria ação “Fechar extrato”; não use um fechamento global distante da conta afetada.
- Importação e conciliação da fatura acontecem na página dedicada de cartões.
- Não incorpore a tela de fatura no fim da listagem do extrato bancário.
- A página de cartão deve oferecer a ação “Importar fatura” e a alternância entre cartões da conta.

## Estados visíveis de conciliação

A interface usa somente estes estados:

| Estado | Significado | Cor |
| --- | --- | --- |
| **Pendente** | Ainda exige revisão ou conciliação | Âmbar |
| **Conciliada** | O lançamento financeiro foi registrado e conciliado | Verde |
| **Ignorada** | Foi revisada e não deve gerar lançamento | Cinza |

O estado interno `audited` continua existindo para controlar o fluxo, mas aparece como **Pendente** até a conciliação. O estado interno `completed` aparece como **Conciliada**. Não exponha nomes técnicos nem estados intermediários como categorias paralelas.

## Progresso da conciliação bancária

O fluxo visível é `Importar → Auditar → Fechar`.

- “Auditar” só fica verde quando não houver itens internos `pending` ou `audited`.
- A etapa “Auditar” mostra `pendentes/total`, por exemplo `1/76`, sem repetir um painel de progresso no resumo.
- “Fechar” permanece bloqueado enquanto houver qualquer pendência.
- Cartões não aparecem como etapa do progresso bancário; são um fluxo relacionado e dedicado.
- O percentual considera resolvidos apenas itens conciliados (`completed`) ou ignorados.
- O resumo deve informar entradas, saídas, saldo e unidade perto da conta ativa.

## Progresso das faturas de cartão

O fluxo visível é `Importar → Conciliar → Fechar → Pagamento`.

- “Conciliar” reúne a revisão dos dados e a conciliação das cobranças em uma única etapa visível.
- Itens internos `pending` e `audited` aparecem juntos como **Pendentes**.
- Somente itens efetivamente reconciliados aparecem como **Conciliadas**.
- “Pagamento” representa a conciliação da saída bancária após o fechamento da fatura.

## Hierarquia de ações

- Uma ação primária por contexto visual.
- Ações relacionadas a uma conta ficam dentro do card daquela conta.
- Ações destrutivas ou irreversíveis exigem confirmação.
- Botões desabilitados devem explicar o bloqueio por texto auxiliar ou `title`.
- Use verbos do domínio: “Conciliar”, “Ignorar”, “Fechar extrato” e “Importar fatura”.

## Botões do cabeçalho

Use sempre o componente `Button` dentro de `PageHeader.actions`.

- A ação primária usa fundo rosa, texto branco, ícone à esquerda e peso forte.
- A ação secundária usa fundo branco, borda cinza, texto escuro e ícone à esquerda.
- A altura canônica compacta é `h-9`, com `rounded-[11px]`, texto de `13px` e `font-extrabold`.
- Mantenha ações relacionadas lado a lado, com a secundária antes da primária.
- Um cabeçalho pode ter uma única ação primária; opções e campos necessários à execução devem abrir em diálogo quando não precisarem permanecer visíveis.

## Cards, tabelas e filtros

- Cards de seleção usam borda, fundo e sombra discretos; o selecionado recebe destaque de borda e `aria-pressed`.
- Tabelas e listas devem manter cabeçalho, valor e estado em colunas previsíveis.
- Filtros de estado usam os mesmos nomes e cores da tabela.
- Não crie um filtro separado para um estado interno que é agrupado visualmente em outro.
- Resumos laterais podem ser movidos para o topo quando isso aproxima contexto e ação e libera largura para a listagem.

## Fatos rápidos em listas densas

- Informações secundárias longas podem usar um controle compacto com ícone e popover quando permanecerem acessíveis por hover, foco e toque.
- Ícone sem texto visível deve ter nome acessível; o detalhe não pode depender de `title` nativo nem somente de hover.
- Ações de cópia precisam de feedback de sucesso ou falha. Atalhos por botão direito são complementares e devem ter alternativa explícita no popover para teclado e dispositivos móveis.
- Controles somente de consulta não devem sugerir cópia ou edição. Quantidade e natureza do conteúdo, como `5 turnos`, devem continuar visíveis antes da abertura.
- Resumos operacionais que afetam a leitura diária, como funcionamento, permanecem visíveis e podem agrupar intervalos consecutivos; não devem ser truncados a ponto de omitir dias ou exceções.

## Tipografia

A família global é `Inter Tight Variable`, com fallback para `Inter` e fontes do sistema. Uma página não deve declarar outra família localmente sem uma necessidade de produto documentada.

No módulo Financeiro, `PageContainer surface` aplica a classe `financial-page-surface` e estabelece a escala do Extrato bancário como referência:

- texto-base em `14px`, com altura de linha de `20px`;
- título de página-raiz em `24px`, `font-bold` e `tracking-tight`;
- título no breadcrumb de uma página interna em `18px`, controlado por `PageHeader.back`;
- páginas financeiras densas que precisem manter a mesma escala compacta do Extrato podem usar `PageHeader titleSize="compact"`, com título em `18px`, mesmo sem breadcrumb;
- descrição em `14px` e `text-muted-foreground`;
- marcador de seção em `11px`, caixa alta e espaçamento entre letras;
- não use `font-black` nem tamanhos arbitrários para títulos de página.

Campos e controles dentro da superfície financeira herdam a mesma família tipográfica. Valores tabulares podem usar `font-mono`, pois constituem uma exceção semântica.

O módulo de Pessoal ainda possui uma compactação legada aplicada pelo layout. Páginas já revisadas devem usar `system-standard-page` no elemento raiz. Essa classe restaura a escala tipográfica comum sem alterar de uma vez as telas legadas que ainda precisam de revisão visual.

## Navegação entre páginas financeiras

- Itens permanentes do módulo ficam na sidebar; não repita a sidebar como abas grandes dentro do conteúdo.
- “Fechamento de caixa” e “Depósitos” são entradas irmãs na sidebar, nessa ordem.
- Páginas internas usam `PageHeader.back`; não exibem atalhos para módulos irmãos durante uma tarefa.
- Abas dentro do conteúdo são reservadas para alternar visões do mesmo objeto, não para navegar entre páginas independentes.

### Depósitos

- É uma página-raiz da sidebar: não repete o breadcrumb “Financeiro › Depósitos em dinheiro” dentro do conteúdo.
- Usa `PageContainer variant="wide" surface`, a mesma amplitude e superfície do Extrato bancário.
- Usa `PageHeader titleSize="compact"` com ações secundárias de `h-9`.
- A faixa escura de indicadores é uma exceção visual intencional; tipografia e espaçamento internos continuam seguindo os tokens do Financeiro.
- Avisos ocupam a largura disponível e permitem quebra de linha; não trunque mensagens operacionais.

### Orçamento × despesas

- É uma consulta contextual de **Despesas**, não uma entrada própria da sidebar.
- O acesso parte da página de Despesas e a rota mantém **Despesas** selecionado no menu.
- Usa `PageContainer variant="wide" surface` e `PageHeader.back`, com retorno identificado como “Despesas”.
- Filtros, indicadores e estados vazios ficam em cards claros, com os mesmos raios, tipografia e espaçamento da superfície financeira.

### Ações de Despesas

- O cabeçalho de Despesas não repete o acesso geral a Faturas de cartão, que já possui entrada própria em “Conciliação e fechamento”.
- Despesas não exibe um seletor interno “Despesas / Extratos bancários”; Extratos bancários usa sua entrada própria em “Conciliação e fechamento”.
- “Novo lançamento” abre o grupo de ações e usa o tratamento primário rosa.
- O botão expansível `☰ Ações` aparece depois do lançamento e reúne “Cobranças recebidas”, “Autorizações bancárias”, “Orçamento × despesas” e “Importar extrato”.
- Vínculos contextuais entre uma despesa de cartão e sua fatura podem permanecer nos respectivos registros.
- O card “Pendente auditoria” é um filtro da listagem atual: altera somente o status e preserva todos os demais filtros aplicados.
- Não existe uma página dedicada de pendências; a rota legada redireciona para Despesas com `status=pending_audit`.
- Os três indicadores exibem o intervalo efetivo do filtro de vencimento; sem intervalo ou competência, mostram “Todo o histórico”.
- A faixa de indicadores é um único painel, com o período exibido uma única vez no cabeçalho. O corpo usa três colunas: “Total do período”, “A pagar no período” e “Pendente auditoria”. O total fecha exatamente em `Pago + A pagar` e sua composição usa quatro parcelas mutuamente exclusivas: pago, lançamentos ainda a pagar, provisões já conciliadas ainda a pagar e pendências de auditoria. Provisões ainda não conciliadas e orçamento não entram nessa soma.
- A barra da listagem oferece “Limpar filtros”; a ação restaura os seletores para “Todos” e o vencimento para o mês atual, que é o recorte inicial de Despesas.
- No seletor personalizado de vencimento, o título do calendário é interativo: clicar no nome do mês seleciona do primeiro ao último dia do mês visível; “Aplicar” confirma o intervalo.
- Os cabeçalhos semanais da listagem usam colunas fixas para semana, intervalo, quantidade e total; variações no número de caracteres não deslocam os valores entre linhas.
- A divisão semanal acompanha um período de vencimento ou uma competência selecionada, mesmo quando o outro filtro estiver em “Todas”.

### Painel financeiro

- Usa `PageContainer variant="wide" surface` e `PageHeader`, seguindo a amplitude e a tipografia do Extrato bancário.
- Não repete em cards os destinos permanentes já disponíveis na sidebar.
- Indicadores, seções de despesas e unidades usam cards claros com raio de `18px`, borda discreta e sombra leve.
- Filtros usam controles compactos de `h-9` e raio de `11px`; listas internas usam raio de `12px`.

## Diálogos operacionais

- O diálogo deve respeitar a viewport com largura e altura máximas, sem aumentar por causa do tamanho intrínseco dos filhos.
- Conteúdo extenso rola dentro do diálogo; a página ao fundo permanece estável.
- Passos de orientação usam grade responsiva em telas largas e rolagem horizontal controlada em telas estreitas.
- Título de diálogo usa `18px` e peso `bold`; descrição usa `14px` e altura de linha de `20px`.

## Acessibilidade

- Todo controle precisa de nome acessível.
- Ícones decorativos usam `aria-hidden="true"`.
- Seletores expõem o estado com `aria-pressed` ou o atributo semântico equivalente.
- Estado não pode depender apenas da cor.
- Mantenha foco visível e ordem de teclado coerente.

## Migração de telas

Ao consolidar uma tela existente:

1. substituir cabeçalhos locais por `PageHeader`;
2. confirmar a variante correta de `PageContainer`;
3. substituir botões de retorno locais por `BackButton`;
4. reutilizar o navegador de competência quando aplicável;
5. alinhar estados e verbos à linguagem do negócio;
6. conferir desktop e largura reduzida;
7. preservar componentes compartilhados para cards, botões, campos, badges e diálogos;
8. adicionar um teste de contrato para os elementos estruturais adotados.

## Checklist de revisão

- A tela reutiliza os componentes canônicos existentes?
- Rótulos e estados são compreensíveis sem conhecer a implementação?
- Verde representa algo realmente concluído?
- Voltar tem destino seguro?
- A competência segue o padrão compartilhado?
- Alternância entre contas ou cartões está visível e acessível?
- A ação principal está próxima do seu contexto?
- O fluxo funciona em largura reduzida e por teclado?

As telas de Despesas, Extratos bancários, Faturas de cartão e Férias são referências da padronização atual.
