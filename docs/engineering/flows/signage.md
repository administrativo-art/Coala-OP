# Sinalização digital: slides, publicação e heartbeat

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de sinalização](../../../src/app/dashboard/signage/page.tsx) monta [`SignageAdmin`](../../../src/components/signage/signage-admin.tsx). O editor está dividido em [`signage-admin.tsx`](../../../src/components/signage/signage-admin.tsx) (painel, playlist e publicação), [`signage-slide-dialog.tsx`](../../../src/components/signage/signage-slide-dialog.tsx) (formulário do slide, com validação junto do campo), [`signage-copy-dialog.tsx`](../../../src/components/signage/signage-copy-dialog.tsx) (replicação) e [`signage-admin-shared.tsx`](../../../src/components/signage/signage-admin-shared.tsx); as chamadas autenticadas passam por [`authenticatedApiRequest`](../../../src/lib/authenticated-api-client.ts). A interface distingue `signage.view/manage` e também aceita `settings.manageUsers` para gerenciar. O administrador lista, cria, reordena, ativa/desativa e remove slides por [`/api/signage/slides`](../../../src/app/api/signage/slides/route.ts) e [rota individual](../../../src/app/api/signage/slides/%5BslideId%5D/route.ts). Upload de mídia passa por [`/api/signage/upload`](../../../src/app/api/signage/upload/route.ts) para Storage. A API de slides usa [`assertSignageAccess`](../../../src/lib/signage-auth.ts), valida schema e restringe IDs de quiosque ao escopo permitido.

[`POST /api/signage/publish`](../../../src/app/api/signage/publish/route.ts) exige `manage`, saneia quiosques, lê todos os slides e quiosques e gera `publishedPlayers` por quiosque em um batch do banco de sinalização. Essa publicação é separada das escritas de slide/upload; mudanças de slide podem não se refletir no player até nova publicação. [`GET /api/signage/heartbeat`](../../../src/app/api/signage/heartbeat/route.ts) exige `view`, lê todos os heartbeats e filtra os quiosques permitidos em memória.

*(Histórico, anterior a 2026-10-10; ver "Telas, editor e contratos".)* O [POST de heartbeat](../../../src/app/api/signage/heartbeat/route.ts) exigia `kioskId` e quiosque existente, mas não validava token nem login. Grava `playerHeartbeats` no banco de sinalização. Isso diverge da regra aprovada de exigir o token quando configurado. O GET usa `assertSignageAccess` e filtra quiosques permitidos após a leitura.

## Telas, editor e contratos (2026-10-10)

Branch `feat/signage-editor-ux`; comportamento implementado e verificado por typecheck, lint, testes unitários e chamadas sem escrita no servidor local. Sem E2E (emuladores exigem Java, ausente na máquina) e sem tela física.

**Modelo.** A playlist é por **tela**, não por unidade. Toda unidade tem uma tela padrão implícita cujo id é o próprio id da unidade (nome "Tela 1", renomeável por um documento `screens/{kioskId}`; o código de acesso continua em `kiosks.deviceToken`). Telas adicionais são documentos em `screens` do banco de sinalização (`kioskId`, `name`, `deviceToken?`), limitadas a 12 por unidade. Por isso nada foi migrado: slides antigos só têm `kioskIds`, que [`getSlideScreenIds`](../../../src/lib/signage.ts) lê como telas padrão; `publishedPlayers/{id}`, `playerHeartbeats/{id}`, `/tv/{id}` e `/player?kiosk={id}` passam a ser indexados pelo id da tela, que para a tela padrão é o mesmo de antes. Os nomes `kioskId`/`kiosk` nesses caminhos são históricos.

**Slide.** `screenIds` são as telas que exibem; `kioskIds` é derivado no servidor (unidades donas) e serve ao filtro de acesso; `orderByScreen[screenId]` é a posição naquela tela, com `order` como reserva. Arrastar na playlist regrava só `orderByScreen` da tela aberta.

**Rotas** (todas por `secureRoute`; entradas por schema estrito em [`signage.ts`](../../../src/lib/signage.ts), resolução de telas e escopo em [`signage-server.ts`](../../../src/lib/signage-server.ts)):

