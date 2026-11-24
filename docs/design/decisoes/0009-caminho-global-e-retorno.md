# 0009 · Caminho global e botão de retorno

**Status:** aprovada em 18/11/2026.

A faixa preta superior é o lugar do caminho da página nas páginas internas do Coala One web que têm a navegação global. Páginas sem essa faixa podem ter navegação própria. O corpo mantém o cabeçalho que faz sentido para a tarefa. O [PageHero](../cabecalho-e-etapas.md) pode reunir título, ações, indicadores e filtros em operações como Conciliação de vendas e Coala Signage. A composição `← seção › título` dentro do conteúdo deixa de ser a referência de navegação.

O botão de retorno tem fundo claro, borda cinza, sombra discreta e cantos arredondados. Na mesma peça, mostra uma seta para a esquerda e o destino explícito, como **← Painel do colaborador**. Um botão com destino nomeado leva à rota interna correspondente, com a seleção pertinente preservada. Por exemplo, o retorno da revisão diária pode levar ao calendário do mesmo mês, unidade e StoneCode.

A [faixa global atual](../../../src/components/header.tsx) já apresenta o caminho. A [tela de escala](../../../src/components/collaborator-schedule-page.tsx) usa o rótulo **Painel do colaborador** com [BackButton](../../../src/components/navigation/back-button.tsx), que ainda prioriza o histórico do navegador. A decisão estabelece o contrato para novos ajustes e não certifica as telas atuais. A implementação e a migração serão feitas separadamente.

Referências de aplicação: [Estrutura e navegação](../estrutura-e-navegacao.md) e [Botões](../botoes.md).
