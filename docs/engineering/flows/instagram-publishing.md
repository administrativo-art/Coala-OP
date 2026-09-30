# Publicação programada no Instagram

## Escopo

Este fluxo agenda e publica conteúdo apenas no Instagram profissional `@coalashakes`. Aceita imagem no feed, carrossel com 2 a 10 mídias, reel e sequência de 1 a 10 Stories. Não cria anúncios e não ingere leads nesta etapa; as permissões da Meta já podem sustentar evoluções separadas.

A Meta não fornece ao Coala uma agenda unificada dos conteúdos futuros criados no aplicativo do Instagram ou no Meta Business Suite. O calendário lista somente documentos criados pela fila do Coala. Conteúdo programado no aplicativo deve ser conferido em **Perfil → menu → Conteúdo programado**; conteúdo criado no Business Suite permanece no Planner. A grade, por outro lado, combina a fila local com as 18 publicações recentes já publicadas retornadas pela Graph API.

## Entradas e dados

- [`scripts/instagram-schedule.mts`](../../../scripts/instagram-schedule.mts) valida horário, legenda e arquivos, envia a mídia ao Storage e cria um documento em `instagramScheduledPosts`.
- [`instagramPublishingScheduler`](../../../functions/src/instagram-publishing-job.ts) consulta no máximo dois documentos vencidos por minuto e publica pela Instagram Graph API.
- [`/api/integrations/instagram/schedule`](../../../src/app/api/integrations/instagram/schedule/route.ts) lista no máximo 100 documentos do workspace autenticado e cria agendamentos enviados pelo editor. O servidor detecta a mídia pelo conteúdo, converte PNG/WebP para JPG antes da fila e compensa objetos já enviados se a criação falhar.
- [`/api/integrations/instagram/schedule/[id]`](../../../src/app/api/integrations/instagram/schedule/%5Bid%5D/route.ts) altera a data de uma publicação ainda programada, reorganiza todas as mídias de uma sequência de Stories ou troca atomicamente as datas de duas publicações do mesmo workspace. A transação também atualiza `nextAttemptAt` e `wakeAt`, invalida progresso antigo quando a ordem muda e registra o ator em `events`.
- [`/api/integrations/instagram/schedule/[id]/media/[index]`](../../../src/app/api/integrations/instagram/schedule/[id]/media/[index]/route.ts) entrega a prévia da imagem somente depois de autenticação e autorização; a URL de entrega da Meta não é exposta ao cliente.
- [`/api/integrations/instagram/feed`](../../../src/app/api/integrations/instagram/feed/route.ts) consulta, sob demanda e depois da mesma autorização, o perfil e até 18 publicações recentes da conta profissional. A resposta não contém token e usa cache privado curto.
- [`/api/integrations/instagram/media`](../../../src/app/api/integrations/instagram/media/route.ts) lista até 100 arquivos da biblioteca e recebe uploads privados. [`/api/integrations/instagram/media/[id]`](../../../src/app/api/integrations/instagram/media/%5Bid%5D/route.ts) revalida usuário, workspace, documento e caminho antes de entregar cada arquivo.
- [`/instagram-programacao`](../../../src/app/instagram-programacao/page.tsx) reúne calendário semanal/mensal, grade do feed e biblioteca de mídia. Os demais itens da sidebar são marcadores visuais para evolução futura e não executam operações.

O documento de agendamento guarda `workspace_id`, conta do Instagram, formato, horário, legenda, menções de Story, metadados das mídias em ordem, URLs de entrega, tentativas, lease, progresso por quadro e resultado. A biblioteca usa `instagramMediaLibrary` com pasta, metadados técnicos e caminho privado `instagram/library/{workspace}/{id}`. As duas coleções ficam no banco nomeado `coala-signage`, adotado também como banco de Marketing; os arquivos continuam no bucket principal. As regras negam acesso direto às coleções e a todo `storage/instagram`; CLI, APIs e Function usam Admin SDK. Durante o desenvolvimento anterior ao corte, as APIs também leem o banco legado `coala`, removem duplicidades por ID e priorizam o documento de `coala-signage`. Essa ponte pode ser habilitada temporariamente em produção com `INSTAGRAM_MARKETING_ENABLE_LEGACY_READS=true`, mas o rollout normal migra antes de publicar a nova aplicação.

