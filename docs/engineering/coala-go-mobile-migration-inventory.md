# Coala Go — inventário da migração mobile

Status: Etapa 0 — levantamento concluído; aguardando revisão.

Este documento registra o levantamento inicial do aplicativo legado em `apps/coala-notas`. Na Etapa0 nenhuma rota `/api/...` foi alterada. Decisões posteriores estão ao final e na [matriz atual](coala-go-parity.md). Após confirmar que não havia usuários, o responsável autorizou remover o Expo e trabalhar somente com Go; o legado foi retirado nesta branch, mantendo histórico e checkout original. Descrições abaixo são inventário histórico, não caminhos atuais de código.

## Escopo, nomenclatura e compatibilidade (decisões iniciais)

| Superfície | Decisão nesta migração |
|---|---|
| Nome externo exibido | `Coala Go`, sujeito à confirmação final de branding |
| Nova pasta | `apps/coala-one-android` |
| Pasta legada | Manter `apps/coala-notas` até a paridade |
| `applicationId`/package Android | Manter `com.coalaone.notas` para permitir atualização por cima |
| Chave de assinatura | Reutilizar o processo de `~/.coala-one`; nunca ler, imprimir ou copiar a chave |
| Rotas, IDs de permissão e contratos | Não alterar |
| Diretórios internos legados | Não renomear durante a migração; avaliar compatibilidade de dados separadamente |

Há uma inconsistência a resolver: a solicitação inicial pede a marca `Coala One` em uma etapa posterior, enquanto a solicitação mais recente pede `Coala Go`. A recomendação é usar `Coala Go` nos textos de produto quando a decisão for confirmada, mas preservar package, assinatura, namespaces de permissão e contratos técnicos.

### Decisão sobre `src/ui.tsx`

A alteração local existente em `apps/coala-notas/src/ui.tsx` é um workaround de clipping do texto SVG: aumenta a largura do SVG, desloca o desenho e centraliza `Coala`/`One` e o slogan com padding calculado. Ela não é necessária para a migração Kotlin e não deve ser portada para Compose.

Na implementação nativa, a marca deverá ser desenhada como texto Compose com `Brush` no `TextStyle`, gradiente animado e largura/layout testados para não cortar o texto. O diff existente no checkout original foi preservado; esta branch não o incorpora.

## Telas e fluxos

### Autenticação e segurança de sessão

- Login por Firebase Auth com e-mail e senha.
- Recuperação de senha por `POST /api/auth/forgot-password`, com resposta que não revela se a conta existe.
- Tela de confirmação de envio do e-mail.
- Sessão Firebase restaurada inicia bloqueada quando aplicável.
- Desbloqueio por senha com reautenticação Firebase.
- Biometria opcional, somente biometria forte, sem fallback para PIN; preferência vinculada ao UID e válida por sete dias.
- Bloqueio ao voltar ao app após mais de cinco minutos em background ou quando o app foi deixado bloqueado.
- Simulação somente em desenvolvimento; não deve ser enviada em produção.

### Home e perfil

- Saudação, avatar e módulos disponíveis.
- Avatar por câmera frontal ou seletor do sistema; imagem até 5 MB.
- Upload da própria foto de perfil.
- Contador de itens pendentes na fila offline.
- Saída da conta.
- Módulos visíveis conforme `modules` retornado pelo perfil: Compra local, Contagem de estoque, Recebimento de reposição, Metas, Escala e Signage.

### Compra local

- Lista de sangrias disponíveis e compras aguardando conciliação.
- Contexto de unidades, contas, centros de resultado e, quando autorizado, produtos de estoque.
- Captura ou seleção de até duas notas e até dois comprovantes de pagamento por envio.
- Origem `cash_withdrawal` ou `company_payment`.
- Nota opcional até 240 caracteres; arquivos JPG, PNG, WEBP ou PDF; cada arquivo até 15 MB e total até 25 MB.
- Geração de `submissionId` UUID e `capturedAt`.
- Fila offline cifrada, retry automático/manual e proteção contra duplicidade.
- Revisão dos dados extraídos: fornecedor, CNPJ, data, total, pagamento, categoria, centro de resultado e itens.
- Itens podem ser vinculados ao estoque com produto, quantidade e validade.
- Confirmação com soma dos itens igual ao total.
- Conciliação posterior com sangria quando necessário.

### Contagem de estoque

