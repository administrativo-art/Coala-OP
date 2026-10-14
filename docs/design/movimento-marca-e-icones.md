# Movimento, marca e ícones

O que se move no Coala One (web), quais arquivos de marca existem e como os ícones são usados. Complementa [Tokens](tokens.md), [Barra lateral](barra-lateral.md), [Listas](listas.md), [Modais](modais.md) e [Cabeçalho e etapas](cabecalho-e-etapas.md). Para o aplicativo Android, veja [Aplicativo Coala Go](app.md).

## Como ler este guia

Cada trecho traz uma destas três marcas:

- **Decidido** — é regra. Já estava escrita em outro guia desta pasta ou no código do componente, e código novo segue.
- **Como está hoje** — é só o retrato do código em 2026-10-14. Ninguém decidiu que deve ser assim; está aqui para você saber o que existe. Se quiser que vire regra, é uma decisão a tomar.
- **Fora do padrão** — trecho do código que contraria uma regra decidida ou o resto do sistema. Não copie; corrija quando mexer ali.

Nada aqui foi conferido no navegador: tempos, medidas e cores foram lidos do código.

## Movimento

### Regras gerais

**Decidido** (já constam em `README.md`, `estrutura-e-navegacao.md`, `barra-lateral.md` e `botoes.md`):

1. Toda animação respeita `prefers-reduced-motion` — o ajuste "reduzir movimento" do sistema operacional.
2. Animação nunca é o único sinal de um estado: sempre há texto, cor ou ícone junto.
3. Animações usam `transition-*` do Tailwind ou keyframes em `src/app/globals.css`. Não há biblioteca de animação (sem framer-motion, sem Lottie).
4. Botões não animam escala.
5. Da marca, só a palavra do sistema ("One", "Pulse") se move.

### Tempos e curvas

**Decidido** — tokens em `globals.css`:

| Token | Valor | Uso |
| --- | --- | --- |
| `--ds-dur` | 0,18 s | Duração padrão da elevação de linha |
| `--ds-ease-lift` | `cubic-bezier(.2,.8,.2,1)` | Curva da elevação: sai rápido e assenta devagar |

**Como está hoje** — não existe uma escala única de durações. O código usa estes valores:

| Duração | Onde |
| --- | --- |
| 140 ms | Espera antes de a barra lateral fechar depois que o cursor sai |
| 150 ms | Botões e `HeroChip` (cor de fundo, sombra) |
| 180 ms | Elevação de linha (`LiftRow`); tremor curto de botão |
| 200 ms | Painel lateral entrando e saindo; diálogo padrão; acordeão |
| 300 ms | Logotipo encolhendo com a barra lateral; folha (`Sheet`) fechando |
| 500 ms | Folha (`Sheet`) abrindo |
| 1,5 s | Destaque único de item (`pulse-once`) |
| 2,4 s | Batimento de "Pulse" |
| 3,4 s | Brilho de "One" |

Se for criar uma animação nova, reaproveite um destes valores em vez de inventar outro.

### Inventário

| Efeito | Onde | Como | Movimento reduzido | Marca |
| --- | --- | --- | --- | --- |
| Brilho de "One" | Nome do sistema na barra lateral (`SystemBrand`, classe `coala-shimmer-word`) | Um brilho branco atravessa a palavra rosa, da direita para a esquerda, 3,4 s, linear, sem parar | Para; a palavra fica rosa sólida | Decidido |
| Batimento de "Pulse" | Nome do sistema no Coala Pulse (`coala-pulse-name`) | Batimento duplo: cresce 6%, volta, cresce 4%, volta, com brilho rosa em volta; 2,4 s | Para | Decidido |
| Logotipo que encolhe | Barra lateral recolhendo e expandindo | O mesmo desenho muda de tamanho e posição em 300 ms; não troca por outro | Troca sem animar | Decidido |
| Barra lateral | Passar o cursor | Expande de 76 para 280 px por cima do conteúdo; fecha 140 ms depois de o cursor sair. Detalhes em [Barra lateral](barra-lateral.md) | Sem animação | Decidido |
| Item da barra lateral | Passar o cursor | Avança 2 px; o ícone cresce, gira de leve e fica rosa | Sem animação | Decidido |
| Seção da barra lateral | Abrir e fechar | Altura animada (`grid-template-rows` 0fr → 1fr) | Sem animação | Decidido |
| Elevação de linha | `LiftRow` ao passar o cursor | Sobe 3 px, cresce 1,2% (0,6% em tabela), ganha sombra, cantos de 14 px e fundo branco; 180 ms na curva `--ds-ease-lift` | Sem subir nem crescer: só fundo e sombra | Decidido |
| Faixa do topo que encolhe | Painel escuro ao rolar | Vira faixa fina. Detalhes em [Cabeçalho e etapas](cabecalho-e-etapas.md) | Sem animação | Decidido |
| Botões | Passar o cursor | Cor de fundo e sombra em 150 ms; sem escala | — | Decidido |
| Painel lateral | `SidePanel` | Desliza da direita em 200 ms; o fundo escurece em fade | Não tratado | Como está hoje |
| Modal em etapas | `WizardModal` | Só o fundo escurece em fade; o modal aparece sem movimento | Não tratado | Como está hoje |
| Diálogo padrão | `ui/dialog.tsx` | Fade com leve zoom, 200 ms | Não tratado | Como está hoje |
| Folha | `ui/sheet.tsx` | Desliza da borda: 500 ms para abrir, 300 ms para fechar | Não tratado | Como está hoje |
| Acordeão | `ui/accordion.tsx` | Altura de zero ao tamanho do conteúdo, 200 ms | Não tratado | Como está hoje |
| Carregando (giro) | Botões e áreas em carregamento | Ícone `Loader2` girando (`animate-spin`); 333 usos. `RefreshCw` girando em 17 botões de atualizar | Não tratado | Como está hoje |
| Carregando (esqueleto) | `ui/skeleton.tsx` | Blocos cinza pulsando (`animate-pulse`) | Não tratado | Como está hoje |
| Destaque único | Controle de validade (`expiry-control.tsx`, classe `animate-pulse-once`) | O item pisca uma vez: fundo rosa claro e um anel que se abre, 1,5 s | Não tratado | Como está hoje |
| Ponto "ao vivo" | Signage (`signage-admin-shared.tsx`) e página de vagas | Um anel se expande e some em laço atrás do ponto (`animate-ping`) | Signage: parado (`motion-safe`). Vagas: não tratado | Como está hoje |
| Avisos (toast) | `ui/toast.tsx` | Entra e sai deslizando; dá para arrastar para dispensar | Não tratado | Como está hoje |
| Tremor | Classe `animate-shake` em `globals.css` | Vai e volta 3 px na horizontal, 180 ms | Não tratado | Como está hoje — definida, mas nenhuma tela usa |

