# Coala Go — matriz de paridade e homologação

Migração original integrada em `main` pelo PR #395 e publicada como 0.2.0. O [inventário](coala-go-mobile-migration-inventory.md) registra o levantamento histórico. O [projeto Kotlin](../../apps/coala-one-android/README.md) usa `coalaone.go`, API26, nome Coala Go, único app mobile após retirada expressamente autorizada do Expo e APK antigo. Não havia usuários. Extensões autorizadas: foto privada do recebimento, allowlist de package na atestação e atualização de versão/instalador para Go. APIs de negócio restantes não mudam. O handoff visual 0.3.0 mantém esses contratos; publicação autorizada, sem substituir o aceite físico/integrado pendente.

## Tela × contrato × teste

| Tela/fluxo | Contrato/persistência | Evidência automatizada | Homologação restante |
|---|---|---|---|
| Login, bloqueio, sair, recuperação | Firebase Auth nativo; `/api/auth/forgot-password`; UID e bloqueio por inatividade | `ViewModelsTest`: login/bloqueio/reauth/reset; `FirebaseAuthInstrumentedTest`: SDK com Auth Emulator | Conta de homologação autorizada |
| Marca e slogan | Tokens do handoff; Inter Tight embarcada; Brush animado em texto Compose | `ComposeFlowsTest.brandingAndSloganUseRealTextWithoutClipping`; `DesignMotionTest`: animação/redução/fonte 160% | Aparelhos do parque e leitor de tela |
| Home/perfil/avatar | `/api/mobile/profile` (inclui módulos), `/api/mobile/profile/photo` | `ViewModelsTest`: módulos, avatar, saída; `ApiContractTest`: autenticação | Foto/câmera física e permissões reais |
| Contagem | `/api/stock/mobile-count`, `/start`, `/save` (parcial ou completo), `/cancel`, `/photo`; rascunho cifrado/merge | `RulesTest`, `ViewModelsTest`, `ComposeFlowsTest`: concluir/cancelar; `stock-mobile-count.test.ts`; payloads Kotlin validados em Zod | Concorrência com web e conectividade real |
| Recebimento | `/api/stock/mobile-reposition`, `/receive`, `/photo`; divergência por lote | `ViewModelsTest`, `ComposeFlowsTest`: bloquear divergência sem nota; `reposition-mobile-receipt.test.ts`, `reposition-mobile-photo.test.ts`; headers e escopo | Imagens reais e transação completa em homologação |
| Compra/captura/revisão | `/api/purchasing/local-purchases/context`, `/withdrawals`, `/link-withdrawal`; `/api/financial/inbox/mobile-upload`; `/api/purchasing/local-purchases/confirm` | `ViewModelsTest`: UUID estável, upload offline, retry de estoque; `ComposeFlowsTest`: seletor/revisão/confirmação; `ApiContractTest`: multipart; schemas Zod | OCR real, câmera e conciliação financeira integrada |
| Pendências offline | Room + arquivos AES-GCM/Keystore por UID + WorkManager | `OfflineQueueInstrumentedTest`: persistência, cifra, tamper, conta errada, WorkManager, recuperação atômica, tombstone; `ViewModelsTest`: falha mantém fila | Reinício forçado/bateria/rede em aparelhos reais |
| Escala | `/api/dp/mobile-schedule`; semanas/meses sob demanda; seleção diária e Equipe/Só minha | `ViewModelsTest`, `schedule-mobile.test.ts`, `DesignScreensTest` | Usabilidade diária com dados reais |
| Metas | `/api/goals/mobile`, filtro `kioskId`; abas Dias/Equipe/Prêmio com progresso animado | `ViewModelsTest`: unidade, metas, equipe e prêmio; `DesignScreensTest`: abas | Conferência de todos os indicadores com backend de homologação |
| Signage | `/api/signage/mobile`, `/api/signage/mobile/screens`; CameraX/QR `COALA-SIGNAGE` | `RulesTest`, `ViewModelsTest`, `signage-tizen-app.test.ts`; payload Zod | Scanner físico e TV Tizen ponta a ponta |
| Biometria | BiometricPrompt forte; opt-in por UID e validade de sete dias cifrada | `ViewModelsTest`: opt-in vinculado ao UID e bloqueio/reauth; Keystore da fila na instrumentação | Validade do registro biométrico, sensor físico, cancelamento e indisponibilidade |
| Atestação | `/api/mobile/app-attestation`; package opcional, nonce local e Play Integrity nativo | `mobile-app-attestation.test.ts`: Go/legado/cross-package; `ApiContractTest`: DTO/transporte | Play Integrity com certificado de release e políticas do servidor |
| Atualização | `/api/app/version?packageName=coalaone.go`; download Range; pacote/versão/certificado; instalador Android | `mobile-app-release.test.ts`, `ApiContractTest`, `RulesTest`, `ViewModelsTest`: versão/progresso/não publicado | Atualização futura Go sobre Go e fontes desconhecidas |