## Workspace editorial

O calendário carrega a programação uma vez ao abrir e somente repete a consulta por ação do usuário ou depois de uma alteração. O botão global, o `+` de cada data e a ação **Mais uma publicação** abrem o editor já no dia escolhido; não existe unicidade por data ou horário, portanto o operador pode planejar vários conteúdos no mesmo dia. O editor aceita Feed, Carrossel, Reel ou uma sequência ordenada de 1 a 10 Stories, legenda para os formatos que a exibem, horário, menções invisíveis de Story, localização conhecida e compartilhamento do Reel na grade. O campo de legenda é omitido em Stories e o envio força esse valor vazio. Toda mídia selecionada recebe uma prévia grande no próprio editor: Feed e Carrossel simulam o cartão da publicação, Reel usa enquadramento vertical e Stories reproduzem a sequência vertical; Carrossel e Stories aceitam arraste lateral, setas e indicadores. A legenda completa aparece na prévia de Feed, Carrossel e Reel, preservando espaços e quebras de linha conforme a digitação. Em telas largas, lista e prévia dividem igualmente a área e, em telas estreitas, ficam empilhadas. O campo de menções sugere arrobas presentes no histórico local; a Graph API não fornece busca parcial global equivalente ao aplicativo, e perfis novos exigem o username exato. A prévia contextual acompanha data, horário e formato: mostra os agendamentos entre D−2 e D+2 e, quando o conteúdo entra no feed, insere a nova mídia na posição cronológica esperada junto da programação e das publicações recentes da Meta. O painel da grade é ocultado em Stories e Reels sem compartilhamento, pois esses formatos não alteram o feed. O seletor de data segue o padrão de Despesas, com popover para dia, mês e ano; o horário é digitado em `HH:MM` e recebe a máscara durante a entrada. Ao criar para o dia atual, o editor calcula no fuso de São Luís o primeiro minuto que respeita a antecedência de dois minutos, preenche esse horário e bloqueia datas e horários anteriores; o limite é atualizado enquanto o formulário permanece aberto. Clicar na arte abre os detalhes, a prévia e, para itens em `scheduled`, os campos de data e horário. Arrastar um card para um dia conserva o horário de São Luís (`America/Belem`), e dias anteriores não aceitam soltar o card; o campo de data oferece a mesma operação sem depender de arrastar. Somente o estado `scheduled` aceita mudança e o novo horário precisa ter pelo menos dois minutos de antecedência.

A tela de detalhes adapta a prévia ao formato selecionado: feed em 4:5 com localização, ações e legenda; carrossel com navegação entre mídias; reel e Story em 9:16. Uma sequência de Stories ocupa um único card, identificado por **Sequência · N Stories**, ordem numérica e menções; ao abrir, mostra barras de progresso, permite avançar e voltar na prévia e, enquanto estiver programada, oferece controles para mover cada quadro antes ou depois. Stories independentes, criados como agendamentos distintos, permanecem em cards separados. A API exige uma permutação completa, portanto nenhuma mídia pode ser omitida ou repetida ao salvar. A prévia reproduz composição e recorte, sem prometer igualdade de pixels com todas as versões do aplicativo do Instagram. Story é apresentado diretamente no editor, sem navegação por avatar. O publicador não envia `caption` no contêiner de Story. A Graph API v25 aceita `user_tags` em Stories; a mesma lista de menções é aplicada a cada quadro e, sem coordenadas, a menção é enviada sem adesivo visível. Adesivos de localização, link e enquete não são suportados pela publicação via API. Texto e sobreposições visuais precisam fazer parte da mídia final.

A grade considera feed, carrossel e reels compartilhados no feed. Ela mescla os itens futuros da fila com as publicações recentes da conta e remove duplicidades por permalink. Arrastar uma publicação local sobre outra troca as datas dentro de uma transação, desde que ambas continuem programadas; itens lidos da Meta são somente de consulta. A Meta não oferece ordenação personalizada nessa leitura, portanto fixações feitas no aplicativo podem aparecer em posição diferente. A análise de vizinhança e a contagem por formato são projeções do conjunto limitado retornado.

### Recursos criativos da Meta