- [`/api/signage/screens`](../../../src/app/api/signage/screens/route.ts) GET lista as telas das unidades do escopo; POST cria tela adicional (contagem e criação na mesma transação).
- [`/api/signage/screens/[screenId]`](../../../src/app/api/signage/screens/%5BscreenId%5D/route.ts) PATCH renomeia ou troca/remove o código, gerado no servidor; DELETE recusa a tela padrão, desvincula a tela dos slides, apaga os slides que só existiam nela, a publicação e o heartbeat em um batch, e depois a mídia órfã.
- [`/api/signage/slides`](../../../src/app/api/signage/slides/route.ts) e [rota individual](../../../src/app/api/signage/slides/%5BslideId%5D/route.ts): criar exige acesso a todas as telas pedidas. Editar exige alcançar ao menos uma unidade do slide, preserva as telas fora do acesso de quem edita ([`mergeSlideScreenIds`](../../../src/lib/signage.ts)) e recusa incluir tela alheia. Excluir exige acesso a todas as unidades do slide. Antes disto, a edição por um usuário restrito desvinculava em silêncio as unidades que ele não via. `assetPath` só aceita `signage/<arquivo>`, porque o servidor apaga a mídia abandonada.
- [`/api/signage/publish`](../../../src/app/api/signage/publish/route.ts) recebe `screenIds` e recusa (em vez de filtrar em silêncio) telas fora do escopo.
- [`/api/signage/heartbeat`](../../../src/app/api/signage/heartbeat/route.ts) POST e [`/api/signage/public/[kioskId]`](../../../src/app/api/signage/public/%5BkioskId%5D/route.ts) são públicas: a tela é reconhecida pelo id e, **quando tem código configurado, o código é exigido** (`X-Device-Token` no heartbeat; `token` na query ou o mesmo header na leitura). Isso fecha a divergência registrada antes para o heartbeat. Sem código configurado, as duas continuam abertas a quem souber o id.
- Não alteradas e ainda no baseline legado: `asset` e `upload`.

**PUT regrava o documento inteiro** e recusa campos desconhecidos; o editor monta o corpo com `toSlidePayload`, que inclui `schedule`. Antes, reordenar ou pausar um slide apagava o agendamento.

**Editor.** [`signage-admin.tsx`](../../../src/components/signage/signage-admin.tsx) lista unidades (filtradas pelos grupos do DP via `useKioskGroups`), as telas da unidade escolhida e a playlist da tela. "Copiar playlist" vincula os slides da tela de origem às telas de destino, no fim da sequência delas, sem duplicar documento nem mídia e sem publicar. Remover na playlist desvincula só a tela aberta; no último vínculo exclui o slide. O estado da publicação compara `publishedPlayers/{screenId}` (lido direto pelo cliente, regra `allow get: if true`) com o que o editor publicaria agora ([`getPublicationState`](../../../src/lib/signage.ts)); o `updatedAt` do heartbeat indica se a TV já confirmou.

**Lacunas.** Leituras de `publishedPlayers` pelo cliente e o listener do player não passam pelo código de acesso (a regra do banco é pública por id). GET de slides e a publicação leem a coleção `slides` inteira, como antes: slides antigos não têm `screenIds` para filtrar na consulta. Players abertos antes desta versão não enviam `X-Device-Token`; em tela com código, o heartbeat deles é recusado até a página recarregar (recarga diária às 4h).

## Dados, dependências e verificação

O banco de sinalização contém `slides`, `publishedPlayers` e `playerHeartbeats`; quiosques vêm do banco principal e mídia do Storage. Publicação cruza bancos apenas para leitura e escreve no banco de sinalização; exclusão de slide pode envolver Storage. `npm run check` passou na verificação anterior do mapa (2026-09-25). Antes de mudar, conferir autorização por quiosque, MIME/tamanho, remoção de mídia compartilhada, validade da publicação/cache, credencial do player e custo de consultas completas. Player físico e publicação ainda exigem verificação integrada nesta base.

## Player, cache e recuperação rastreados

[`/tv/[kioskId]`](../../../src/app/tv/[kioskId]/page.tsx) redireciona a `/player?kiosk=…`, preservando token. [`SignagePlayer`](../../../src/components/signage/signage-player.tsx) primeiro tenta cache `localStorage` por quiosque, consulta `/api/signage/public/{kioskId}` (token opcional na query) e assina diretamente `publishedPlayers/{kioskId}` no banco de sinalização. Aplica publicação se não for mais antiga que a atual e atualiza o cache. Erro do listener mantém modo offline; watchdog consulta HTTP e recarrega a página se a recuperação falhar. Há recarga diária e filtragem de agenda a cada minuto; rotação respeita duração mínima de 3 segundos e pré-carrega a próxima mídia. A posição da rotação é guardada pelo id do slide e vale para a publicação em que foi marcada ([`resolveActiveSlide`/`getNextSlide`](../../../src/lib/signage.ts)): só uma nova publicação recomeça do primeiro slide. Até 2026-10-09 o relógio da agenda zerava a posição a cada minuto e o que passava de 60 segundos de playlist não era exibido. O período do agendamento é comparado com a data local do aparelho (`getLocalDateKey`), não com a data UTC. Ambos cobertos por [`signage-playlist.test.ts`](../../../tests/unit/signage-playlist.test.ts).