As suítes JVM ficam em `apps/coala-one-android/app/src/test`; instrumentação em `app/src/androidTest`. Fotos privadas usam o mesmo interceptor autenticado. Header interno de UID esperado é removido antes da rede; teste impede envio de outro usuário e vazamento de token a origem externa. Documentos não passam por backup Android; não há permissão de microfone.

## Evidências e limites da migração original (histórico)

- Backend dirigido final: **55 testes aprovados**, incluindo versão/release/rótulos/hash e ausência do Expo/APK antigo, com contagem adaptada ao Kotlin.
- Após mudança para `coalaone.go`: **31 testes JVM, 14 instrumentados no Android 15/API 35 e lint aprovados**. Teste novo comprova sandbox próprio, backup desativado e ausência de microfone. Não há teste físico em Android 8/API 26 ainda.
- Sete payloads reais produzidos pelo serializador Kotlin validados contra schemas Zod via `scripts/verify-android-contracts.mts`.
- Testes Compose de negócio usam simulação determinística. O teste Firebase usa exclusivamente projeto `demo-coala-go` e Auth Emulator local. Isso não comprova uma jornada com OCR, Firestore e permissões reais em conjunto.
- A composição visual nativa não é cópia pixel a pixel: escala é lista semanal, captura usa seletor/câmera do sistema e revisão usa seções expansíveis. Preservar tarefa/contrato não substitui aceite de usabilidade.
- Após busca local sem configuração Android e consulta de duplicidade, usuário autorizou cadastro Firebase `coalaone.go`, concluído: appId `1:787876557774:android:6cdbb4212220142e3a319f`. SDK config público obtido via CLI em arquivo ignorado pelo Git. Nenhum dado de negócio foi consultado. Debug não carrega essa configuração real.
- Release local assinado gerado: versão0.2.0/code4, minSdk26, package `coalaone.go`, mesmo certificado público do APK anterior. `public/app/CoalaGo.apk`, SHA256 `2b3e5bec7861ffad22eab3b484be843c54588d71c9f13e4c8ea26b9a892c969a`. Código/instalador antigos retirados nesta branch; download atualizado localmente, sem deploy.
- Gate geral final `npm run verify`: typecheck/lint aprovados; **2.228/2.229 testes aprovados**, com única falha de minimatch instalado10.2.4 vs esperado3.1.5 no Firebase CLI, também reproduzida anteriormente no checkout original. Não é gate verde; build Next do gate não executou. Build Next separado anterior compilou/validou tipos, mas abortou na coleta pela proteção contra Auth Emulator em `production`; proteção preservada.
- Download real no Next local (demo, sem navegador): `/app/CoalaGo.apk` devolveu200, MIME APK, 3.793.541 bytes e SHA256 correto; `Range: bytes=0-1023` devolveu206/Content-Range correto e1024 bytes. Servidor local encerrado após conferência. Não é teste do site publicado.

### Verificação do handoff 0.3.0