- Seleção de unidade e início ou retomada de sessão.
- Exibição de lotes, foto e instrução de contagem.
- Três produtos por etapa, busca e filtro de alterados.
- Saída, motivo, observação, entrada e observação de entrada.
- Decimal no formato usado pelo operador brasileiro; quantidades não podem ser negativas.
- Motivo `Outros` exige observação mínima.
- Rascunho local salvo durante a edição.
- Merge entre rascunho local e sessão do servidor pelo `updatedAt`/`savedAt`.
- Saída salva como rascunho no servidor; conclusão envia apenas lotes alterados.
- Cancelamento explícito da sessão aberta, sem alteração de estoque.

### Recebimento de reposição

- Lista de reposições aguardando recebimento nas unidades acessíveis.
- Agrupamento por produto e lotes em etapas de três produtos.
- Quantidade inicialmente igual à enviada.
- Divergência exige observação; não permite lote faltante, extra, duplicado ou de outra atividade.
- Confirmação é irreversível no aplicativo.
- O recebimento não movimenta o estoque; a entrada acontece quando a reposição é efetivada no sistema web.
- Falha atual confirmada: `ReceiveScreen.tsx` usa `Image source={{ uri: row.imageUrl }}` sem cabeçalhos. Para URLs relativas protegidas, o app nativo deverá anexar Firebase Bearer e `X-Coala-App-Attestation`, como já ocorre na contagem.

### Escala

- Consulta mensal por ano/mês.
- Semana/dia atual e tabela para telas com largura de tablet.
- Navegação de mês, inclusive carregamento ao cruzar meses.
- Seletor de unidade e filtro “somente eu”.
- Avatar somente quando a URL for HTTPS.
- Usuário vê suas unidades; permissões adicionais liberam todas as unidades acessíveis.

### Metas

- Lista de unidades.
- Seleção de unidade/loja e carregamento sob demanda.
- Período ativo, resumo, dias, equipe e prêmio.
- Regras de dias trabalhados derivadas da escala.

### Signage

- Lista de unidades e telas conectadas.
- Inclusão de tela por unidade, orientação e opção de substituir tela existente.
- Instruções para abrir o instalador/link.
- Leitura de QR/código `COALA-SIGNAGE:CODE` pela câmera.
- Pareamento da tela por código de oito caracteres.
- O aplicativo não gerencia mídia; essa responsabilidade permanece no fluxo web/Tizen.

### Atualização do aplicativo

- Consulta pública de versão antes do login.
- Banner para atualização disponível e bloqueio para atualização obrigatória.
- Download do APK em blocos HTTP Range de até 8 MB.
- Armazenamento temporário e abertura do instalador do Android.
- `REQUEST_INSTALL_PACKAGES` permanece necessário.
- Atualização por cima exige o mesmo `applicationId` e a mesma chave de assinatura.

## Contratos da API

Todos os endpoints autenticados usam token Firebase no cabeçalho `Authorization: Bearer ...`. Quando a atestação está ativa, também usam `X-Coala-App-Attestation`. As permissões abaixo são as exigidas pelo servidor; o app deve tratar `401`, `403`, `409`, `422`, `429`, `5xx` e ausência de rede como categorias distintas.