A API oficial de áudio permite pesquisar músicas e sons originais autorizados e anexá-los a **Reels** por `audio_configuration`, com volumes separados para música e áudio do vídeo. O catálogo disponível pela API pode ser menor que o aplicativo, e a Meta não fornece prévia do Reel já combinado. Essa capacidade foi validada em leitura para a conta Coala, mas a seleção de música ainda não faz parte da interface atual. Música da biblioteca não é aceita em Stories nem em publicações de imagem por esse fluxo. `audio_name` apenas nomeia o áudio original de um Reel.

Filtros do Instagram não são suportados. Capa, localização, marcações e colaboradores têm suporte por formato conforme o endpoint; o sistema deve validar cada combinação antes de mostrar o controle. Texto, molduras, filtros próprios e outras composições podem ser gerados pelo Coala One como parte do arquivo final, sem criar camadas editáveis no Instagram. Referências: [Content Publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing), [IG User Media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media) e [Instagram Audio API](https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api).

A biblioteca é carregada apenas ao abrir seu módulo. Ela combina uploads próprios com as mídias já usadas nos agendamentos, oferece busca e filtros locais e envia no máximo dez arquivos por seleção, um pedido por arquivo. A listagem usa o índice de `workspace_id + createdAt`; durante a criação desse índice, a API mantém uma consulta limitada e ordena o conjunto retornado em memória. O upload aceita JPG, PNG ou WebP até 8 MB e MP4 ou MOV até 24 MB; o servidor detecta o formato pelo conteúdo e não confia apenas no nome ou no MIME informado pelo navegador. Vídeos aparecem com placeholder nesta etapa; geração de thumbnail e alteração da mídia ou legenda ficam para evolução futura.

## Autorização e segredos

Todas as APIs do workspace exigem Firebase Auth e [`requireInstagramSchedulerAccess`](../../../src/features/instagram-scheduler/access.server.ts). Quando `INSTAGRAM_SCHEDULER_ALLOWED_EMAILS` estiver configurado, somente os e-mails dessa lista entram. Sem a variável, o fallback é administrador padrão para permitir operação local controlada. A UI não é a fronteira de autorização.

`META_SYSTEM_USER_TOKEN` é lido pela Function com `defineSecret` e pelo servidor do App Hosting por vínculo de Secret Manager; não entra em código, Firestore, resposta HTTP, argumento da CLI ou log. Em desenvolvimento, a consulta da grade usa a credencial Google local para ler a mesma versão do segredo. O ID da conta profissional fica no documento da fila e não é credencial. A versão Graph tem padrão `v25.0` em `META_GRAPH_API_VERSION`.

## Estados e repetição

`scheduled` passa a `processing` por transação com lease. O publicador persiste cada ID de contêiner antes da etapa seguinte e só então chama `media_publish`. Feed, carrossel e Reel concluem uma chamada de publicação. Uma sequência de Stories cria e publica um contêiner por quadro, estritamente na ordem armazenada, e grava ID, início da chamada e confirmação de cada item antes de avançar. Ao concluir todos, o documento recebe `published` e a lista `publishedMediaIds`; Stories não expõem permalink por este fluxo. Depois que o primeiro quadro foi confirmado pela Meta, data e ordem deixam de ser editáveis. Publicações feitas simultaneamente fora do Coala podem aparecer intercaladas entre os quadros, porque não existe uma transação de álbum para Stories.

Falhas temporárias antes de `media_publish` podem retornar a `scheduled`, com atraso e limite de quatro tentativas. Em uma sequência, os quadros já confirmados são ignorados na retomada e o job continua no primeiro item pendente; não há exclusão automática dos Stories já publicados. Se a resposta de qualquer `media_publish` for interrompida, o estado passa a `manual_review`: repetir automaticamente poderia criar um Story duplicado. Lease vencido depois do início dessa chamada segue a mesma regra. `failed` encerra erro explícito ou limite de tentativas; `cancelled` fica reservado para operação futura.

Storage e Firestore não formam uma transação global. A CLI e o editor removem os objetos que já enviaram se a criação da fila falhar. O upload da biblioteca também tenta apagar o objeto se a criação do documento falhar. Uma interrupção depois da gravação no Storage e antes da compensação ainda pode deixar objeto órfão; esse caso deve ser tratado por manutenção posterior, sem varrer a coleção no caminho quente.

