# Design do aplicativo Coala Go

Padrões visuais e de comportamento do aplicativo Android nativo (`apps/coala-one-android`, pacote `coalaone.go`, Kotlin + Jetpack Compose, Android 8/API 26 em diante). Os demais arquivos desta pasta tratam do sistema web; **este é o único que vale para o aplicativo**.

O aplicativo não usa os tokens `--ds-*` nem os componentes React do web. Ele tem paleta, tipografia e componentes próprios, derivados do protótipo `Coala One App - Prototipo`. Onde o protótipo e o sistema real divergem, valem os limites e estados reais (ver [README do app](../../apps/coala-one-android/README.md)).

## Como ler este guia

Cada trecho traz uma destas três marcas:

- **Decidido** — é regra. Alguém decidiu, código novo segue, e há um teste ou um componente único que impede a regra de se perder.
- **Como está hoje** — é só o retrato do código em 2026-10-14 (base 0.3.8). Ninguém decidiu que deve ser assim; está aqui para você saber o que existe e manter a consistência. Se quiser que vire regra, é uma decisão a tomar.
- **Fora do padrão** — trecho do código que contraria uma regra decidida ou o resto do app. Não copie; corrija quando mexer ali.

Nenhuma tela foi conferida em emulador ou aparelho neste levantamento. Medidas, cores e tempos foram lidos do código.

## Onde fica cada coisa

| Assunto | Arquivo (`app/src/main/java/com/coalaone/go/`) |
| --- | --- |
| Paleta, fontes, tipografia, marca animada | `ui/Theme.kt` |
| Preferência de movimento, aurora, barra de progresso, ícones dos módulos | `ui/Motion.kt` |
| Página, barra superior, botões, campos, seletores, listas, cartões | `ui/Components.kt` |
| Cartões do início, avatares, iniciais | `ui/HomeTiles.kt` |
| Navegação, início e perfil | `MainActivity.kt` |
| Entrada, bloqueio e redefinição de senha | `ui/AuthScreens.kt` |
| Escala, Metas e Signage | `ui/ModuleScreens.kt` |
| Compra local | `ui/PurchaseScreens.kt` |
| Contagem e recebimento | `ui/StockScreens.kt` |
| Recorte da foto de perfil | `ui/PhotoCropDialog.kt` |
| Leitor de QR do Signage | `ui/QrScanner.kt` |
| Câmera e escolha de arquivo | `ui/Capture.kt` |

## Princípios