Heartbeat é best-effort e envia quiosque, slide, versão e estado, sem enviar `X-Device-Token` nesta base; sua falha não interrompe a exibição. O token da consulta HTTP não é enviado ao listener Firestore. Consequentemente a revisão de acesso precisa considerar separadamente endpoint público, regras do banco, cache local e heartbeat. A sequência até exibição e recuperação está identificada; execução no dispositivo e eventual proteção de infraestrutura continuam sem verificação.

A [rota HTTP pública](../../../src/app/api/signage/public/[kioskId]/route.ts) exige igualdade do token apenas quando o quiosque possui `deviceToken`; sem token configurado, entrega a publicação após verificar existência do quiosque e documento.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.


## Limites na main

Os E2Es de heartbeat/cache/reconexão do worktree anterior não foram incorporados. O POST continua sem validar o token configurado; o contrato da API HTTP pública é separado do heartbeat e do listener Firestore. TV física permanece adiada; testar codecs, reinício, rede e publicação completa antes de homologar o player.

## App do monitor Samsung (Tizen/SSSP) — 2026-10-10

Estado: implementado e coberto por testes unitários; **não executado em monitor físico**. O que depende do aparelho está listado em "Lacunas".

- **Fonte:** `tizen/coala-signage/` (HTML/JS puro, sem build de front). `js/core.js` guarda as regras sem dependência de tela (agendamento, rotação, plano de download); `js/media.js` usa `tizen.download` e `tizen.filesystem`; `js/app.js` cuida de pareamento, sincronização e reprodução.
- **Pacote:** `node scripts/build-signage-tizen-app.mjs` grava `public/app/CoalaSignage.wgt` e `public/app/sssp_config.xml`. O zip é sem compressão e com datas fixas, então o mesmo fonte gera os mesmos bytes; `--check` (rodado por `tests/unit/signage-tizen-app.test.ts`) falha se o pacote versionado não bater com o fonte. O servidor gravado no pacote é `https://op.coalashakes.com`; `--server=` e `--out=` geram um pacote de teste fora de `public/`.
- **Versão:** o monitor só reinstala quando o `<ver>` do `sssp_config.xml` muda. Toda alteração do app exige subir `version` em `tizen/coala-signage/config.xml` e regerar o pacote. Nenhum verificador obriga a subir a versão.
- **Instalação:** no monitor, URL Launcher com `https://op.coalashakes.com/app`. O endereço aparece no card "Conectar a tela" do editor.
- **Pareamento:** o app pede o código de acesso da tela (8 caracteres, teclado na tela pelo controle remoto) e chama `POST /api/signage/pair`. Tela sem código não pareia. A rota é pública, limitada a 10 tentativas por minuto por IP em memória (por instância), e responde `200 { found: false }` para código desconhecido.
- **Sincronização:** a cada 60 s o app manda `POST /api/signage/heartbeat` com `status: 'app'`, `appVersion` e o código no corpo (`token`). A resposta traz `publishedAt`; só quando ele muda o app busca `GET /api/signage/public/{telaId}?token=`. Não há leitura periódica da playlist.
- **Offline:** as mídias vão para o disco do monitor e a playlist fica no `localStorage`. Publicação nova só entra no ar depois que as mídias dela baixaram (ou após 5 tentativas, sem os slides que faltam); a anterior segue tocando enquanto isso. Arquivos fora da playlist vigente são apagados.
- **Requisição simples:** o app roda em `file://`. Os POSTs usam `Content-Type: text/plain` e as três rotas públicas do player respondem `Access-Control-Allow-Origin: *` no sucesso, para não depender de preflight nem de o runtime do Tizen ignorar CORS.
- **Controle remoto:** OK durante a reprodução abre o painel com situação, publicação, mídias e versão, e "Trocar de tela" (com confirmação) desfaz o pareamento e apaga as mídias.

- **Página de aplicativos:** `/app` exige login (verificado no cliente, com retorno por `/login?next=/app`) e lista dois produtos diferentes, definidos em `COALA_APP_INSTALLERS` (`src/lib/signage.ts`): o **Coala Signage APP** (este app das telas, pacote Samsung) e o **Coala Mobile APP** (smartphones e tablets Android; outro produto, fora deste fluxo). A abertura da página e cada download gravam um documento em `appDownloads` (banco do signage) por `POST /api/signage/app/downloads`, com usuário, aplicativo e horário; a página não exibe esse registro (leitura fica com o log do sistema). O download só começa depois do registro. Os arquivos de `public/app/` continuam acessíveis por endereço direto, sem login: o URL Launcher do Samsung precisa disso. O APK do Coala Mobile ainda não existe (`mobile.packagePath: null`, botão desativado); o destino combinado é `public/app/CoalaMobile.apk`. Não há versão Android do Signage APP.