33 testes JVM e oito instrumentados aprovados no Android 15/API 35;
build debug/AndroidTest e lint Android aprovados. Os testes cobrem texto a 160%,
movimento normal/reduzido, contraste do CTA desabilitado, capturas de sete telas,
abas de metas e fluxos de compra/contagem/recebimento. Sete payloads Kotlin
continuam aceitos pelos schemas Zod. 2.229 testes TS, typecheck/lint web e
contratos de segurança/erro aprovados nesta rodada. Sensores físicos e piloto
integrado não foram executados; não há mudança nos contratos de negócio.

### Verificação da revisão de navegação e usabilidade 0.3.1

Barra superior única (voltar à esquerda, atualizar à direita, fundo escuro sob a
barra de status), listas de unidade em linhas clicáveis na contagem e no
recebimento, seletor com busca para listas longas, calendário para datas,
quantidade com − e +, mensagens junto ao rodapé, tela de Perfil e semana da
escala inteira na largura. Sem alteração de ViewModels, contratos ou permissões.
33 testes JVM e oito instrumentados aprovados no Android 15/API 35 (AVD
exclusivo), lint Android sem erros e dez capturas conferidas. Não exercitados em
execução: tela de bloqueio, seletor com busca, calendário e leitor de QR em tela
cheia; testes de Firebase e fila offline não foram repetidos nesta rodada.

## Entrega por etapa

| Etapa | Feito | Verificação local | Pendente |
|---|---|---|---|
| 0 | Inventário de telas, regras, API e riscos | Leitura do legado e testes relacionados | Perguntas operacionais registradas |
| 1 | Projeto API 26, tema, Brush, navegação e Auth SDK; cadastro/configuração Android | Build debug, Compose, Auth Emulator | Login real em homologação |
| 2 | DTOs, cliente, token/atestação e erros | JVM HTTP/multipart e sete payloads Zod | Backend integrado de homologação |
| 3 | Home/perfil/foto/sair | ViewModel; captura compartilhada | Perfil e foto reais |
| 4 | Contagem, merge, rascunho, cancelar e fotos | Regras/ViewModel/Compose e contratos legados | Concorrência/contagens reais |
| 5 | Recebimento, divergência e foto autenticada | ViewModel/Compose e backend unitário | Publicação separada da extensão autorizada |
| 6 | Compra, nota/comprovante e revisão | ViewModel, multipart, seletor Compose, digitação decimal | OCR/financeiro/estoque ponta a ponta |
| 7 | Room/Keystore/WorkManager e recuperação | Instrumentação de cifra/UID/tamper/worker e falhas | Piloto com bateria/rede/reinício real |
| 8 | Escala, Metas e Signage | ViewModels/regras e testes legados | TV e scanner físicos |
| 9 | Atestação, biometria e atualização | Build/lint; regras e ViewModels | Play Integrity, sensor e instalador reais |
| 10 | APK release assinado com processo existente, certificado comprovado, metadados/hash/link preparados e Expo retirado por autorização | Build release, apksigner/aapt, testes de sincronismo/hash/ausência do legado | Publicação autorizada e piloto físico; atualização futura Go sobre Go |

## Gate operacional

O usuário confirmou que não há usuários e posteriormente autorizou remover o antigo e trabalhar somente com Go. Expo/instalador antigo foram retirados nesta branch, preservando histórico/checkout original. Não há migração operacional de filas. Essa autorização substitui a preservação inicial até paridade; não equivale a homologação física/integrada nem autorização de publicação.

### Decisão de instalação separada

O usuário confirmou `coalaone.go` como identificador novo, lado a lado e sem atualização por cima de `com.coalaone.notas`. Essa decisão substitui o requisito inicial de package igual.

Após autorização para retirar o antigo e atualizar download, versão sem parâmetro seleciona Go; query explícita antiga tem instalador nulo. Atestação mantém compatibilidade de formato/allowlist, exigindo reconhecimento Play e integridade. APK/metadados/link preparados localmente não atualizam produção sem deploy autorizado.

Cumprir o [roteiro de primeira instalação](coala-go-device-migration.md) e executar piloto físico/integrado Go. Registrar aceite das lacunas acima. A publicação para teste foi posteriormente autorizada e realizada; não equivale a paridade final comprovada.