1. **Decidido — a barra escura mostra dados, não gestos.** A barra do início traz marca, saudação, função e avatar, e nada mais: sem alça, sem deslize, sem resumo que abre. O que há para hoje aparece nos selos dos cartões. Protegido por `coala-go-ui-contract.test.ts` (proíbe `TodayHeader`, `draggable` e "Deslize para").
2. **Decidido — toda seta de lista ou de seção que abre é a seta desenhada `DropdownChevron`.** Nunca um caractere (`⌄`, `⌃`, `▾`, `▼`). Detalhes em [Seta de dropdown](#seta-de-dropdown).
3. **Decidido — a Escala abre em "Todas as unidades".** Detalhes em [Comportamento de abertura das telas](#comportamento-de-abertura-das-telas).
4. **Decidido — "Todas as unidades" vem de `Rules.unitChoices`**, nunca de uma entrada montada à mão, e só existe quando a pessoa tem mais de uma unidade.
5. **Decidido — movimento é enfeite, nunca informação.** Toda animação respeita a preferência do sistema e nenhuma simula resposta do servidor. Detalhes em [Movimento](#movimento).
6. **Como está hoje — ícones são desenhados em código** (`Canvas`), sem imagens, sem biblioteca de ícones e sem rede.
7. **Como está hoje — uma ação principal por rodapé;** mensagens de erro e aviso ficam junto das ações, no rodapé, e não em diálogos.
8. **Como está hoje — nomes de pessoas aparecem como primeiro e último nome** (`personDisplayName`) nos espaços compactos.

## Cores

Fonte: objeto `Tokens` em `ui/Theme.kt`. O tema segue o sistema (claro ou escuro) via `isSystemInDarkTheme()`; não há chave manual no app.

**Como está hoje — fixas nos dois temas** (a barra escura e a marca não mudam):

| Token | Cor | Uso |
| --- | --- | --- |
| `dark` | `#15151C` | Barra superior, fundo da entrada, aviso do rodapé, véu de "Aguarde…" |
| `accent` | `#D13670` | Cor primária: botão principal, seleção, progresso |
| `pink` | `#F08BB1` | Destaques sobre o escuro: "Trocar unidade", etapa ativa, rótulos em caixa alta |
| `indigo` | `#5B5BD6` | Cor secundária: ícones de Escala, Signage e Contagem, fim de degradês |
| `onDark` | `#F3F2EE` | Texto principal sobre o escuro |
| `onDark2` | `#C8C7D0` | Texto de apoio sobre o escuro; traço dos botões da barra |
| `onDark3` | `#A9A8B3` | Subtítulo sobre o escuro |
| `onDark4` | `#8E8D99` | Rótulo pequeno em caixa alta sobre o escuro ("UNIDADE", sobretítulo) |
| `track` | `#34343F` | Trilho de barra de progresso sobre o escuro |

Bordas sobre o escuro usam sempre `onDark` com 14% de opacidade (botões da barra, seletor de unidade, botão secundário escuro).

**Como está hoje — variam com o tema** (claro → escuro):

| Token | Claro | Escuro | Uso |
| --- | --- | --- | --- |
| `page` | `#F0EEE9` | `#0C0C10` | Fundo da página |
| `surface` | `#FFFFFF` | `#1C1C24` | Cartões, linhas, folha de seleção |
| `raised` | `#FFFFFF` | `#34343F` | Superfície elevada |
| `soft` | `#FAF9F6` | `#24242E` | Fundo de campo, quadro de ícone, caixa de número |
| `greyBg` | `#ECEAE5` | `#24242E` | Faixa neutra, marcador não atingido |
| `segment` | `#E6E3DC` | `#1C1C24` | Fundo de controle segmentado |
| `ink` | `#1A1B1F` | `#F3F2EE` | Texto principal |
| `muted` | `#5F646C` | `#A9A8B3` | Texto de apoio, setas neutras |
| `faint` | `#6E737A` | `#8E8D99` | Texto apagado ("folga", "—", seta de seção fechada) |
| `border` | `#E3DFD6` | `#2E2E3A` | Borda de cartão e divisórias |
| `fieldBorder` | `#DCD9D1` | `#3F3F4D` | Borda de campo e de botão secundário |
| `accentSoft` | `#FBE7EF` | `#3A1826` | Fundo de seleção e de selo rosa |
| `wine` | `#A6325B` | `#F08BB1` | Texto de ação/ênfase sobre claro ("Hoje", "VOCÊ", nome da unidade no agrupamento) |
| `danger` / `dangerBg` | `#BE123C` / `#FFE4E8` | `#FF8FA3` / `#3B1620` | Erro |
| `problemBg` | `#FFF5F6` | `#2E161B` | Fundo de item com problema |
| `ok` / `okBg` / `okBorder` / `okInk` | `#147337` / `#E8F5EE` / `#BFE3CC` / `#14532D` | `#7EE2A8` / `#12301F` / `#1F5236` / `#B7F0CD` | Sucesso, meta batida |
| `warning` / `warningBg` | `#C2410C` / `#FFF1E6` | `#FDBA74` / `#3A2413` | Sem conexão, simulação, "Em curso" |
| `info` / `infoBg` | `#1D4ED8` / `#EEF3FE` | `#93B4FF` / `#17223F` | Selos informativos dos cartões |
| `amberBg` / `amberInk` / `amberBorder` | `#FFF7E6` / `#6B4500` / `#F5D9A3` | `#33280F` / `#F5D9A3` / `#5C4718` | Aviso âmbar |
| `changedBg` | `#FFF8FA` | `#2A1820` | Linha alterada pela pessoa |
| `pillFill` / `pillInk` / `pillAccent` | `#15151C` / `#FFFFFF` / `#F08BB1` | `#F3F2EE` / `#15151C` / `#D13670` | Pílula e dia selecionados: escuro no claro, claro no escuro |

**Como está hoje, a manter:** cor entra por `Tokens`. Não escreva hex em tela nova.

**Fora do padrão — hex solto hoje no código:** `#7EE2A8` e `#FDBA74` (selos "No ritmo"/"Atrás do ritmo" e níveis atingidos no cabeçalho de Metas — são os valores escuros de `ok` e `warning`, usados direto porque a barra é sempre escura); `#B9B8C2` (dia sem meta no gráfico e no marcador); `#93B4FF` (terceira cor do degradê da marca); `Color.White` (marcas de nível na barra de metas e o papel do ícone de compra); e os cinco tons de reserva de `PersonBadge`. Ao tocar nesses trechos, crie o token em vez de repetir o hex.

## Tipografia

**Como está hoje.** Duas fontes embarcadas em `res/font`, com licenças SIL OFL em `assets/font-licenses`:

- **Inter Tight** (`InterfaceFont`, variável, pesos 400–900): toda a interface.
- **JetBrains Mono** (`CodeFont`, peso 500): só endereços e códigos (o endereço do Signage).

| Estilo | Peso | Tamanho / linha | Uso |
| --- | --- | --- | --- |
| `headlineLarge` | 800 | 28 / 36 sp | Marca; números grandes de Metas (ajustado para 32 sp, peso 900) |
| `titleLarge` | 800 | 22 / 28 sp | Título da barra (19 / 23 sp quando há ação à direita); saudação (24 / 30 sp) |
| `titleMedium` | 700 | 15 / 21 sp | Título de cartão, de linha e de seção |
| `bodyLarge` | 400 | 15 / 22 sp | Valor em seletor |
| `bodyMedium` | 400 | 14 / 20 sp | Texto corrido |
| `bodySmall` | 400 | 12 / 17 sp | Apoio, subtítulo, dicas |
| `labelLarge` | 800 | 14 sp | Rótulo de botão; ações em texto (13 sp) |
| `labelSmall` | 700 | 11 sp, espaçamento 1 sp | Rótulo em caixa alta |

Padrões recorrentes:

- **Rótulo em caixa alta sobre o escuro:** `labelSmall` a 10 sp, espaçamento 1,2 sp (1,4 sp no sobretítulo da barra), cor `onDark4` — ou `pink` com peso 900 quando nomeia o indicador ("FATURAMENTO · 3 UNIDADES").
- **Selo "VOCÊ":** 9 sp, peso 800, espaçamento 0,5 sp, cor `wine`.
- **Texto longo corta com reticências** em uma linha (título de linha: até duas).
- A interface precisa continuar legível com fonte ampliada do sistema; `DesignMotionTest` cobre esse caso.

## Formas, medidas e espaçamento

**Como está hoje.**

| Elemento | Raio |
| --- | --- |
| Barra escura (só cantos de baixo) | 28 dp |
| Cartão de destaque do início (Compra local) | 22 dp |
| Cartão de módulo do início | 20 dp |
| `CardBlock`, `ListRow`, estado vazio, passo do guia | 18 dp |
| Blocos de Escala e Metas, seção da revisão, opção de orientação | 16 dp |
| Seletor de unidade, botão principal, quadro de ícone, caixa de número | 14 dp |
| Botão secundário | 13 dp |
| Campo, seletor, botão da barra, foto de produto, passo − / + | 12 dp |
| Ação em texto da barra, navegação de semana/mês | 10 dp |
| Selo, pílula | 50% (cápsula) |

- **Margens:** 20 dp nas laterais da barra e do conteúdo; 16 dp no rodapé; 24 dp na entrada.
- **Largura máxima do conteúdo:** 600 dp, centralizado (480 dp na entrada). Em tablet o conteúdo não estica.
- **Espaço entre blocos:** 10 dp no corpo da página; 8 dp dentro do rodapé; 10–12 dp dentro de cartões.
- **Área de toque mínima:** 44 dp (botões da barra, navegação de semana) e 48 dp (botões, caixas de marcar, olho da senha, passos − / +). Um desenho menor fica dentro de uma área de toque maior — o quadrado de 38 dp da barra fica numa área de 44 dp.
- **Bordas:** 1 dp; 2 dp quando o item está selecionado ou aberto.
- **Sombra:** só o cartão de Compra local do início tem elevação (6 dp). O resto é plano com borda.

## Ícones

**Como está hoje — todo ícone é desenhado em `Canvas`,** com traço de ponta arredondada. Não há biblioteca de ícones nem imagem, exceto o ícone do aplicativo.

### Ícone do aplicativo

`res/drawable/coala_icon.png` e, a partir da API 26, ícone adaptativo (`drawable-v26/coala_icon.xml`): fundo preto com `coala_foreground.png` à frente.

### Ícones dos módulos (`ModuleIcon`, `ui/Motion.kt`)

Desenhados numa grade de 44 × 44, traço de 2, e escalados para o tamanho pedido (34 dp nos cartões do início, 64 dp no cartão de Compra local). Cada um tem um movimento próprio em laço:

| Módulo | Desenho | Movimento | Ciclo |
| --- | --- | --- | --- |
| Compra local (`purchase`) | Nota branca com contorno `accent` e três linhas; selo verde de conferido | A nota sobe e desce até 2 px (ciclo de 3,2 s); uma linha `pink` varre a nota como um leitor; o selo sobe, fica e some | 2,4 s |
| Recebimento (`receive`) | Caminhão: baú `accentSoft` com contorno `accent`, cabine e duas rodas `dark` | Entra pela esquerda, para no centro e sai pela direita | 3,6 s |
| Metas (`goals`) | Três barras: `pink`, `accent`, `indigo` | As barras crescem e encolhem em sequência, com pequeno atraso entre elas | 2,4 s |
| Escala (`schedule`) | Calendário `indigo` com duas argolas e um ponto `accent` | O ponto salta entre três posições, como dias diferentes | 3,0 s |
| Signage (`signage`) | Monitor `indigo` com pé | Parado | — |
| Biometria (`biometric`) | Impressão digital em arcos `pink` | Pulsa (±15%) e solta um anel que cresce e some | 2,4 s |
| Contagem (demais) | Caixa em perspectiva `indigo` | Flutua 3 px para cima e para baixo | 2,6 s |

Com animações desligadas, cada ícone fica no quadro de descanso (selo visível, caminhão no centro, barras cheias).

### Ícones de interface

| Ícone | Onde | Desenho |
| --- | --- | --- |
| Voltar | Barra (`TopBar`) | Seta para a esquerda, três traços de 1,8 dp, num quadrado de 38 dp com borda |
| Atualizar | Barra | Arco de 300° com ponta de seta, traço de 1,8 dp |
| Seta de dropdown | Seletores, seções que abrem | Ver [Seta de dropdown](#seta-de-dropdown) |
| Seta de linha | `ListRow` | Seta para a direita, 14 dp, traço de 2 dp, cor `muted` — indica "abre outra tela" |
| Relógio | Horário do turno na Escala (`ClockGlyph`) | Círculo com dois ponteiros, 14 dp, traço de 1,4 dp, cor `muted` |
| Olho | Campo de senha (`EyeToggle`) | Olho `pink`; riscado quando a senha está visível. Rótulo "Mostrar senha" / "Ocultar senha" |
| Foto ausente | `ProductPhoto` | Moldura com sol e montanha em `fieldBorder`, mostrada enquanto não há imagem |
| Monitor | Orientação no Signage (`OrientationPicker`) | Painel na proporção real (16:9 ou 9:16) com pé; `accent` quando escolhido |

Todo ícone clicável sem texto tem rótulo de acessibilidade (`contentDescription` ou `onClickLabel`).

**Fora do padrão — caracteres usados como ícone.** Ainda são texto, e por isso mudam de peso e altura conforme a fonte do aparelho: `‹` `›` (semana/mês anterior e seguinte), `›` em "Anexar nota ›" e "Trocar monitor ›", `✎` (lápis do avatar), `✓` (nível e faixa atingidos), `−` `+` (quantidade), `→` (de/para em contagem e recebimento). Não crie outros; ao tocar nesses trechos, prefira desenhar. As setas de dropdown já saíram desta lista.

### Seta de dropdown

**Decidido.** Qualquer coisa que abre uma lista de escolha ou desdobra uma seção usa `DropdownChevron(open, color)`, de `ui/Components.kt`. Não existe outra seta para esse papel.

- **Desenho:** um "V" de dois traços, 11 dp de largura por 7 dp de altura, traço de 1,8 dp, pontas arredondadas, recuado meio traço para não ser cortado.
- **Estado:** aponta **para baixo** quando fechado e **para cima** quando aberto. A troca é imediata, sem giro animado.
- **Cor:** a do texto que acompanha.
- **Posição:** à direita, alinhada ao centro vertical; quando acompanha um rótulo ("Trocar unidade"), fica 6 dp depois dele.
- **Proibido:** caracteres `⌄ ⌃ ▾ ▼ ▴ ▲` em qualquer texto de tela. `coala-go-ui-contract.test.ts` varre todos os arquivos de `ui/` e falha se encontrar.

| Uso | Cor fechado | Cor aberto |
| --- | --- | --- |
| Seletor de unidade do cabeçalho ("Trocar unidade") | `pink` | `pink` |
| Seletor de lista longa e de data (`SelectorCard`) | `muted` | — (abre folha ou calendário por cima) |
| Seção da revisão da Compra local (`ReviewSection`) | `faint` | `wine` |

Por que desenhada: o caractere `⌄` variava de espessura e de altura entre aparelhos e ficava desalinhado do texto.

Não confunda com a **seta de linha** (para a direita, em `ListRow`), que indica navegação para outra tela, nem com a navegação de período `‹ ›`.

## Movimento

**Decidido.** Movimento é decorativo. Toda animação consulta `LocalMotionEnabled`, que acompanha a "escala de duração de animação" do Android (`ANIMATOR_DURATION_SCALE`) e reage na hora se a pessoa mudar o ajuste. Com a escala em zero:

- nenhum temporizador de animação é criado (`motionPhase` devolve um valor fixo);
- barras de progresso aparecem já no valor final;
- transições de tela acontecem sem fade nem deslocamento;
- cartões mudam de tamanho sem interpolar;
- o endereço do Signage aparece inteiro, sem digitação.

Animação nunca é o único sinal de um estado e nunca simula resposta do servidor. `DesignMotionTest` verifica movimento ligado, reduzido e fonte ampliada.

**Como está hoje — inventário de animações:**

| Efeito | Onde | Como |
| --- | --- | --- |
| Aurora | Fundo da entrada e do bloqueio (`Aurora`) | Quatro manchas de luz em degradê radial sobre `dark`: `accent` no canto superior direito (38% de opacidade), `indigo` à esquerda (32%), `pink` embaixo à direita (22%) e `indigo` na base (25%). Cada uma vai e volta em ciclo próprio — 14 s, 17 s, 12 s e 19 s — com aceleração suave, de modo que o conjunto nunca se repete igual. Sem desfoque de sistema, para funcionar na API 26 |
| Marca | "Go" em "Coala Go" (`Brand`) | Degradê `pink` → `accent` → azul claro → `pink` correndo pelo texto, ciclo de 6 s, linear |
| Slogan | "Acredite em você" na entrada | Um brilho claro atravessa o texto rosa; ciclo de 4,5 s, com pausa no início e no fim |
| Progresso | Metas, etapas (`AnimatedProgress`) | A barra cresce de zero ao valor ao entrar na tela. 1,2 s nas barras grandes de Metas, 1 s nas de pessoa e de unidade, 0,8 s na meta do dia, 0,3 s no avanço de etapa. Curva de desaceleração (0,2 · 0,8 · 0,2 · 1) |
| Troca de tela | Navegação (`AppNavigation`) | Entrar: fade de 280 ms com subida de 6 px. Sair: fade de 160 ms. Voltar: a tela anterior reaparece em fade de 280 ms e a atual some em 160 ms descendo 6 px |
| Cartão que cresce | `CardBlock` | Mudança de altura interpolada (`animateContentSize`) quando o conteúdo aparece ou some |
| Ícones dos módulos | Cartões do início | Ver [Ícones dos módulos](#ícones-dos-módulos-moduleicon-uimotionkt) |
| Endereço digitado | Guia do Signage (`UrlTypingMonitor`) | O endereço é digitado em 70% de um ciclo de 5,2 s e fica inteiro no restante; cursor `pink` piscando |
| Puxar para atualizar | Listas (`Page` com `onRefresh`) | Indicador padrão do Material. Só aparece quando a pessoa puxou e some 350 ms depois que o carregamento termina |
| Carregando | Qualquer tela (`feedback.busy`) | Véu `dark` a 72% sobre a tela inteira, com anel girando `pink` de 38 dp e "Aguarde…". Bloqueia toques |
| Folha de seleção | `PickerSheet` | Folha que sobe da base (`ModalBottomSheet` do Material), com o movimento padrão do componente |

Não há vibração, som nem animação de celebração.

## Estrutura da página

**Como está hoje — toda tela usa `Page`** (`ui/Components.kt`), que tem quatro faixas:

1. **Barra escura** no topo: fundo `dark`, cantos de baixo com raio de 28 dp, passa por baixo da barra de status do Android (que fica sempre com ícones claros). Margens de 20 dp, 8 dp em cima e 18 dp embaixo.
2. **Aviso de conexão**, só quando o aparelho está sem internet: faixa `warningBg` informa que rascunhos, notas de compra e o ponto previamente autorizado ficam guardados neste aparelho; o restante precisa de internet.
3. **Corpo** rolável, largura máxima de 600 dp, blocos separados por 10 dp. Quando a tela tem atualização, ela é por **puxar para baixo** — não há botão de atualizar na barra dessas telas.
4. **Rodapé** fixo, só quando há ação ou mensagem: fundo `surface` com divisória em cima quando há ação. Dentro dele, nesta ordem: erro, aviso, ações.

O teclado empurra o conteúdo (`imePadding`) e as áreas seguras do aparelho são respeitadas nas quatro faixas.

### Barra superior (`TopBar`)

**Como está hoje.** Altura mínima de 44 dp. Da esquerda para a direita:

- **Voltar** (quando a tela tem volta): quadrado de 38 dp com borda, seta desenhada, área de toque de 44 dp.
- **Texto:** sobretítulo opcional em caixa alta, título e subtítulo opcional em uma linha.
- **Atualizar** (raro; listas usam o puxar) e/ou uma **ação em texto** com borda, altura mínima de 34 dp.

Enquanto a tela está ocupada, os botões da barra ficam desabilitados e a 40% de opacidade.

**Decidido — a barra do início** (`HomeScreen`) não usa `TopBar`: mostra a marca pequena, a saudação ("Bom dia", "Boa tarde" ou "Boa noite" + primeiro e último nome, ou "humano" sem nome), a função da pessoa (ou "Equipe Coala") e o avatar à direita. Só isso — sem alça, sem gesto, sem conteúdo que desliza.

### Cabeçalho de etapas (`StepHeader`)

**Como está hoje.** Usado nos fluxos em passos (compra, contagem, recebimento, guia do Signage). Dois formatos:

- **Com nomes de etapa:** uma faixa de 4 dp por etapa, `pink` até a etapa atual e `onDark` a 14% nas seguintes, com "1 Nome" embaixo (texto claro na atual).
- **Sem nomes:** "Etapa 2 de 5" com uma barra de 5 dp que avança em 0,3 s.

### Seletor de unidade no cabeçalho (`UnitPickerHeader`)

**Decidido.** Escala e Metas usam o mesmo componente, dentro da barra escura, logo abaixo do título.

- Caixa de largura total, borda de 1 dp (`onDark` a 14%), raio de 14 dp, 14 dp de margem lateral e 10 dp vertical.
- À esquerda: "UNIDADE" em caixa alta e, embaixo, o nome da unidade escolhida (uma linha, com reticências) ou "Escolher unidade".
- À direita, só quando há mais de uma opção: "Trocar unidade" em `pink` seguido da [seta de dropdown](#seta-de-dropdown).
- A caixa inteira é o botão (rótulo de acessibilidade "Trocar unidade"). Com uma unidade só, a caixa é apenas informação: sem texto de troca, sem seta, sem toque.
- Toque abre a folha de seleção "Unidade"; a seta vira para cima enquanto ela está aberta.
- Desabilitado enquanto a tela carrega.
- As opções vêm de `Rules.unitChoices`: com mais de uma unidade, a primeira é **"Todas as unidades"**.

### Folha de seleção (`PickerSheet`)

**Como está hoje.** Folha que sobe da base, fundo `surface`. Título em `titleLarge`; campo "Buscar" quando há **mais de seis** opções; lista com altura máxima de 420 dp, linhas de no mínimo 52 dp separadas por divisória. A opção atual fica em negrito com "Selecionado" em `accent` à direita. Tocar numa opção escolhe e fecha. Busca sem resultado mostra "Nada encontrado."

## Componentes

**Como está hoje**, salvo indicação. Todos em `ui/Components.kt`, exceto onde dito.

### Botões (`Action`)

- **Principal:** preenchido com `accent`, raio de 14 dp, largura total, altura mínima de 48 dp. Ocupado, o rótulo vira "Aguarde…" e o botão desabilita.
- **Secundário:** contorno de 1 dp (`fieldBorder`), fundo `surface`, raio de 13 dp.
- **Sobre o escuro** (`dark = true`, usado na entrada e no recorte de foto): secundário transparente com texto claro; principal desabilitado em `accent` a 32%.
- **Par de rodapé** (`FooterPair`): secundário à esquerda e principal à direita, metade da largura cada, 10 dp entre eles.
- **Ação em texto:** `TextButton` para ações de menor peso ("Esqueci minha senha", "Sair da conta" em `danger`).

Uma ação principal por rodapé. Rótulo no formato verbo + objeto ("Baixar atualização", "Usar esta foto", "Enviar link").

### Campos

- **`Field`:** campo com rótulo flutuante, raio de 12 dp, fundo `soft`. Teclado decimal quando o valor é número.
- **`LabeledInput`:** rótulo em negrito acima do campo, uma linha; a borda pode assumir uma cor de alerta.
- **`QuantityField`:** campo decimal entre os passos **−** e **+** de 48 dp, para uso com uma mão. O **−** desabilita em zero; zero pode aparecer como vazio.
- **`DateField`:** abre o calendário do Material; mostra a data como dd/mm/aaaa e envia AAAA-MM-DD. Datas opcionais têm o botão "Sem data".
- **Na entrada:** campos sobre o escuro, com borda e rótulo `pink` em foco e fundo `onDark` a 6%.

### Escolhas

- **`Choices`** decide sozinho o formato:
  - uma única opção já escolhida vira **texto**, não escolha;
  - até seis opções viram **chips** em linha que quebra;
  - mais de seis abrem a **folha de seleção** com busca.
- **`PillChoice`:** pílula de filtro. Selecionada: preenchida com `pillFill` (escura no tema claro, clara no escuro). Não selecionada: `surface` com borda. Variante de destaque: fundo `accentSoft`, borda `accent`, texto `wine`. Anunciada como botão de opção.
- **`CheckRow`:** linha inteira clicável com caixa de marcar, altura mínima de 48 dp.
- **Opção em cartão** (orientação no Signage): cartão com desenho, título e dica; borda de 2 dp `accent` e fundo `accentSoft` quando escolhido.

### Listas e cartões

- **`ListRow`:** linha inteira clicável, altura mínima de 68 dp. Quadro de 44 dp com duas letras (iniciais da unidade, por `unitInitials`), título, subtítulo, selo opcional e seta de linha. Destaque: borda `pink` a 50% e quadro `accentSoft`.
- **`CardBlock`:** cartão padrão, 16 dp de margem interna, 10 dp entre itens; borda de 2 dp `accent` quando selecionado; cresce com animação.
- **`StatBox`:** caixa `soft` com rótulo pequeno e valor em destaque.
- **`StatusChip`:** selo em cápsula, 11 sp, peso 800.
- **`SectionLabel`:** título de seção em caixa alta, cor `muted`.
- **`EmptyState`:** cartão translúcido com título e dica centralizados. Toda lista trata o caso vazio com uma frase específica ("Nenhum turno neste dia", "Você não tem turno neste dia").
- **`ProductPhoto`:** quadro de raio 12 dp com o desenho de foto ausente por baixo e a imagem por cima.
- **`InlineConfirmation`:** confirmação dentro da página — mensagem, "Voltar" e a ação. **Não há diálogo de "tem certeza?"**; é assim que se confirma "Sair da conta".

### Pessoas e avatares (`ui/HomeTiles.kt`)

- **`PersonBadge`:** círculo com anel de 2,5 dp na cor cadastrada da pessoa (ou um de cinco tons de reserva, pela posição na lista) e fundo da mesma cor a 22%. Mostra a foto, se houver, ou as iniciais em `ink` — a letra fica escura porque as cores cadastradas costumam ser claras.
- **`ProfileAvatar`:** círculo de 54 dp em degradê `pink` → `indigo`, com foto ou iniciais, e um lápis no canto inferior direito. Toque abre o perfil.
- **Iniciais:** de pessoa, primeira letra do primeiro e do último nome; de unidade, duas letras ignorando palavras genéricas ("Unidade Tirirical" → TR).

### Cartões do início (`HomeTile`)

- **Compra local** (quando liberada): cartão de largura total, com sombra, título, descrição, selo "N notas no aparelho" e ilustração grande à direita.
- **Demais módulos:** grade de duas colunas com cartões de mesma altura; ícone num quadro de 44 dp, selo de estado no canto superior direito, título e uma linha de descrição.
- **Selos:** "Em curso" (contagem aberta, cor de aviso), número de reposições a receber, horário do turno de hoje, percentual da meta.
- **Ponto** e **Solicitações** entram na grade antes dos demais módulos e aparecem só com a liberação do grupo `app` do perfil (`app.timeRecording.mark`, `app.requests.create`) somada à permissão de colaborador do sistema.
- Só aparecem os módulos que o perfil libera. Sem nenhum: "Nenhum módulo liberado".

## Comportamento de abertura das telas

| Tela | Como abre | Marca |
| --- | --- | --- |
| Escala | Em **"Todas as unidades"**, visão "Equipe", semana atual, dia de hoje. Toda vez que a pessoa entra na tela, volta para "Todas as unidades"; a unidade escolhida vale até sair (e sobrevive a girar o aparelho). Com uma unidade só, abre nela, sem seletor ativo | **Decidido** (2026-10-14) |
| Metas | Na última escolha da pessoa neste aparelho — unidade ou "Todas as unidades" —, guardada por conta. Sem escolha guardada, na primeira unidade | Como está hoje |
| Início | Saudação e cartões dos módulos liberados; os selos carregam em seguida | Como está hoje |
| Signage | Lista de unidades; depois o painel da unidade; depois o guia em passos | Como está hoje |
| Ponto | Aba "Hoje", na unidade de trabalho principal do vínculo (a empregadora primeiro). Sem "Todas as unidades": a batida precisa de uma unidade | Etapa 7 (2026-10-19) |
| Solicitações | Aba "Ausência", com a lista dos próprios pedidos; o botão do rodapé abre o pedido novo | Etapa 7 (2026-10-19) |
| Aplicativo | Bloqueado com conta conhecida: pede a biometria sozinho, se a pessoa ativou. Sem conta: entrada | Como está hoje |

A regra da Escala está em `ModulesState.selectedScheduleUnit` (valor inicial `Rules.ALL_UNITS`) e no reinício a cada visita em `ScheduleScreen`; `coala-go-ui-contract.test.ts` e `ViewModelsTest` protegem as duas partes.

"Todas as unidades" na Escala é só apresentação: agrupa os turnos do dia por unidade (nome da unidade em caixa alta, cor `wine`), sem leitura nova e sem ampliar o que a pessoa já podia ver.

## Navegação

**Como está hoje.**

- Uma pilha simples: início → módulo. O perfil abre pelo avatar.
- **Voltar** da barra e do sistema fazem o mesmo. Dentro de fluxos em níveis (Signage, etapas), voltar recua um nível antes de sair da tela.
- Voltar fica bloqueado enquanto a tela está ocupada.
- Tarefas de conta ficam no **perfil**, fora do início: foto, versão do app, atualização e "Sair da conta".
- **Como está hoje — notificações:** o perfil oferece ativação voluntária por conta/aparelho e desativação. Consentimento e permissão do Android são estados diferentes: bloqueio no sistema é informado e oferece acesso às configurações também antes do Android 13. O push mostra somente aviso genérico; as notificações de solicitações continuam abrindo na web. Pedir ausência e vale-transporte já é nativo (Solicitações); acompanhar a análise completa e anexar depois do envio seguem no Coala One. Simulação não registra dispositivos.

## Estados e mensagens

**Como está hoje.**

- **Carregando:** véu sobre a tela inteira com "Aguarde…". Uma operação por vez — a tela ignora um segundo pedido enquanto o primeiro corre.
- **Erro:** texto `danger` em faixa `dangerBg`, no rodapé, junto das ações. Na entrada, em `pink` abaixo dos campos.
- **Aviso de sucesso:** faixa `dark` com texto claro, no rodapé.
- **Sem conexão:** faixa âmbar abaixo da barra, dizendo o que continua funcionando.
- **Simulação:** faixa "Simulação · nenhum dado é enviado" no início.
- **Atualização disponível:** cartão com borda de destaque no início; a checagem acontece toda vez que o app volta para a frente.
- **Vazio:** frase específica do contexto, nunca tela em branco.
- **Selos de situação** usam cor **e** texto (verde "No ritmo", laranja "Atrás do ritmo"); a cor nunca é o único sinal.

## Telas com desenho próprio

**Como está hoje.**

- **Entrada e bloqueio:** aurora ao fundo, marca grande com slogan, campos sobre o escuro, botão principal escuro. Olho para mostrar a senha.
- **Escala:** faixa de sete dias sempre na largura da tela, cada dia com a hora de início da pessoa, "folga" ou "—"; dia escolhido em `pillFill`, hoje em `wine`. "Ver mês" troca para a grade do mês. Linhas de turno com avatar, nome, cargo e horário com o relógio.
- **Metas:** número grande, selo de ritmo, barra de 12 dp em degradê `accent` → `pink` com marcas brancas nos níveis. Abas Dias, Equipe e Prêmio. Gráfico de barras por dia: verde bateu, `accent` abaixo, `pink` hoje, linha tracejada na meta do dia, com legenda.
- **Signage:** guia em passos numerados (círculo `accentSoft` com o número), monitor com o endereço sendo digitado, escolha de orientação em cartões, leitor de QR em tela cheia.
- **Recorte da foto:** tela cheia escura; a foto num quadrado de cantos de 20 dp com tudo fora do círculo escurecido a 72%. Arrastar posiciona, dois dedos ou a barra aproximam.
- **Compra local:** revisão em seções numeradas que abrem e fecham; a aberta ganha borda de 2 dp `accent` e a [seta](#seta-de-dropdown) para cima.
- **Ponto (`ui/TimeScreens.kt`):** cartão `dark` "HORA OFICIAL" com relógio de segundos em `CodeFont`, no fuso da unidade escolhida e com o rótulo `UTC−03:00`; o relógio soma a leitura oficial ao tempo monotônico do aparelho. Batidas numeradas ("1ª", "2ª") com o tipo **sugerido pela ordem**; batida desconsiderada pelo DP fica riscada em `faint`, incluída leva "incluída pelo DP". On-line, a confirmação mostra NSR e comprovante do servidor. Sem conexão e com autorização ainda válida, a ação vira "Registrar ponto offline" e a confirmação avisa que a marcação fica guardada no aparelho, sem NSR nem comprovante até sincronizar. A tela mostra quantidade pendente e caso bloqueado sem apagar a evidência. Comprovante abre numa folha com "Abrir comprovante", "Compartilhar" (folha nativa) e "Salvar no aparelho" (seletor do sistema); comprovante pendente mostra só o aviso de indisponibilidade.
- **Pedidos em duas etapas (ajuste de ponto, ausência, vale-transporte):** formulário → "Revisar …" → resumo em `SummaryLine` (rótulo `muted` sobre o valor) → `FooterPair` "Editar" / "Enviar …". O resumo do ajuste diz quem pede e que a batida original nunca é apagada. Textos longos usam `NoteInput` com contador do limite do servidor.

## Acessibilidade

**Como está hoje**, a manter em tela nova:

- Áreas de toque de 44 dp ou mais.
- Ícone clicável sem texto tem rótulo falado.
- Papéis declarados: botão, botão de opção (pílulas e opções em cartão), aba (dias da Escala), caixa de marcar.
- Barras de progresso expõem o valor; o gráfico de Metas tem descrição.
- Cor nunca é o único sinal de estado.
- Movimento respeita o ajuste do sistema.
- Texto ampliado não pode cortar conteúdo.

## Checklist para mexer na interface do app

- [ ] Cores por `Tokens`; nenhum hex novo na tela.
- [ ] Seta de lista ou de seção que abre é `DropdownChevron`; nenhum caractere de seta.
- [ ] Seletor de unidade no cabeçalho é `UnitPickerHeader` com `Rules.unitChoices`.
- [ ] Nada de gesto, alça ou conteúdo deslizante na barra do início.
- [ ] Animação nova consulta `LocalMotionEnabled` e tem um estado parado que faz sentido.
- [ ] Ícone novo é desenhado em `Canvas` e, se clicável, tem rótulo.
- [ ] Confirmação é inline (`InlineConfirmation`); erro e aviso ficam no rodapé.
- [ ] Carregando, vazio e sem conexão tratados.
- [ ] Área de toque de pelo menos 44 dp.
- [ ] Rodou `:app:testDebugUnitTest`, `:app:lintDebug` e `tests/unit/coala-go-ui-contract.test.ts`.
- [ ] Mudou um padrão descrito aqui? Atualize este arquivo no mesmo trabalho.

## Lacunas

- Nenhuma medida deste guia foi conferida em aparelho; tudo foi lido do código em 2026-10-14.
- Ponto e Solicitações (Etapa 7, 2026-10-19) foram verificados só por testes de unidade, contrato e lint, sem emulador nem aparelho, a pedido do programador.
- Os trechos marcados "Como está hoje" não passaram por decisão de design. Se um deles for contestado, o código atual não serve de argumento.
- O protótipo `Coala One App - Prototipo` não foi reaberto para este levantamento; diferenças entre ele e o app não estão listadas aqui.
- Os pontos fora do padrão de [Cores](#cores) (hex solto) e de [Ícones de interface](#ícones-de-interface) (caracteres como ícone) seguem abertas.
