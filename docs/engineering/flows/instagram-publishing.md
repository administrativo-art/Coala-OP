# Publicação programada no Instagram

## Escopo

Este fluxo agenda e publica conteúdo apenas no Instagram profissional `@coalashakes`. Aceita imagem no feed, carrossel com 2 a 10 mídias, reel e story. Não cria anúncios e não ingere leads nesta etapa; as permissões da Meta já podem sustentar evoluções separadas.

A Meta não fornece ao Coala uma agenda unificada dos conteúdos criados no aplicativo do Instagram ou no Meta Business Suite. A página exclusiva lista somente documentos criados pela CLI do Coala. Conteúdo programado no aplicativo deve ser conferido em **Perfil → menu → Conteúdo programado**; conteúdo criado no Business Suite permanece no Planner.

## Entradas e dados

- [`scripts/instagram-schedule.mts`](../../../scripts/instagram-schedule.mts) valida horário, legenda e arquivos, envia a mídia ao Storage e cria um documento em `instagramScheduledPosts`.
- [`instagramPublishingScheduler`](../../../functions/src/instagram-publishing-job.ts) consulta no máximo dois documentos vencidos por minuto e publica pela Instagram Graph API.
- [`/api/integrations/instagram/schedule`](../../../src/app/api/integrations/instagram/schedule/route.ts) lista no máximo 100 documentos do workspace autenticado.
- [`/api/integrations/instagram/schedule/[id]/media/[index]`](../../../src/app/api/integrations/instagram/schedule/[id]/media/[index]/route.ts) entrega a prévia da imagem somente depois de autenticação e autorização; a URL de entrega da Meta não é exposta ao cliente.
- [`/instagram-programacao`](../../../src/app/instagram-programacao/page.tsx) é uma página sem item de navegação, destinada à conferência da fila, da imagem, da proporção, da legenda, do horário e da localização.

O documento guarda `workspace_id`, conta do Instagram, formato, horário, legenda, metadados das mídias, URLs de entrega, tentativas, lease, progresso dos contêineres e resultado. As regras negam acesso direto à coleção e a `storage/instagram`; CLI, API e Function usam Admin SDK.

## Autorização e segredos

A API exige Firebase Auth e [`requireInstagramSchedulerAccess`](../../../src/features/instagram-scheduler/access.server.ts). Quando `INSTAGRAM_SCHEDULER_ALLOWED_EMAILS` estiver configurado, somente os e-mails dessa lista entram. Sem a variável, o fallback é administrador padrão para permitir operação local controlada. A UI não é a fronteira de autorização.

`META_SYSTEM_USER_TOKEN` é lido pela Function com `defineSecret`; não entra em código, Firestore, resposta HTTP, argumento da CLI ou log. O ID da conta profissional fica no documento da fila e não é credencial. A versão Graph tem padrão `v25.0` em `META_GRAPH_API_VERSION`.

## Estados e repetição

`scheduled` passa a `processing` por transação com lease. O publicador persiste cada ID de contêiner antes da etapa seguinte e só então chama `media_publish`. Sucesso grava `published`, ID da mídia e, quando disponível, permalink.

Falhas temporárias antes de `media_publish` podem retornar a `scheduled`, com atraso e limite de quatro tentativas. Se a resposta de `media_publish` for interrompida, o estado passa a `manual_review`: repetir automaticamente poderia criar uma postagem duplicada. Lease vencido depois do início dessa chamada segue a mesma regra. `failed` encerra erro explícito ou limite de tentativas; `cancelled` fica reservado para operação futura.

Storage e Firestore não formam uma transação global. A CLI remove os objetos que ela já enviou se falhar antes da criação do documento. Uma interrupção do processo local durante o upload pode deixar objeto órfão; esse caso deve ser tratado por manutenção posterior, sem varrer a coleção no caminho quente.

## Custo de consultas

O job faz uma consulta limitada por minuto em `workspace_id + status + wakeAt`, mesmo sem itens: ordem de grandeza de **43.200 consultas por mês**. Cada execução retorna no máximo dois documentos. A página faz uma consulta limitada a 100 documentos somente quando aberta ou quando o usuário aciona **Atualizar**; cada prévia de imagem confere novamente um documento antes de ler o Storage. Dez visualizações diárias no pior caso de 100 publicações com imagem representam até **60.000 leituras por mês** (30.000 da lista e 30.000 das prévias). Não há listener nem polling no navegador.

## Operação e teste

Antes do primeiro teste, implantar juntos a Function, os índices e as regras. Confirmar que `META_SYSTEM_USER_TOKEN` está vinculado à Function e que o serviço de execução lê os objetos do bucket. Para acesso exclusivo em produção, configurar `INSTAGRAM_SCHEDULER_ALLOWED_EMAILS` no App Hosting.

Validar um arquivo sem escrever:

```bash
npm run instagram:schedule -- --format feed --media ./post.jpg --at 2026-09-29T10:00:00-03:00 --caption "Teste" --dry-run
```

Remover `--dry-run` cria a fila e envia a mídia. O horário exige pelo menos dois minutos de antecedência. JPG tem limite local de 8 MB; MP4/MOV, 300 MB. Imagens de feed e carrossel são validadas entre 4:5 e 1,91:1; a página mostra a prévia e as dimensões. A opção `--location-id` recebe o ID numérico da Página de local da Meta e deve ser acompanhada por `--location-name`, usado na conferência. A aceitação final de duração, codec e localização pertence à Meta e aparece no estado da fila se houver rejeição.

## Verificação

- `npm run typecheck`
- `npm --prefix functions run build`
- `npm run test:unit`
- `npm run check:rules`
- `python3 scripts/generate-surface-inventory.py --check`
- `python3 scripts/check-flow-matrix.py`
- `python3 scripts/check-engineering-docs.py`

Não usar uma publicação real como teste automático. Publicar externamente exige mídia, legenda, horário e autorização de implantação/publicação do usuário.
