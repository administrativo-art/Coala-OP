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

## Voltar

Use `BackButton` para voltar a uma página anterior. Ele combina seta, rótulo, histórico do navegador e destino seguro de fallback.

- Escreva o destino no rótulo: “Voltar às despesas”, por exemplo.
- Informe um `fallbackHref` interno e validado.
- Não crie um botão local apenas com texto quando o padrão compartilhado atender ao caso.
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
- O botão de cada cartão fica dentro do card da conta bancária correspondente.
- Importação e auditoria da fatura acontecem na página dedicada de cartões.
- Não incorpore a tela de fatura no fim da listagem do extrato bancário.
- A página de cartão deve oferecer a ação “Importar fatura” e a alternância entre cartões da conta.

## Estados visíveis de conciliação

A interface usa somente estes estados:

| Estado | Significado | Cor |
| --- | --- | --- |
| **Pendente** | Ainda exige conferência ou conciliação | Âmbar |
| **Conciliada** | O lançamento financeiro foi registrado e conciliado | Verde |
| **Ignorada** | Foi revisada e não deve gerar lançamento | Cinza |

O estado interno `audited` continua existindo para controlar o fluxo, mas aparece como **Pendente** até a conciliação. O estado interno `completed` aparece como **Conciliada**. Não exponha nomes técnicos nem estados intermediários como categorias paralelas.

## Progresso da conciliação bancária

O fluxo visível é `Importar → Auditar → Fechar`.

- “Auditar” só fica verde quando não houver itens internos `pending` ou `audited`.
- “Fechar” permanece bloqueado enquanto houver qualquer pendência.
- Cartões não aparecem como etapa do progresso bancário; são um fluxo relacionado e dedicado.
- O percentual considera resolvidos apenas itens conciliados (`completed`) ou ignorados.
- O resumo deve informar entradas, saídas, saldo, unidade e pendências perto da conta ativa.

## Hierarquia de ações

- Uma ação primária por contexto visual.
- Ações relacionadas a uma conta ficam dentro do card daquela conta.
- Ações destrutivas ou irreversíveis exigem confirmação.
- Botões desabilitados devem explicar o bloqueio por texto auxiliar ou `title`.
- Use verbos do domínio: “Conciliar”, “Ignorar”, “Fechar extrato” e “Importar fatura”.

## Cards, tabelas e filtros

- Cards de seleção usam borda, fundo e sombra discretos; o selecionado recebe destaque de borda e `aria-pressed`.
- Tabelas e listas devem manter cabeçalho, valor e estado em colunas previsíveis.
- Filtros de estado usam os mesmos nomes e cores da tabela.
- Não crie um filtro separado para um estado interno que é agrupado visualmente em outro.
- Resumos laterais podem ser movidos para o topo quando isso aproxima contexto e ação e libera largura para a listagem.

## Tipografia

A família global é `Inter Tight Variable`, com fallback para `Inter` e fontes do sistema. Uma página não deve declarar outra família localmente sem uma necessidade de produto documentada.

O módulo de Pessoal ainda possui uma compactação legada aplicada pelo layout. Páginas já revisadas devem usar `system-standard-page` no elemento raiz. Essa classe restaura a escala tipográfica comum sem alterar de uma vez as telas legadas que ainda precisam de revisão visual.

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
