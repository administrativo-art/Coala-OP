# Painel lateral (`SidePanel`)

- 460px por padrão (máximo 100vw; ver exceções abaixo), entra pela direita, fundo #fffdf9, `--ds-shadow-side`. Véu `--ds-scrim`. Ocupa sempre toda a altura dinâmica da janela (`100dvh`); regras genéricas de altura máxima para dialogs não se aplicam ao `SidePanel`.
- Os cantos superior e inferior esquerdos usam raio de 20px (`rounded-l-[20px]`) e o conteúdo é recortado pelo contorno (`overflow-hidden`). O lado direito permanece reto e encostado na borda da janela. Essa geometria é obrigatória para todo drawer lateral derivado do `SidePanel`; não arredondar os quatro cantos.
- Fecha pelo ×, por clique no véu ou com **Esc**. O foco vai para o painel ao abrir e volta para a linha ao fechar.
- **Topo escuro** (#15151c, padding 22px 24px): kicker rosa (#f08bb1, 10.5/800 caixa alta) com o identificador, nome 20/800 e especificação 12.5 #a9a8b3; números principais em 26/800.
- **Corpo** (padding 20px 24px, gap 20):
  1. Dados em grade 2 colunas (kicker 10.5/800 #6e737a + valor 13/600).
  1b. Quando o painel tem mais de um assunto (ex.: unidade), cada assunto é um `PanelSection`: cartão branco com título em kicker (10.5/800, caixa alta) e, à direita, uma contagem ou apoio. Estrutura, Identificação, Integrações e Operação são o exemplo de Unidades.
  2. Ações em grade 2×2, botões `ds-secondary` tamanho `md`.
  3. Formulário inline quando uma ação rápida é aberta (ex.: baixa). Borda #f3c7d5, raio 16. O botão da ação fica em estado ativo (borda #d13670, fundo #fbe7ef).
  4. Histórico: lista em card, ponto verde (#16a34a) para entrada e rosa (#d13670) para saída, quantidade em mono.
  5. Excluir no rodapé (danger-link) → `InlineConfirm`.
- Ações rápidas abrem dentro do painel, sem empilhar outro modal. Edições completas podem usar drawer largo quando preservar o contexto da página for importante; nesse caso, dividir o formulário em abas e manter as ações em rodapé fixo.
- Bloqueios aparecem dentro do painel com o motivo ("há 3 lotes vinculados").

### Painel de detalhe com etapas (540px)

- Painéis de detalhe que mostram um trilho de etapas (ex.: **Formado → Travado → Boleto emitido → Pago** em Depósitos em dinheiro) usam 540px (`className="w-[540px]"`), mantendo `max-w-full` no mobile. A largura existe para o trilho caber em uma linha; não usar 540px só para acomodar mais campos.
- Ações de fluxo do item (ex.: Emitir/Reemitir boleto) ficam no rodapé fixo com `primary-modal`; ao acioná-las, o painel de detalhe fecha e o painel da ação abre, sem empilhar dois painéis.

### Drawer largo de edição

- Formulários extensos que partem de uma página de detalhe, como **Editar dados do colaborador**, podem usar até 920px e ocupam 100% da largura no mobile. A ampliação é horizontal apenas quando o formulário realmente exigir espaço; ela nunca substitui o alinhamento vertical obrigatório de topo a base.
- O conteúdo é dividido por assunto em abas; não apresentar todos os blocos numa única rolagem longa.
- Na edição de colaborador, Identificação agrupa dados pessoais e Dados contratuais (vínculo, admissão, cargo/função, datas calculadas da experiência e motivo/data efetiva). Jornada mantém turno e datas operacionais. Unidades mantém vigências de operação/escala, financeira, empregadora, quiosques atribuídos, responsabilidade e escopo; sua edição e histórico expandem inline no mesmo painel. Dados contratuais no perfil é somente informativo e oferece consulta à trilha. Jornada exige `dp.view`; Unidades também fica disponível para quem gerencia usuários.
- Campos que se confundem entre si recebem nota curta sob o campo dizendo o efeito de cada um; num seletor de modos, a nota muda conforme a opção escolhida.
- Cada aba mostra um ponto quando contém campo alterado (cor de destaque) ou com erro (cor de perigo), para que ninguém salve sem ver o que mudou em outra aba.
- Cada assunto mantém título, descrição curta e `InfoPopover` clicável com alcance e efeitos dos campos. Ajuda essencial não depende de *hover*.
- O rodapé de ações permanece visível durante a rolagem e informa se existem alterações pendentes.
- Fechar por ×, véu, `Esc` ou Cancelar exige confirmação quando houver alterações não salvas.
- A rota direta da edição deve continuar válida e abrir o mesmo drawer sobre a página de detalhe, sem manter uma segunda implementação do formulário.

## Abas internas e ajuda explicativa

Quando o drawer possuir opções equivalentes que alternam o conteúdo — como uma definição geral e várias regras do mesmo cadastro — usar um trilho de abas logo no início do corpo:

- trilho com largura disponível, fundo `--ds-surface-seg`, padding de 3px e raio `rounded-ds-md`;
- aba ativa branca, texto `--ds-ink` e sombra discreta; abas inativas transparentes com texto atenuado;
- uma opção por aba e somente o conteúdo da aba ativa renderizado no fluxo visual;
- itens repetíveis recebem rótulo singular e numeração por ponto médio: **Regra • 1**, **Regra • 2**, **Regra • 3**; não condensar esses itens em uma única aba como “Regras (3)”;
- criar um item acrescenta e seleciona imediatamente sua aba; remover renumera as seguintes e mantém uma aba existente selecionada;
- o trilho não quebra linha: usa rolagem horizontal quando as opções ultrapassarem a largura do drawer;
- as abas usam semântica de `tablist`/`tab`, foco visível e navegação por teclado.

Blocos configuráveis dentro dessas abas recebem um ícone de informação quando o significado, a combinação ou o efeito dos campos não for evidente. O clique ou toque abre `InfoPopover` com a explicação de cada campo e opção, seu alcance e as combinações permitidas. Ajuda essencial não pode depender de *hover*. Quando a regra pertence apenas ao item aberto, uma nota informativa no início do conteúdo declara explicitamente esse escopo.

## Baixa inline (Controle de Estoque)
Tipo em Segmented: Consumo/Venda · Descarte/Perda · Outros. Quantidade em embalagens, com "disponível" (quantidade − reserva) no rótulo. Validações: quantidade > 0; ≤ disponível; "Outros" exige observação. Confirmar chama `consumeFromLot`.

Ajuste de interface em 28/10/2026: todos os seletores de unidade ficam exclusivamente na aba Unidades. O quadro Como ler esta tela foi removido; cada tipo tem ícone InfoPopover com ajuda por clique/toque. Financeira e empregadora continuam sendo dados contratuais auditados; a justificativa fica disponível também na aba Unidades, sem mudar fontes ou regras. Gestores de usuários preservam acesso à aba mesmo sem visualização DP.
