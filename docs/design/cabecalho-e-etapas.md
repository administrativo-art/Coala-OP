# Cabeçalho que encolhe, etapas e prévia no celular

Padrões criados na Programação do Instagram (Coala Pulse). Implementações: [`PulseHero` e `HeroChip`](../../src/features/instagram-scheduler/hero-panel.tsx), [`SidePanel compact`](../../src/components/patterns/side-panel.tsx), [`post-phone-preview.tsx`](../../src/features/instagram-posts/post-phone-preview.tsx) e [`planning-model.ts`](../../src/features/instagram-posts/planning-model.ts).

## Cabeçalho escuro (`PulseHero`)

Painel escuro com kicker, título, subtítulo, ações, busca, **chips de indicadores** e, se preciso, rodapé (abas). Os indicadores são **chips compactos numa linha** (`HeroChip`: número em mono e rótulo), não mais números grandes: o painel ocupa cerca de 40% menos altura. Chip com `onClick` filtra a lista e mostra o anel rosa quando ativo.

### Ao rolar

- O painel completo rola com a página. Quando sai de vista, uma **faixa fina** (kicker, título, resumo e só a ação principal) desliza para o topo (`sticky top-3`) e fica fixa. A faixa **não muda a altura da página**, então o conteúdo não pula.
- **Listas internas que rolam sozinhas** (posts, coluna da biblioteca) também acionam a faixa: o evento de rolagem não borbulha, então escutamos na captura, ignorando a barra lateral, com histerese de 40/8px. Nesse caso o painel completo encolhe (altura animada) e a faixa assume o topo.
- A página também é medida por `window.scrollY` (reforço do observador de interseção).
- O recorte do encolhimento só existe enquanto o painel encolhe; um recorte fixo cortava a sombra em retângulo nas quinas.
- Telas cujo contêiner usa `space-y` (em vez de `flex gap-5`) passam `stack`.

## Painel lateral compacto

`SidePanel compact`: cabeçalho baixo (subtítulo só para leitor de tela) e espaçamento menor, para conteúdos que não devem rolar. O painel de post tem 1040px e se dimensiona para caber sem rolagem interna em telas comuns; abaixo disso rola por segurança.

## Painel em etapas (fluxo com aprovação)

Para registros com ciclo de vida (o post): quatro etapas na ordem do fluxo, **Planejamento editorial → Aprovação → Publicação → Resultado**, indicador no topo (concluída ✓, atual, bloqueada com 🔒 e motivo no `title`).

- Abre na **próxima pendência**; navegação livre entre etapas liberadas.
- Cada etapa libera por estado e por regra (aprovação depois de produzir; publicação depois das duas aprovações válidas para a versão atual; resultado depois de agendar ou publicar). O servidor continua sendo o controle; a tela só explica o bloqueio.
- Planejamento em três blocos, **O quê / Por quê / Quando**; avisos de estratégia (dia cheio, horário próximo, formato repetido, data passada); checklist antes de aprovar; confirmação exata das ações autorizadas inalterada.
- Editar o que entra no hash do conteúdo invalida as aprovações e a tela avisa antes; editar só o planejamento apenas sinaliza "alterado depois da aprovação".
- Etapa de edição tem "Salvar" e o avanço explícito ("Concluir planejamento", "Ir para a aprovação").

## Prévia no celular

O aparelho simula o Instagram do formato: **Feed/Carrossel** (perfil, arte 4:5, ações, legenda), **Story** (barras de progresso, perfil, menções, "Enviar mensagem") e **Reel** (ações laterais, legenda). Há barra de status (9:41, sinal, bateria) abaixo do entalhe; no Story e no Reel a arte vai até o topo e a barra fica por cima, em branco. Sem arte: "Falta enviar a arte". As cores reproduzem o Instagram e ficam fora dos tokens, em arquivo próprio. A miniatura da lista é o mesmo aparelho reduzido por escala, sem interação; a prévia grande troca de mídia em carrosséis e Stories.

## Cartão detalhado de lista

Miniatura do celular, título, formato, status e selo de mídia, trecho da legenda, **linha do tempo** (Planejado → Produzido → Aprovado → Agendado → Publicado, com a etapa atual uma única vez), data e caminho. Ao passar o cursor o cartão sobe 2px com sombra curta (`0 6px 16px`) e fica acima dos vizinhos (`z-10`); a lista tem folga interna para a sombra não ser cortada pelo rolamento.

## Regras de código

- Detalhe de registro abre em `SidePanel` (nunca embaixo da lista) e traz Anterior/Próximo para revisar em sequência.
- Tudo com `motion-reduce`; nenhuma animação é a única forma de comunicar estado.