### Custo (preflight)

Por tela com o app: 1.440 sinais de vida por dia. Cada um lê 2 documentos para resolver a tela (3 em tela adicional) e 1 de `publishedPlayers`, e grava 1 em `playerHeartbeats`. Com 3 telas: cerca de 13 a 17 mil leituras e 4,3 mil escritas por dia. A leitura de `publishedPlayers` é o acréscimo deste trabalho (+1 por sinal de vida, também para o player web). O pareamento faz 2 consultas por igualdade com `limit(2)` e só roda quando alguém digita um código.

### Lacunas

- `.wgt` **sem assinatura** (Tizen Studio não está instalado). Não foi confirmado que o QM32C aceita pacote não assinado pelo URL Launcher; se recusar, é preciso assinar com certificado de autor pelo Tizen Studio.
- Não confirmado no aparelho: pasta de destino do `tizen.download` (`wgt-private`, com troca automática para `downloads`), formato do caminho devolvido, reprodução de `file://` em `<video>`, teclas do controle e troca entre dois vídeos seguidos.
- Respostas de erro (403/404) das rotas públicas não levam o cabeçalho de CORS; em runtime que aplique CORS o app as trata como falta de contato.
- O limite de tentativas do pareamento é por instância do servidor, não global.

## Biblioteca e cópia com origem (2026-10-10)

Estado: implementado com testes unitários; escritas não exercitadas contra banco e telas não vistas renderizadas.

### Biblioteca de mídias

- Segue o desenho da biblioteca do Coala Pulse (`src/features/instagram-scheduler/media-library*`): envio, pastas, busca por nome, filtro por tipo e "só as sem uso". Diferenças: pastas em um nível só, sem arrastar e soltar, sem paginação (teto de 300 mídias e 50 pastas), e dados próprios no banco do signage (`mediaLibrary`, `mediaFolders`). Não compartilha itens com a biblioteca do Pulse, que é privada por workspace e tem limites do Instagram.
- O id do documento em `mediaLibrary` é derivado do `assetPath`, então registrar o mesmo arquivo duas vezes cai no mesmo documento. O slide continua guardando só `assetPath`; o player e o app não mudaram.
- Rotas (todas `secureRoute`): `GET/POST /api/signage/media`, `PATCH/DELETE /api/signage/media/[mediaId]`, `POST /api/signage/media/folders`, `PATCH/DELETE /api/signage/media/folders/[folderId]`, `POST /api/signage/media/import`. Ver exige `signage.view`; alterar exige `signage.manage`. A biblioteca é única para todo o signage, sem recorte por unidade.
- O envio pelo modal do slide passou a usar `POST /api/signage/media`, então toda mídia nova entra na biblioteca. `POST /api/signage/upload` ficou sem chamador no editor e segue como rota legada.
- Excluir mídia em uso é recusado (409) com conferência no servidor em todos os slides. Excluir um slide não apaga mais o arquivo quando ele está na biblioteca (`deleteSignageAssetIfOrphaned`).
- Mídias anteriores à biblioteca só existem nos slides; "Trazer para a biblioteca" (`/media/import`) as registra. A ação lê até 1.000 slides e é manual.
- Limites inalterados: imagem 2 MB, vídeo MP4 30 MB.

### Copiar playlist

- O modal passou a ter "Copiar de": qualquer tela visível pode ser a origem, com a contagem e as miniaturas dos slides dela. Antes a origem era sempre a tela aberta.

### Custo (preflight)

- Biblioteca: abrir o modal lê até 300 documentos de `mediaLibrary` e até 50 de `mediaFolders`; não há leitura periódica. Excluir mídia faz 1 consulta com `limit(1)`. Excluir slide faz +1 leitura de `mediaLibrary`.
- Página `/app`: 1 escrita por abertura e 1 por download; nenhuma leitura.

### Lacunas

- Biblioteca aberta por cima do modal do slide (dois diálogos empilhados) não foi vista funcionando.
- Usuário com acesso restrito a unidades vê e pode excluir qualquer mídia sem uso da biblioteca.
- A contagem "em uso" no editor considera só os slides que quem edita enxerga; a recusa de exclusão no servidor considera todos.