### Fora do padrão

- **Movimento reduzido não é respeitado em tudo.** A regra 1 vale para barra lateral, marca, linhas e faixa do topo. Painel lateral, modal, diálogo, folha, acordeão, indicadores de carregamento, destaque único, toast e o ponto "ao vivo" da página de vagas animam mesmo com o ajuste ligado. Não há uma regra global em `globals.css` que desligue animações.
- **Dois tremores com o mesmo nome.** `globals.css` define `--animate-shake` (keyframe `shake`, 5 px, 0,5 s) e, mais abaixo, a classe `.animate-shake` (keyframe `btn-shake`, 3 px, 180 ms). A classe prevalece e o primeiro fica sem uso. Nenhuma tela usa nenhum dos dois hoje.
- **Fundo escurecido com duas cores.** `SidePanel` e `WizardModal` usam o token `--ds-scrim`; o diálogo e a folha padrão usam preto a 80%.

## Marca

### Nome e descrição

**Como está hoje** — `src/config/brand.ts` é a configuração central:

| Campo | Valor |
| --- | --- |
| Nome | Coala One |
| Descrição | Pessoas, processos e operação em um só lugar |
| Logotipo | `src/assets/brand/logosidebar.png` |
| Fundo do login | `/loginfundo.png` |

O manifesto do site (`src/app/manifest.ts`) repete nome e descrição.

### Arquivos

**Como está hoje:**

| Arquivo | Formato | Onde é usado |
| --- | --- | --- |
| `public/instagram/coala-logo.png` | PNG 2160 × 2160 | Logotipo da barra lateral (`SystemBrand`) e da Programação do Instagram |
| `src/assets/brand/logosidebar.png` | PNG 2160 × 2160 | `brand.logo`: etiquetas de patrimônio com código de barras |
| `public/logosidebar.png` | PNG 2160 × 2160 | Página pública de admissão (`/vagas/onboarding/[token]`) |
| `public/loginfundo.png` | PNG 1920 × 1080 | Imagem de fundo da tela de login |
| `src/app/icon.png` | PNG 512 × 512 | Ícone do site, do atalho na tela inicial e do manifesto |
| `src/app/favicon.ico` | ICO | Ícone da aba do navegador |
| `public/coala-email-logo.jpg` | JPG | Cabeçalho dos e-mails (primeiro acesso, ASO, contador, desligamento), exibido com 88 px de largura |
| `public/icons/coala-shakes-192.png`, `-512.png` | PNG | `public/manifest.json` |
| `public/icons/coala-signage-192.png` | PNG 192 × 192 | Aplicativo de Signage |
| `public/images/coala-bio-logo-final.svg`, `coala-bio-logo.png` | SVG / PNG | Página pública de bio |
| `src/features/hr/documents/assets/coala-shakes-letterhead-*.png` | PNG | Papel timbrado de documentos e PDFs do RH |
| `public/email/icons/` | PNG | Ícones dos e-mails (clientes de e-mail não aceitam SVG) |

### Marca na barra lateral

**Decidido** (ver [Barra lateral](barra-lateral.md)): o logotipo fica à esquerda e, ao lado, "Coala + palavra", separados por um filete rosa de 2 px. Recolhida a barra, o logotipo encolhe e o nome some. A palavra do sistema é a única parte que se move.

