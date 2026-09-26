# Sinalização digital: slides, publicação e heartbeat

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de sinalização](../../../src/app/dashboard/signage/page.tsx) monta [`SignageAdmin`](../../../src/components/signage/signage-admin.tsx). A interface distingue `signage.view/manage` e também aceita `settings.manageUsers` para gerenciar. O administrador lista, cria, reordena, ativa/desativa e remove slides por [`/api/signage/slides`](../../../src/app/api/signage/slides/route.ts) e [rota individual](../../../src/app/api/signage/slides/%5BslideId%5D/route.ts). Upload de mídia passa por [`/api/signage/upload`](../../../src/app/api/signage/upload/route.ts) para Storage. A API de slides usa [`assertSignageAccess`](../../../src/lib/signage-auth.ts), valida schema e restringe IDs de quiosque ao escopo permitido.

[`POST /api/signage/publish`](../../../src/app/api/signage/publish/route.ts) exige `manage`, saneia quiosques, lê todos os slides e quiosques e gera `publishedPlayers` por quiosque em um batch do banco de sinalização. Essa publicação é separada das escritas de slide/upload; mudanças de slide podem não se refletir no player até nova publicação. [`GET /api/signage/heartbeat`](../../../src/app/api/signage/heartbeat/route.ts) exige `view`, lê todos os heartbeats e filtra os quiosques permitidos em memória.

O [POST de heartbeat](../../../src/app/api/signage/heartbeat/route.ts) exige `kioskId` e quiosque existente, mas não valida token nem login nesta base. Grava `playerHeartbeats` no banco de sinalização. Isso diverge da regra aprovada de exigir o token quando configurado. O GET usa `assertSignageAccess` e filtra quiosques permitidos após a leitura.

## Dados, dependências e verificação

O banco de sinalização contém `slides`, `publishedPlayers` e `playerHeartbeats`; quiosques vêm do banco principal e mídia do Storage. Publicação cruza bancos apenas para leitura e escreve no banco de sinalização; exclusão de slide pode envolver Storage. `npm run check` passou na verificação anterior do mapa (2026-09-25). Antes de mudar, conferir autorização por quiosque, MIME/tamanho, remoção de mídia compartilhada, validade da publicação/cache, credencial do player e custo de consultas completas. Player físico e publicação ainda exigem verificação integrada nesta base.

## Player, cache e recuperação rastreados

[`/tv/[kioskId]`](../../../src/app/tv/[kioskId]/page.tsx) redireciona a `/player?kiosk=…`, preservando token. [`SignagePlayer`](../../../src/components/signage/signage-player.tsx) primeiro tenta cache `localStorage` por quiosque, consulta `/api/signage/public/{kioskId}` (token opcional na query) e assina diretamente `publishedPlayers/{kioskId}` no banco de sinalização. Aplica publicação se não for mais antiga que a atual e atualiza o cache. Erro do listener mantém modo offline; watchdog consulta HTTP e recarrega a página se a recuperação falhar. Há recarga diária e filtragem de agenda a cada minuto; rotação respeita duração mínima de 3 segundos e pré-carrega a próxima mídia.

Heartbeat é best-effort e envia quiosque, slide, versão e estado, sem enviar `X-Device-Token` nesta base; sua falha não interrompe a exibição. O token da consulta HTTP não é enviado ao listener Firestore. Consequentemente a revisão de acesso precisa considerar separadamente endpoint público, regras do banco, cache local e heartbeat. A sequência até exibição e recuperação está identificada; execução no dispositivo e eventual proteção de infraestrutura continuam sem verificação.

A [rota HTTP pública](../../../src/app/api/signage/public/[kioskId]/route.ts) exige igualdade do token apenas quando o quiosque possui `deviceToken`; sem token configurado, entrega a publicação após verificar existência do quiosque e documento.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.


## Limites na main

Os E2Es de heartbeat/cache/reconexão do worktree anterior não foram incorporados. O POST continua sem validar o token configurado; o contrato da API HTTP pública é separado do heartbeat e do listener Firestore. TV física permanece adiada; testar codecs, reinício, rede e publicação completa antes de homologar o player.