| Método e rota | Autenticação/permissão | Corpo ou query | Resposta/uso |
|---|---|---|---|
| `GET /api/app/version` | Público | — | `versionCode`, `versionName`, `minVersionCode`, `packagePath`; decide atualização disponível/obrigatória |
| `POST /api/mobile/app-attestation` | Firebase; usuário ativo | `{integrityToken, nonce}` | `attestation` nula ou `{token, expiresAt}` |
| `GET /api/mobile/profile` | Firebase + atestação | — | Perfil e `modules` por permissão |
| `POST /api/mobile/profile/photo` | Firebase + atestação | Multipart `photo`, JPG/PNG/WEBP, até 5 MB | `{avatarUrl}`; somente a foto do usuário autenticado |
| `GET /api/purchasing/local-purchases/withdrawals` | Firebase + atestação; `app.localPurchase.register` | — | Sangrias abertas, compras aguardando, janela e `partial` |
| `GET /api/purchasing/local-purchases/context` | Firebase + atestação; `app.localPurchase.register` | — | Unidades, contas, centros e produtos quando houver `app.localPurchase.stockEntry` ou admin |
| `POST /api/financial/inbox/mobile-upload` | Firebase + atestação; `app.localPurchase.register` | Multipart `submissionId`, `capturedAt`, `note`, `fundingSource`, `receipt`, `paymentProof` | `{submission:{id, duplicate, status, analysis?}}`; replay protegido |
| `POST /api/purchasing/local-purchases/confirm` | Firebase + atestação; `app.localPurchase.register` | Compra, itens, origem, pagamento, centro e possível `withdrawal` | `{purchase:{id,status,duplicate,stockEntry,stockItemCount?}}` |
| `POST /api/purchasing/local-purchases/link-withdrawal` | Firebase + atestação; `app.localPurchase.register` | `{purchaseId, withdrawal:{sourceId,date}}` | Compra e `changeCents` |
| `GET /api/stock/mobile-count` | Firebase + atestação; `app.stockCount.perform` | — | Unidades, sessões abertas e motivos de saída |
| `POST /api/stock/mobile-count/start` | Firebase + atestação; `app.stockCount.perform` | `{kioskId}` | Sessão completa e `resumed` |
| `POST /api/stock/mobile-count/save` | Firebase + atestação; `app.stockCount.perform` | `{sessionId, entries, complete}` | `status`, `alreadyCompleted`, `adjustedLots` |
| `POST /api/stock/mobile-count/cancel` | Firebase + atestação; `app.stockCount.perform` | `{sessionId}` | `cancelled`, `alreadyCancelled`; só sessão própria aberta |
| `GET /api/stock/mobile-count/photo?productId=...` | Firebase + atestação; `app.stockCount.perform` | `productId` sem `/` | Bytes da foto embutida; rota privada, cache privado |
| `GET /api/stock/mobile-reposition` | Firebase + atestação; `app.reposition.receive` | — | Atividades aguardando recebimento, lotes e `imageUrl` |
| `POST /api/stock/mobile-reposition/receive` | Firebase + atestação; `app.reposition.receive` | `{activityId, rows}` | `status`, `hasDivergence`, `alreadyReceived`; linhas exatas |
| `GET /api/dp/mobile-schedule?year=&month=` | Firebase + atestação; `app.schedule.view` | Ano/mês válidos | Escala publicada, unidades, pessoas e turnos |
| `GET /api/goals/mobile` | Firebase + atestação; `app.goals.view` | Opcional `kioskId` ou `scope=all` | Unidades, metas ativas da unidade ou resumo de todas as unidades |
| `GET /api/signage/mobile` | Firebase + atestação; `app.signage.manage` | — | Unidades, telas, orientação e conexão |
| `POST /api/signage/mobile/screens` | Firebase + atestação; `app.signage.manage` | `{kioskId, screenId?, orientation, code}` | Tela criada/substituída; máximo de 12 telas |
| `POST /api/auth/forgot-password` | Público | `{email}` | Solicita reset sem revelar existência da conta |

Regras críticas de payload:

- `submissionId` é UUID e garante idempotência nos envios de nota.
- `fundingSource=cash_withdrawal` não aceita pagamento empresarial; `company_payment` exige método.
- A soma dos itens da compra deve ser igual ao total.
- Upload exige nota e valida tipo, tamanho, quantidade e hash dos arquivos.
- Contagem envia somente lotes alterados; `Outros` exige observação.
- Recebimento exige exatamente os lotes despachados; divergência exige observação.
- O servidor continua responsável por escopo de unidade, catálogo, permissão, finalização de estoque e idempotência.

## Regras e componentes específicos do aplicativo

### Fila offline