## Custo de consultas

O job faz uma consulta limitada por minuto em `workspace_id + status + wakeAt`, mesmo sem itens: ordem de grandeza de **43.200 consultas por mês**. Cada execução retorna no máximo dois documentos. Cada quadro adicional de uma sequência de Stories acrescenta uma criação de contêiner, uma publicação na Graph API e gravações de progresso; o grupo continua sendo uma única leitura da fila. Calendário e grade compartilham uma consulta limitada a 100 agendamentos, feita ao abrir, atualizar ou concluir uma mutação. Durante a ponte legada, cada listagem consulta os dois bancos; depois do corte volta a uma consulta. Ao abrir a grade, uma consulta sob demanda carrega perfil e até 18 mídias da Meta; não há polling. A biblioteca adiciona uma consulta limitada a 100 documentos somente quando o módulo é aberto ou depois de upload. Com dez aberturas diárias no teto, cada listagem pode chegar a 30.000 leituras mensais por banco durante a ponte; prévias visíveis acrescentam uma leitura de documento em `coala-signage` e, quando ausente, outra no legado, além de uma leitura de objeto. Não há listener no navegador.

## Operação e teste

O corte do publicador para `coala-signage` foi executado em 2026-09-29: regras e três índices foram implantados, todos os índices chegaram a `READY`, a Function ficou `ACTIVE` com `META_SYSTEM_USER_TOKEN` vinculado e o primeiro Feed vencido foi publicado com sucesso. Para liberar a interface exclusiva em produção, ainda é necessário publicar a aplicação com `INSTAGRAM_SCHEDULER_ALLOWED_EMAILS` no App Hosting.

Validar um arquivo sem escrever:

```bash
npm run instagram:schedule -- --format feed --media ./post.jpg --at 2026-09-29T10:00:00-03:00 --caption "Teste" --dry-run
```

Remover `--dry-run` cria a fila e envia a mídia. O horário exige pelo menos dois minutos de antecedência. Na CLI, JPG tem limite local de 8 MB e MP4/MOV, 300 MB; a biblioteca HTTP usa os limites menores descritos acima. Imagens de feed e carrossel são validadas entre 4:5 e 1,91:1; a página mostra a prévia e as dimensões. A opção `--location-id` recebe o ID numérico da Página de local da Meta e deve ser acompanhada por `--location-name`, usado na conferência. Para Story, `--mention usuario` pode ser repetido e envia `user_tags` sem adesivo. A aceitação final de duração, codec, localização e marcação pertence à Meta e aparece no estado da fila se houver rejeição.

Para programar uma sequência, repetir `--media` na ordem de publicação:

```bash
npm run instagram:schedule -- --format story --media ./01.jpg --media ./02.jpg --media ./03.mp4 --at 2026-10-01T10:00:00-03:00
```

### Corte do banco de Marketing

[`scripts/migrate-instagram-marketing-db.mts`](../../../scripts/migrate-instagram-marketing-db.mts) copia `instagramScheduledPosts`, seus eventos e `instagramMediaLibrary` de `coala` para `coala-signage`. Sem `--apply`, o comando inventaria origem e destino, informa quantos documentos faltam e confirma que não há publicação em processamento. A aplicação usa `create`, preserva documentos já existentes no destino e pode ser repetida: depois do corte realizado, a segunda execução informou zero gravações pendentes. Regras e índices devem entrar primeiro; quando não houver item vencido ou prestes a vencer na origem, a cópia pode ser aplicada e seguida imediatamente pela troca do job. Se houver item iminente, o Scheduler precisa ser pausado durante a janela para impedir publicação duplicada. A origem não é apagada automaticamente e permanece como arquivo de reversão.

```bash
npm run instagram:migrate-marketing-db
npm run instagram:migrate-marketing-db -- --apply
```

## Verificação

- `npm run typecheck`
- `npm --prefix functions run build`
- `npm run test:unit`
- `npm run check:rules`
- `python3 scripts/generate-surface-inventory.py --check`
- `python3 scripts/check-flow-matrix.py`
- `python3 scripts/check-engineering-docs.py`

Não usar uma publicação real como teste automático. Publicar externamente exige mídia, legenda, horário e autorização de implantação/publicação do usuário.
