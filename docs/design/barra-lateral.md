# Barra lateral

Padrão da navegação lateral do Coala One e da Programação do Instagram (Coala Pulse). Implementações: [`GlassSidebar`](../../src/components/sidebar.tsx), [`InstagramWorkspaceSidebar`](../../src/features/instagram-scheduler/workspace-sidebar.tsx) e a marca compartilhada [`SystemBrand`](../../src/components/patterns/system-brand.tsx).

## Forma

- **Flutuante e arredondada**: 12px de margem da borda, canto de 28px (`rounded-ds-panel`), fundo `--ds-dark` e anel fino branco a 10%. Não encosta no topo, no rodapé nem na lateral da tela.
- **Recolhida por padrão** (76px, só ícones) e **expande ao passar o cursor** (280px), **por cima do conteúdo**: o layout reserva só o trilho (`lg:pl-[88px]` = 76 + 12 de margem) e nada se desloca quando a barra abre. Não há botão de recolher: o estado é automático.
- Fecha 140ms depois de o cursor sair, para não piscar ao cruzar a borda.
- No celular vira gaveta: desliza da esquerda com véu (`--ds-scrim`), fecha por ×, véu ou Esc.

## Marca e nome do sistema

`SystemBrand` mostra o logotipo e, ao lado, "Coala + palavra" separados por um **filete rosa de 2px** (a divisão precisa ser visível). Recolhida, o mesmo logotipo **encolhe com animação** (a medida anima entre o estado aberto e o recolhido; não se troca por outro desenho) e o nome some. A palavra do sistema é a única coisa que se move:

| Sistema | Palavra | Animação | Intenção |
|---|---|---|---|
| Coala One | `One` | `shimmer`: um brilho percorre a palavra (3,4s) | tudo conectado num só lugar |
| Coala Pulse | `Pulse` | `pulse`: batimento duplo com brilho rosa (2,4s) | sistema vivo |

Ambas ficam paradas com `prefers-reduced-motion`.

## Itens e interação

- **Seções sem ícone**: título pequeno em caixa alta com seta e, se houver, o contador da seção. Os **itens e subitens é que levam ícone**, com a lista recolhível por altura animada (`grid-template-rows` 0fr→1fr, 300ms); o item ativo abre a própria seção. Grupos aninhados (submenus) recuam e abrem do mesmo jeito.
- **Recolhida**, a barra mostra os ícones dos itens de primeiro nível, separados por um filete a cada seção; item sem submenu navega direto e grupo virtual abre a barra já no grupo.
- **Item ativo**: texto branco, fundo `white/10` e barra rosa de 2px à esquerda. No Coala One todas as áreas usam o mesmo acento; a cor por área saiu para respeitar os tokens.
- **Passar o cursor**: o item avança 2px, o ícone cresce, gira de leve e fica rosa (Pulse também mostra uma seta). No Pulse, um **realce com degradê rosa acompanha o cursor** de item em item e o realce do item ativo desliza até ele.
- **Contadores** em pílula rosa ao lado do item; recolhida, vira um ponto rosa no ícone.
- **Foco**: só o foco de teclado (`:focus-visible`) mantém a barra aberta. Depois de um clique o item continua focado, mas a barra deve recolher assim que o cursor sai.
- **Item ativo dentro de grupo recolhido não desenha realce**: a posição de um elemento escondido não vale (o realce ficava parado sobre o vizinho).
- Topo e rodapé fixos; só a lista do meio rola, sem barra de rolagem visível, para que o cartão do usuário nunca seja cortado.

## Cartão do usuário (Pulse)

Foto (ou iniciais), nome e cargo, vindos do cadastro da pessoa conectada. Recolhida mostra só a foto; "Sair" aparece só expandida.

## Regras de código

- Sem hex nas classes; animações só por `transition-*` e keyframes em `globals.css`, sempre com `motion-reduce`.
- A lógica de permissões e de itens não muda com o visual; os testes de contrato leem os rótulos e os `show` em `sidebar.tsx`.

## Barra superior (Coala One)

- **Fina e flutuante** (44px, mesma família visual da lateral): caminho da tela, busca, pendências, relógio e notificações. Sem foto do usuário (ela mora no cartão da barra lateral) e sem o leitor de código de barras.
- **Mesmas bordas do conteúdo**: a margem lateral da barra é a mesma do `main` (`mx-4 md:mx-8`; `mx-4` nas seções de Pessoal, que usam densidade própria). A barra não pode parecer mais larga que a página.
- **Caminho vindo do menu**: "Área › Grupo › Tela" é publicado pela barra lateral (`NavTrailProvider`) e só exibido pela superior; não existe mais mapa manual de rótulos como fonte principal (o antigo é só reserva para rotas fora do menu).
- **Pendências só quando existem**: chips de tarefas e de validades em 48h com "Ver →"; sem pendência, nada aparece.
- **Uma massa escura por tela**: em telas com painel escuro, o voltar e o título entram no painel (ex.: Controle de Estoque), não numa linha solta acima dele.
- **Ações que viviam em botão flutuante** vão para o menu "Ações" do painel da própria tela (ex.: baixa, transferência, histórico, consumo e etiquetas no Controle de Estoque).