**Como está hoje** — medidas em `SystemBrand`: área do logotipo com 44 px de altura e 96 px de largura (60 px recolhida); a imagem tem 129 px de largura expandida e 78 px recolhida, recortada pela área. Nome em 17 px, peso 800.

### Tela de login

**Como está hoje:** imagem de fundo em tela cheia e um cartão branco translúcido (82% de opacidade, desfoque de 18 px, cantos de 28 px) com o formulário. Botão de entrar com 56 px de altura.

**Fora do padrão:** a tela usa cores escritas direto no código (`#E91E8C`, `#C4187A`, `#9E145F`, `#d8d8d8`) em vez dos tokens `--ds-*` — um rosa diferente do `--ds-accent` do resto do sistema.

### Fora do padrão e lacunas da marca

- **O mesmo logotipo em três arquivos.** `public/instagram/coala-logo.png`, `src/assets/brand/logosidebar.png` e `public/logosidebar.png` têm o mesmo tamanho e servem ao mesmo papel. A barra lateral não usa `brand.logo`, então trocar o logotipo em `brand.ts` não muda a barra.
- **Cor do tema no manifesto.** `src/app/manifest.ts` declara `theme_color: #F43F5E`, que não é o rosa da marca (`--ds-accent`).
- **Dois manifestos.** Existem `src/app/manifest.ts` e `public/manifest.json`, com ícones diferentes.
- **Sem regra de uso.** Não há nada decidido sobre versão do logotipo para fundo claro e escuro, área de respiro, tamanho mínimo ou usos proibidos.
- **Imagens não descritas.** Este levantamento listou os arquivos, mas não descreve o desenho de cada um.

## Ícones

### Biblioteca

**Como está hoje:** os ícones vêm de `lucide-react`, usado em 345 arquivos. É a única biblioteca de ícones do sistema. Não há ícones próprios desenhados para o web, fora os da marca.

**Decidido** (ver [Listas](listas.md) e [Barra lateral](barra-lateral.md)):

- Linha de lista não tem ícone de ação. A exceção é a caixa de seleção em massa.
- Na barra lateral, seção não tem ícone; item e subitem têm.

### Tamanhos

**Como está hoje** — contagem de uso no código:

| Tamanho | Classe | Usos | Onde costuma aparecer |
| --- | --- | --- | --- |
| 16 px | `h-4 w-4` | 1530 | Padrão: dentro de botão, ao lado de texto |
| 14 px | `h-3.5 w-3.5` | 448 | Botão pequeno, selo, chip |
| 20 px | `h-5 w-5` | 281 | Ícone sozinho, cabeçalho, giro de carregamento em botão grande |
| 12 px | `h-3 w-3` | 163 | Dentro de selo e de texto pequeno |
| 32 px | `h-8 w-8` | 69 | Estado vazio, carregamento de área |
| 24 px | `h-6 w-6` | 54 | Destaque em cartão |
| 48 px | `h-12 w-12` | 39 | Ilustração de estado vazio |
| 40 px | `h-10 w-10` | 30 | Ilustração de estado vazio |

Na prática, **16 px é o padrão** e 14 px o tamanho reduzido. Ninguém decidiu isso; é o que o uso mostra.

### Traço e cor

**Como está hoje:**

- Quase todos os ícones usam o traço padrão da biblioteca (2). Há cerca de 30 exceções com traço entre 1,5 e 3.
- O ícone herda a cor do texto ao redor (`currentColor`).

### Carregando

**Como está hoje:** o indicador de carregamento é o ícone `Loader2` girando. Em botão, fica antes do texto, com 8 px de distância. Botões de atualizar usam `RefreshCw`, que gira enquanto busca.

### Acessibilidade

**Decidido** (ver [Estrutura e navegação](estrutura-e-navegacao.md)): estado não depende só de cor nem só de ícone.

**Como está hoje:** não há regra escrita exigindo rótulo (`aria-label`) em botão que só tem ícone, nem `aria-hidden` em ícone decorativo. O levantamento não conferiu quantos botões estão sem rótulo.

### Lacunas dos ícones

- Tamanho padrão, traço e cor não estão decididos; a tabela acima é só contagem de uso.
- Não há lista de qual ícone representa qual ação (editar, excluir, exportar etc.), então a mesma ação pode aparecer com ícones diferentes em telas diferentes. Isso não foi medido.

## O que falta decidir

Estes pontos estão descritos acima como "Como está hoje" ou "Fora do padrão". Cada um vira regra — ou correção — quando houver decisão:

1. Movimento reduzido deve valer para painel, modal, diálogo, folha, carregamento e toast?
2. Qual é a escala oficial de durações?
3. Painel e modal devem entrar com o mesmo movimento?
4. Qual arquivo é o logotipo oficial, e os outros dois saem?
5. A tela de login passa a usar os tokens de cor?
6. 16 px e traço 2 viram o padrão oficial de ícone?
7. Botão só com ícone passa a exigir rótulo?