O legado mantém metadados no SecureStore (`coala-notas:offline-queue:v2`), arquivos no diretório privado `coala-notas-pending/` e uma chave AES-256-GCM no SecureStore com uso `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. A fila é vinculada ao UID, agrupa nota/comprovante por `submissionId`, limita-se a 20 itens, remove o arquivo original após cifrar, usa arquivo temporário apenas durante o envio e só remove o item após confirmação HTTP bem-sucedida. Falhas preservam o item e atualizam retry/erro.

Há itens legados pré-cifra que permanecem sem cifrar até sincronização. A versão Android deverá usar Room + Android Keystore, sem backup Android, mas não se deve presumir que Room consiga ler a fila do Expo. Antes da instalação, a operação deve sincronizar a fila antiga; se houver pendências, manter o app antigo instalado e criar uma ponte/importador explicitamente testado. Instalar por cima sem plano pode perder o acesso aos metadados/arquivos da fila.

### Atestação

O legado usa Play Integrity via módulo Expo, calcula nonce com hash do UID/nonce, troca o token no endpoint de atestação, armazena resultado por cerca de uma hora e limita novas tentativas. Ausência do módulo ou Expo Go retorna cabeçalho vazio. O Android deverá usar SDK nativo, conservar o mesmo contrato e tratar modo desligado, monitoramento e enforcement do servidor.

### Biometria

Preferência no armazenamento seguro, vinculada ao UID e timestamp; válida por sete dias; biometria forte sem PIN. O novo fluxo deve usar `BiometricPrompt` e invalidar a preferência em troca de usuário, expiração ou falha de autenticação.

### Atualização

O arquivo é baixado em blocos, validado pelo instalador do Android e aberto com `REQUEST_INSTALL_PACKAGES`. O nome da marca pode mudar, mas package, versionCode e certificado devem permanecer compatíveis. A mesma chave de `~/.coala-one` deve ser reutilizada pelo processo existente, sem leitura ou cópia pela automação.

### Simulação

Contextos determinísticos de compra, contagem e recebimento bypassam Firebase, API e armazenamento. Deve existir apenas para desenvolvimento/testes e ser removida ou protegida em release.

### Fotos autenticadas

Fotos públicas usam URI direta. Fotos relativas entregues pelo backend exigem URL base da API e os cabeçalhos de login/atestação. A contagem já possui `photoSource`/`loadPhotoHeaders`; o recebimento não possui essa integração e é um defeito funcional a corrigir na etapa correspondente do Android.

### Permissões

- Câmera: perfil, captura de documentos, QR do Signage e futuras fotos de insumo.
- `REQUEST_INSTALL_PACKAGES`: atualização do APK.
- Sem microfone: `microphonePermission=false` e `recordAudioAndroid=false`.
- Backup Android desativado por causa da fila e dados sensíveis.
- Notificações/serviços adicionais só devem ser adicionados se uma etapa posterior demonstrar necessidade.

## Testes e evidências levantados

Foram lidos os testes unitários relacionados:

- `tests/unit/schedule-mobile.test.ts`: escopo da escala, ausência de IDs internos, avatares HTTPS, mês/ano, permissões e foto de perfil.
- `tests/unit/stock-mobile-count.test.ts`: schema, lotes, precisão, rascunho, merge, fotos, cancelamento, permissão e finalizador compartilhado.
- `tests/unit/reposition-mobile-receipt.test.ts`: linhas exatas, divergência, schema, escopo e ausência de movimento de estoque.
- `tests/unit/signage-tizen-app.test.ts`: pareamento, QR, telas, limites, rotas autenticadas, mídia, heartbeat e CORS.

Esses testes servem como fonte de contrato, mas não substituem a futura matriz tela × contrato × teste do Android. Não foram executados nesta etapa de levantamento.

Uma tentativa de `npm run typecheck` no app legado não chegou ao typecheck efetivo porque o ambiente do app não possui as dependências/`expo/tsconfig.base` disponíveis; os erros são de resolução de módulos e configuração ausente, não uma conclusão sobre o código do app.

## Ordem de migração proposta

1. **Esqueleto:** criar `apps/coala-one-android`, Gradle/Kotlin/Compose, tema equivalente a `theme.ts`/`ui.tsx`, navegação, Firebase Auth e telas de login/bloqueio. Validar branding Coala Go com `Brush` sem clipping.
2. **Dados:** Retrofit/OkHttp, kotlinx.serialization, token Firebase, atestação como interceptor/provider e classificação de erros. Não alterar os contratos.
3. **Home/perfil:** perfil, módulos por permissão, avatar e saída.
4. **Contagem:** sessões, rascunho/merge, cancelamento e fotos autenticadas.
5. **Recebimento:** atividades, validação de lotes/divergência e fotos com autenticação — corrigindo o defeito observado no legado sem mudar a API.
6. **Compra local:** captura, revisão, upload, confirmação, estoque e conciliação.
7. **Fila offline:** Room, cifra no Keystore, UID, WorkManager, sem backup, confirmação antes de apagar e plano de migração da fila antiga.
8. **Escala, Metas e Signage.**
9. **Atestação, biometria e atualização.**
10. **Distribuição:** release assinado pelo processo existente, somente depois de testes instrumentados, matriz de paridade e validação de atualização por cima.

Cada etapa deve terminar com testes unitários de regras/ViewModels, instrumentação proporcional e matriz atualizada. O app legado só poderá ser removido depois de confirmar paridade funcional e uma janela segura para a fila offline.

## Riscos

- **Perda de notas pendentes:** a fila Expo não é automaticamente compatível com Room. Risco alto; sincronizar antes da instalação ou implementar importação testada.
- **Atualização por cima:** qualquer mudança de package ou certificado impede atualização do APK existente.
- **Branding x compatibilidade:** renomear textos não pode alterar identifiers técnicos, permissões ou rotas.
- **Atestação:** Play Integrity, nonce, cache e modo do servidor precisam reproduzir o contrato existente.
- **Fotos privadas:** Coil/Compose deve enviar cabeçalhos por requisição; não basta fornecer uma URI relativa ao componente.
- **Idempotência:** WorkManager pode repetir; `submissionId` e tratamento de resposta duplicada são obrigatórios.
- **Escopo de acesso:** o servidor é autoridade para unidade/permissão; o cliente não deve ampliar listas ou inferir permissões.
- **Assinatura e instalador:** atualização manual exige configuração do Android e mesma chave; não testar usando uma chave temporária para o fluxo final.
- **Simulação em produção:** caminho de desenvolvimento não pode vazar para release.
- **MinSdk desconhecido:** a decisão depende da base de aparelhos atual e ainda está aberta.

## Perguntas em aberto para a revisão

1. Qual é o `minSdk` necessário para os aparelhos atualmente em uso?
2. Confirmamos que todos os textos visíveis passam de `Coala One` para `Coala Go`, mantendo os identifiers técnicos?
3. Antes de instalar o Android novo, a operação poderá exigir que o app antigo sincronize todas as notas pendentes?
4. Se um aparelho estiver offline com pendências, devemos bloquear a atualização ou oferecer um importador de fila legado?
5. A atestação deverá começar em modo monitoramento no Android ou já em enforcement?
6. Qual conjunto de aparelhos/emuladores será usado nos testes instrumentados de câmera, biometria, instalador e offline?

## Atualização após autorização de implementação (2026-10-11)

O inventário abaixo e as perguntas acima retratam o levantamento inicial. Decisões posteriores: Android 8/API 26 confirmado; nome novo Coala Go; usuário autorizou prosseguir até o fim sem pausas por etapa. Mantidos os limites de não publicar, não usar navegador e não acessar produção. A investigação adicional comprovou que cabeçalhos no cliente não bastam para fotos embutidas do recebimento: o backend as omitia e a rota de contagem tem outra permissão. O usuário autorizou exclusivamente a nova rota privada de fotos com `app.reposition.receive`; lista/recebimento mantêm seus demais contratos. Ver [matriz de paridade](coala-go-parity.md) e [plano dos aparelhos](coala-go-device-migration.md) para decisões e lacunas atuais. App Expo e alteração local de `ui.tsx` permanecem intactos; o workaround SVG não foi portado.

## Resultado da Etapa 0 (histórico)

Decisão final posterior: usuário autorizou retirar Expo/APK antigo e atualizar download. Coala Go é o único mobile, preparado em `public/app/CoalaGo.apk` com mesma assinatura pública, versão0.2.0/code4. `/api/app/version` seleciona Go por padrão; query do antigo não oferece instalador. Nenhuma publicação executada. Não há filas de usuários a migrar, conforme responsável.

Decisão posterior (2026-10-11): package novo `coalaone.go`, com instalação lado a lado. Cadastro Firebase Android autorizado e concluído; configuração pública obtida sem dados de negócio. Também autorizado ajuste delimitado de atestação (`packageName` opcional allowlisted, padrão legado) e versão (`packageName` opcional na query, resposta antiga preservada). Não há importação de filas Expo. O resultado abaixo é histórico e não descreve o estado final; consultar a matriz.

- Inventário do app, telas, contratos, regras e componentes específicos registrado.
- Defeito de autenticação da foto no recebimento identificado no cliente legado.
- Nenhuma alteração de backend proposta ou executada.
- Alteração local de `apps/coala-notas/src/ui.tsx` preservada no checkout original e descartada da linha de migração.
- Próximo passo depende da revisão deste documento e das respostas sobre `minSdk`, branding e fila pendente.
