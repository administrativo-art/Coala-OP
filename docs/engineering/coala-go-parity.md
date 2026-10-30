# Coala Go — matriz de paridade e homologação

Migração original integrada em `main` pelo PR #395 e publicada como 0.2.0. O [inventário](coala-go-mobile-migration-inventory.md) registra o levantamento histórico. O [projeto Kotlin](../../apps/coala-one-android/README.md) usa `coalaone.go`, API26, nome Coala Go, único app mobile após retirada expressamente autorizada do Expo e APK antigo. Não havia usuários. Extensões autorizadas: foto privada do recebimento, allowlist de package na atestação e atualização de versão/instalador para Go. APIs de negócio restantes não mudam. A candidata 0.3.21/code26 mantém a visualização assistida exclusiva do desenvolvimento, com ator real preservado e modo somente leitura, reorganiza Jornada, Registro de ponto, ajustes, detalhe diário, espelhos e solicitações, identifica de forma explícita o ensaio nominal pré-homologação e isola perfil, escala e resumo diário ao alternar a identidade visualizada; o acompanhamento periódico Entre unidades permanece desligado por gate jurídico. APK assinado e testes JVM não substituem o aceite em aparelho físico pendente.

## Push — incremento local de 15/10/2026

O perfil do Android permite opt-in por conta e aparelho, autorização do sistema e desativação. `POST/DELETE /api/mobile/push/devices` exigem usuário ativo e atestação mobile; proprietário/workspace vêm da sessão, não do corpo. `mobilePushTokens` e `mobilePushInstallations` ficam em `coala`, sem acesso direto pelo cliente. Rotação, troca de conta, limite de dez dispositivos e revogação são transacionais; token não aparece em resposta ou auditoria. Registro repetido em menos de 24h evita novas escritas quando não houve mudança.

O envio é uma função interna, sem endpoint público: mensagem data-only genérica, destinatário vinculado à conta e caminho HTTPS permitido. O app revalida consentimento, conta, permissão, evento e destino, e deduplica os últimos 50 eventos. Logout desativa localmente antes de tentar revogação remota. Aceitação pelo FCM não significa entrega no aparelho. Até existir operação nativa de solicitações, o aviso abre a central web autenticada.

Testes JVM (46), lint e integração geral com provedor falso passaram. A infraestrutura de push permanece disponível para outros fluxos, porém, por decisão de produto, o outbox RH de ausências projeta somente o aviso no sino interno e não chama FCM nem e-mail. A reconciliação do aviso revalida o destinatário e mantém IDs estáveis. Não houve envio real, homologação em aparelho, publicação de API nem release Android nesta tarefa.

Preflight de custo da infraestrutura geral de push: cada registro de dispositivo lê dois documentos e consulta até 11 tokens ativos, além de usuário/perfil da autenticação. Com 100 pessoas, 10 retomadas/dia e 22 dias, teto conservador de 15 leituras por tentativa = 330.000 leituras/mês (com um aparelho ativo, aproximadamente 110.000); sem polling. Atualização igual em menos de 24h não escreve; rotação escreve até dois registros anteriores, dois atuais e auditoria. Um envio de outro fluxo lê uma pessoa e até 11 tokens; nenhuma coleção é carregada integralmente. Esses custos de dispositivo não são acionados pelos avisos de ausência. São cenários, não medição de produção nem garantia de cobrança.

## Tela × contrato × teste

| Tela/fluxo | Contrato/persistência | Evidência automatizada | Homologação restante |
|---|---|---|---|
| Login, bloqueio, sair, recuperação | Firebase Auth nativo; `/api/auth/forgot-password`; UID e bloqueio por inatividade | `ViewModelsTest`: login/bloqueio/reauth/reset; `FirebaseAuthInstrumentedTest`: SDK com Auth Emulator | Conta de homologação autorizada |
| Marca e slogan | Tokens do handoff; Inter Tight embarcada; Brush animado em texto Compose | `ComposeFlowsTest.brandingAndSloganUseRealTextWithoutClipping`; `DesignMotionTest`: animação/redução/fonte 160% | Aparelhos do parque e leitor de tela |
| Home/perfil/avatar | `/api/mobile/profile` (inclui módulos), `/api/mobile/profile/photo` (a foto escolhida é enquadrada no aparelho — arrastar e aproximar no círculo — e só o quadrado de até 720 px é enviado); resumo abre/fecha por arrasto vertical da alça. Para `administrativo@coalashakes.com`, `/api/auth/view-as` permite escolher um usuário ativo em modo somente leitura, preservando o ator real na autenticação/atestação e exibindo aviso persistente. | `ViewModelsTest`: módulos, avatar, saída; `RulesTest`: limites do enquadramento; `ApiContractTest`: autenticação, cabeçalho restrito à origem da API e DTO do modo assistido; `DesignMotionTest`: toque inerte e arrasto para abrir/fechar; `developer-view-as.test.ts`: exclusividade e leitura | Foto/câmera física, permissões reais e gesto em aparelho físico; jornada de visualização em aparelho e conta real |
| Login Google | `/api/mobile/auth/google-migration` vincula Google ao mesmo UID; Workspace pode ser nominal e obrigatório, enquanto Google pessoal exige login de senha recente. A entrada comum recusa usuário novo e nunca mescla cadastros. A tela obrigatória mostra etapas e progresso determinado. | `google-workspace-migration-contract.test.ts`; `ViewModelsTest`; testes JVM | Credential Manager e troca de sessão em aparelho real com a conta Workspace autorizada |
| Aparelho empresarial | `/api/mobile/corporate-device` cria/consulta a solicitação da instalação autenticada; a gestão fica no cadastro do colaborador por `/api/users/[userId]/corporate-devices`. A chave apenas classifica a instalação como empresarial. O rastreio segue o usuário autenticado e a política da jornada, inclusive em aparelho pessoal. | `corporate-device-link-contract.test.ts`; compilação e testes JVM | Android Keystore, reinstalação, troca de usuário e aprovação em aparelho real |
| Contagem | `/api/stock/mobile-count`, `/start`, `/save` (parcial ou completo), `/cancel`, `/photo`; rascunho cifrado/merge | `RulesTest`, `ViewModelsTest`, `ComposeFlowsTest`: concluir/cancelar; `stock-mobile-count.test.ts`; payloads Kotlin validados em Zod | Concorrência com web e conectividade real |
| Recebimento | `/api/stock/mobile-reposition`, `/receive`, `/photo`; divergência por lote | `ViewModelsTest`, `ComposeFlowsTest`: bloquear divergência sem nota; `reposition-mobile-receipt.test.ts`, `reposition-mobile-photo.test.ts`; headers e escopo | Imagens reais e transação completa em homologação |
| Compra/captura/revisão | `/api/purchasing/local-purchases/context`, `/withdrawals`, `/link-withdrawal`; `/api/financial/inbox/mobile-upload`; `/api/purchasing/local-purchases/confirm`; NF-e/DANFE e NFC-e autorizada com classificação alta dispensam comprovante na compra normal; contingência pendente não dispensa; sangria não aceita comprovante; a IA sugere por item vínculo existente, cadastro pendente, possível patrimônio, uso imediato ou revisão; sangrias são agrupadas por unidade e filtradas por organização/grupo e vínculo posterior é retomado no próprio cartão | `ViewModelsTest`: UUID estável, upload offline, preservação da classificação dos itens, retry de estoque, sessão única/retomada e cancelamento da escolha de sangria; `RulesTest`: filtros organização/grupo com contagem e restauração; `local-purchase-units.test.ts`: hierarquia determinística; contrato visual: confirmação dentro da sangria; `ComposeFlowsTest`: seletor/revisão/confirmação; `ApiContractTest`: multipart; schemas Zod e política de classificação | OCR real, câmera e conciliação financeira integrada |
| Pendências offline | Room + arquivos AES-GCM/Keystore por UID + WorkManager | `OfflineQueueInstrumentedTest`: persistência, cifra, tamper, conta errada, WorkManager, recuperação atômica, tombstone; `ViewModelsTest`: falha mantém fila | Reinício forçado/bateria/rede em aparelhos reais |
| Escala | `/api/dp/mobile-schedule`; semanas/meses sob demanda; seleção diária, Equipe/Só minha e Todas as unidades | `ViewModelsTest`, `schedule-mobile.test.ts`, `DesignScreensTest` | Usabilidade diária com dados reais |
| Metas | `/api/goals/mobile`, filtro `kioskId` ou `scope=all` (Todas as unidades); abas Dias/Equipe/Prêmio com progresso animado | `ViewModelsTest`: unidade, metas, equipe e prêmio; `DesignScreensTest`: abas | Conferência de todos os indicadores com backend de homologação |
| Signage | `/api/signage/mobile`, `/api/signage/mobile/screens`; CameraX/QR `COALA-SIGNAGE` | `RulesTest`, `ViewModelsTest`, `signage-tizen-app.test.ts`; payload Zod | Scanner físico e TV Tizen ponta a ponta |
| Ponto (Etapa 7) | `/api/dp/time-recording/options`, `/offline-permits`, `/markings` (canal `mobile`, coletor 01; modo 1 após sincronização), `/month`, `/journey-location`, `/receipts/{id}`, `/receipts/export`, `/adjustments`, `/time-bank`, `/mirrors` e `/mirrors/pdf`; offline em Room cifrado, chave P-256 TEE/StrongBox e WorkManager; comprovantes, ZIP e espelho no cache privado; visível com `app.timeRecording.mark` + colaborador. Localização pontual permanece acessória. Turno **Entre unidades** prepara acompanhamento durante a jornada: buffer cifrado, serviço Android em primeiro plano, pausa no intervalo, encerramento manual, ao fim ou por limite de segurança e trilha separada sem efeito fiscal/financeiro. O servidor impõe estado e janela da escala. A funcionalidade contínua permanece desligada por `DP_JOURNEY_LOCATION_ENABLED` até a decisão formal de privacidade. Notificações gerais continuam opt-in no Perfil. O ZIP limitado do mês selecionado preserva somente os PDFs oficiais e calcula o índice de completude sobre eles; comprovantes de ensaio são individuais e explicitamente ficam fora do pacote oficial. A pasta de documentos permanece somente no Coala One. | `TimeRulesTest`: fuso/data, totais do detalhe, turno noturno e canônico offline; `ViewModelsTest`: queda de rede preserva sem fingir NSR e tentativa de localização acompanha o retry; `ApiContractTest`: rotas e payload; `dp-rep-p-journey-location`: estado, replay, janela e revogação; `dp-rep-p-receipt-archive`: ZIP, bytes e incompletude; `verify-android-contracts.mts`; `dp-rep-p-offline` no servidor; `coala-go-ui-contract.test.ts`; testes JVM e E2E web de separação titular/DP | Batida, acompanhamento entre unidades, sincronização e exportação/compartilhamento em aparelho físico, permissões precisa/aproximada/negada, reinício/bateria/rede real e atestação do APK direto `enforce` |
| Solicitações (Etapa 7) | `/api/collaborator/absence-requests/options`, `/preview`, `/preparations` (anexos), `POST` rascunho + `PATCH` envio; `/api/collaborator/requests` (vale-transporte); `/api/collaborator/requests/shift-swaps` (opções, lista, proposta e decisão), pelo mesmo contrato central da web; visível com `app.requests.create` + colaborador | `TimeRulesTest`: período, motivo, anexos, VT; `ApiContractTest` e `coala-go-ui-contract.test.ts`: troca central | Câmera/arquivo físico, envio com anexo e troca de turno entre duas contas em ambiente real |
| Biometria | BiometricPrompt forte; opt-in por UID, cifrado e sem prazo de validade (decisão do responsável em 2026-10-11); pedido automaticamente ao abrir o app bloqueado | `ViewModelsTest`: opt-in vinculado ao UID e bloqueio/reauth; Keystore da fila na instrumentação | Validade do registro biométrico, sensor físico, cancelamento e indisponibilidade |
| Atestação | `/api/mobile/app-attestation`; desafio autenticado e prova Android de hardware para APK direto | `mobile-app-attestation.test.ts`: Go/legado/cross-package; `ApiContractTest`: DTO/transporte | cadeia de hardware e assinatura do APK release verificadas no servidor |
| Atualização | `/api/app/version?packageName=coalaone.go`; download Range; pacote/versão/certificado; instalador Android. A 0.3.21/code26 é a versão mínima aceita durante o piloto, para impedir que uma instalação antiga oculte recursos já liberados ou reutilize dados diários de outra identidade visualizada. | `mobile-app-release.test.ts`, `ApiContractTest`, `RulesTest`, `ViewModelsTest`: versão/progresso/não publicado | Atualização futura Go sobre Go e fontes desconhecidas |

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

### Verificação da 0.3.2 (telas no desenho do protótipo, metas e escala)

Telas de compra local, contagem, recebimento, metas, escala e início refeitas
conforme `Coala One App - Prototipo`; ícone novo; iniciais de duas letras por
unidade; cor cadastrada de cada pessoa na escala e na equipe das metas; metas
com "minha parte", ritmo do dia, selo de ritmo e gráfico por dia (valores da
unidade, não individuais). A escala passa a aparecer sem depender de trancar
(ver `flows/collaborator-schedule.md`). 35 testes JVM e lint Android aprovados;
oito instrumentados aprovados antes do último ajuste de texto da aba Dias e não
repetidos depois dele, por decisão do responsável, que conferiu as telas no
emulador. Anexos, revisão, calendário, tela de bloqueio, meta de ticket médio e
aviso de dias com escala não foram exercitados em execução.

### Verificação da 0.3.3 (início, biometria, tema escuro, mês da escala)

Início com saudação como título, perfil na foto e o resumo de hoje numa extensão
recolhível da barra; selos nos cartões. Biometria pedida ao abrir o app bloqueado
e sem prazo de validade (decisão do responsável). Unidade das metas num seletor
único com busca. Resumo antes de concluir a contagem, puxar para atualizar, faixa
de sem conexão, tema escuro seguindo o aparelho e visão do mês na escala. A
simulação de debug passou a ter oito unidades. Para o resumo de hoje, o início
faz até cinco leituras ao abrir, ao puxar para atualizar ou ao voltar depois de
dois minutos; nunca por temporizador. 35 testes JVM e lint Android aprovados;
o teste de capturas (`DesignScreensTest`) aprovado em tema escuro e, na versão
final, em tema claro, incluindo o novo passo de conexão de monitor no Signage
(o formulário abria abaixo da lista de unidades, fora da tela; agora é uma etapa
própria). O teste de fluxos alterado (compra com escolha de unidade) não foi
executado depois da alteração. Biometria, tela de
bloqueio, sem conexão e calendário do mês não foram exercitados em execução.

### Verificação da 0.3.4 (Signage em três níveis)

Signage reorganizado: lista de unidades, painel da unidade (cada tela com estado
e posição, "Trocar monitor") e passo a passo de quatro etapas para adicionar
tela ou ligar outro monitor (endereço com ilustração animada, espera da
instalação, tela nova ou substituição com a posição escolhida por desenho,
leitura do QR). Mesmas rotas e contratos (`/api/signage/mobile` e
`/api/signage/mobile/screens`). 35 testes JVM e lint Android aprovados. O teste
de capturas foi ajustado ao fluxo novo, mas não pôde ser executado: o emulador
falhou na captura de imagem (PixelCopy) antes de chegar ao Signage. O fluxo foi
conferido pelo responsável no emulador. As instruções das etapas 1 e 2 seguem o
que a página `/app` descreve para monitores profissionais e não foram
confirmadas em monitor físico.

### Verificação da 0.3.5 (escala por unidade e função na saudação)

A escala do administrador padrão preserva todas as unidades com turnos quando a
permissão `app.schedule.viewAllUnits` está ativa, inclusive sem lotação própria.
Escala e Metas compartilham o mesmo seletor de unidade pesquisável no cabeçalho.
O subtítulo da saudação usa a primeira função cadastrada e recorre ao cargo;
sem ambos, mostra "Equipe Coala", nunca o e-mail. Contratos TypeScript e testes
JVM cobrem recorte de unidades, precedência da função, filtro/cache e UI. A
build de release 0.3.5/code10 mantém o pacote `coalaone.go` e o certificado
público existente. O emulador recebeu tanto a build de debug quanto a release
assinada final, e `coalaone.go/com.coalaone.go.MainActivity` ficou em primeiro
plano; dados reais, aparelho físico e sensor biométrico permanecem fora da
homologação desta rodada.

### Verificação da 0.3.6 (identidade compacta e resumo por arrasto)

A interface preserva o nome completo recebido pela API, mas apresenta somente
primeiro e último nomes nos espaços compactos do aplicativo. Na Escala, a
identidade e o cargo ficam em uma linha cada, o horário recebe destaque e ícone,
o rótulo técnico do turno é reduzido ao contexto útil e as colunas mantêm
alinhamento e largura estáveis. Na home, toque simples na alça não alterna o
resumo: arrastar para baixo abre e arrastar para cima fecha. Testes JVM cobrem
a apresentação dos nomes e do turno; o teste Compose do gesto foi compilado.
O emulador permaneceu encerrado a pedido do responsável durante a preparação
do release 0.3.6/code11.

### Verificação da 0.3.7 (enquadramento da foto de perfil)

No Perfil, a foto fotografada ou escolhida abre "Ajuste a foto": a pessoa
arrasta e aproxima a imagem dentro do círculo e somente o quadrado enquadrado,
em JPEG de até 720 px, é enviado para `/api/mobile/profile/photo`. A rotação
registrada pela câmera é aplicada antes do recorte. Testes JVM cobrem os limites
do enquadramento (`RulesTest`); o diálogo não tem teste de tela. O emulador
permaneceu encerrado a pedido do responsável durante a preparação do release
0.3.7/code12; gesto e desenho da tela em aparelho ficam fora desta homologação.

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
| 9 | Atestação, biometria e atualização | Build/lint; regras e ViewModels | atestação de hardware, sensor e instalador reais |
| 10 | APK release assinado com processo existente, certificado comprovado, metadados/hash/link preparados e Expo retirado por autorização | Build release, apksigner/aapt, testes de sincronismo/hash/ausência do legado | Publicação autorizada e piloto físico; atualização futura Go sobre Go |

## Gate operacional

O usuário confirmou que não há usuários e posteriormente autorizou remover o antigo e trabalhar somente com Go. Expo/instalador antigo foram retirados nesta branch, preservando histórico/checkout original. Não há migração operacional de filas. Essa autorização substitui a preservação inicial até paridade; não equivale a homologação física/integrada nem autorização de publicação.

### Decisão de instalação separada

O usuário confirmou `coalaone.go` como identificador novo, lado a lado e sem atualização por cima de `com.coalaone.notas`. Essa decisão substitui o requisito inicial de package igual.

Após autorização para retirar o antigo e atualizar download, versão sem parâmetro seleciona Go; query explícita antiga tem instalador nulo. Atestação mantém compatibilidade de formato/allowlist, exigindo reconhecimento Play e integridade. APK/metadados/link preparados localmente não atualizam produção sem deploy autorizado.

Cumprir o [roteiro de primeira instalação](coala-go-device-migration.md) e executar piloto físico/integrado Go. Registrar aceite das lacunas acima. A publicação para teste foi posteriormente autorizada e realizada; não equivale a paridade final comprovada.

### Verificação da 0.3.10 (nota fiscal e tratamento dos itens)

A compra normal pode seguir sem comprovante quando duas leituras independentes
concordam que o documento é NF-e/DANFE ou NFC-e autorizada e há protocolo
literal de autorização; recibo, cupom não fiscal e contingência pendente ainda
exigem comprovante. A seleção de sangria pode ser cancelada antes do envio. A
IA sugere por linha item existente, item não encontrado, possível patrimônio,
uso imediato ou revisão, e o servidor valida a decisão antes de persistir o
estado operacional da compra. `RulesTest`, `ViewModelsTest`, os contratos
Android/TypeScript e a suíte do backend cobrem o fluxo; aparelho físico, OCR
real e validação fiscal oficial continuam fora desta homologação. O APK
0.3.10/code15 foi assinado pelo certificado público esperado e tem SHA-256
`0abc2be295bf9965a97fb2a3dbc326a91a9a7c1600969f5b24b896a885b72077`.

### Verificação da 0.3.15 (registro de ponto e solicitações)

O Coala Go passa a oferecer Ponto e Solicitações apenas quando as permissões
efetivas da pessoa liberam cada módulo. A marcação on-line reutiliza as rotas
REP-P, exibe a Hora Legal no fuso da unidade e recebe NSR e comprovante somente
do servidor. A contingência offline exige autorização recente, identidade do
aparelho e fila cifrada/assinada, sem inventar NSR ou comprovante antes da
sincronização. Ajustes ficam no detalhe do dia em Ponto; Solicitações inclui ausência, vale-transporte e troca
de turno pelo contrato central, com aceite documentado das duas pessoas. Banco
de horas e espelho são consultados sob demanda; a pasta de documentos continua
somente no Coala One. Testes JVM, contratos TypeScript e integrações em emulador
cobrem esses limites; atestação de hardware real, aparelho físico e piloto com pessoas
continuam gates separados. O APK 0.3.15/code20 foi assinado pelo certificado
público esperado e tem SHA-256
`801a41bf6e785925813480d6769d13b1c7f6329ee7a672233f4fd070f19b67eb`.

### Verificação da 0.3.18 (visualização assistida de usuário)

A conta de desenvolvimento `administrativo@coalashakes.com` pode selecionar
uma pessoa ativa no menu de perfil e consultar o Coala Go com os dados e as
permissões efetivas dela. A identidade Firebase real continua sendo usada para
autenticação, atestação e auditoria; enquanto a visualização está ativa, as
alterações pelas APIs centrais são bloqueadas e um aviso persistente permite
voltar imediatamente ao perfil real. A seleção fica somente no armazenamento
privado do aparelho, é enviada apenas à origem oficial da API e é removida no
logout ou na troca de conta. Testes JVM e contratos TypeScript cobrem a
autorização exclusiva, a restrição de origem e o modo somente leitura; Play
Integrity real, aparelho físico e homologação com conta de produção continuam
gates separados. O APK 0.3.18/code23 foi assinado pelo certificado público
esperado e tem SHA-256
`02ce7e62e569fde4dbfeaa5bf994f7a5dcb55bcd4677d19316b5b1679eb6c7e0`.

### Verificação da 0.3.21 (relógio, tema e isolamento da identidade)

O início recarrega a Hora Legal e o turno do dia ao entrar, retomar o app ou
alternar a identidade visualizada. Perfil, módulos, foto, resumo diário e
feedback da foto usam a mesma geração de contexto; respostas atrasadas são
descartadas e pendências locais do ator real não aparecem durante a
visualização assistida. A identidade persistida é restaurada antes da primeira
requisição do início. Falha de escala não é apresentada como “sem turno”. O
tema acompanha a hora local do aparelho: claro das 06:00 às 17:59 e escuro das
18:00 às 05:59. O APK 0.3.21/code26 foi assinado pelo certificado público
esperado e tem SHA-256
`6425a0d7611280892219c06b29e2c45ca201fbe3aae97352928a66719b0040f9`.
O mesmo release define `minVersionCode=26`, substituindo obrigatoriamente a
versão que ainda podia reaproveitar o resumo diário de outra identidade.

### Verificação da 0.3.20 (ensaio nominal identificado)

O aplicativo passou a consumir `mode: official|pilot|disabled` nas opções e o
marcador `pilot` nas batidas. No ensaio, confirmação, detalhe, comprovante e
nome de arquivo dizem **Sequência do ensaio** e **sem validade como REP-P**, sem
apresentar NSR ou registro oficial. A finalidade declarada continua editável e
as alterações ficam na trilha do documento de ensaio. Contingência offline e
ajuste formal permanecem bloqueados nesse modo; o ensaio exige conexão e nunca
entra na ARP, no fechamento ou nos espelhos. O APK 0.3.20/code25 foi assinado
pelo certificado público esperado e tem SHA-256
`93986b8ecc1a8252be26dca500a64b7f4fd5123a3f300c5557585f95e8728da2`.
O mesmo release define `minVersionCode=25`: versões anteriores entram no fluxo
de atualização obrigatória antes de acessar os módulos do piloto.

### Verificação da 0.3.19 (Jornada e Registro de ponto)

Ponto e Escala permanecem acessíveis diretamente no início; o relógio é apenas
informativo e a batida continua dentro de Registro de ponto. Registros,
Histórico de ajustes e Banco de horas convergem para o Detalhe do dia; espelhos
fechados são apresentados por ano e mês. A finalidade organizacional é escolhida
e editável, sem alterar NSR, horário, hash ou documentos, e os totais Android
usam o instante completo para jornadas noturnas. O modo Entre unidades prepara
uma trilha operacional separada com estado e janela validados no servidor,
encerramento explícito e reconciliação após edição. `DP_JOURNEY_LOCATION_ENABLED`
permanece falso até decisão jurídica e de privacidade. Testes JVM, TypeScript,
contratos e integração cobrem os limites; aparelho físico e coleta real seguem
como gates separados. O APK 0.3.19/code24 foi assinado pelo certificado público
esperado e tem SHA-256 `244b0ff48e74cc269e7615eb0d71e2909d951f914d04b6e8ad5cce6995ccf246`.

### Verificação da 0.3.14 (etapas por unidade e cancelamento da nota)

A Compra local abre em cartões por unidade com sangria aguardando nota (com a
quantidade); tocar abre as sangrias da unidade. O filtro de organização e grupo
fica na primeira etapa, sem números. A nota enviada e não confirmada passa a
aparecer no cartão da própria sangria, com "Retomar revisão" e "Cancelar nota";
a revisão também oferece "Cancelar esta nota". O cancelamento chama
`/api/financial/inbox/mobile-upload/cancel` sob a mesma trava da sincronização
(`QueueSync.discard`): o servidor descarta a entrada da Caixa de entrada
(`status: ignored`, só quem enviou, nunca com compra confirmada) e só então o
aparelho grava a lápide na fila. A confirmação recusa um envio cancelado.
`ViewModelsTest` (cancelamento offline preservado e online removido), `RulesTest`,
contrato de fonte e o teste de integração
`financial-mobile-upload-cancel.test.mjs` cobrem o comportamento; aparelho
físico permanece fora desta homologação. O APK 0.3.14/code19 foi assinado pelo
certificado público esperado e tem SHA-256 `f42accb321e92b3bffb55cd7b0f879d159b319e641953ec5fee27599051a37ce`.

### Verificação da 0.3.13 (filtro sempre visível, captura da conta administrativa)

O 0.3.12 escondia organizações e grupos sem sangria pendente; com uma opção só,
o filtro inteiro sumia. Agora aparecem todos os escopos das unidades acessíveis,
com a contagem (inclusive zero). A captura de tela fica liberada para a conta de
login do app `administrativo@coalashakes.com` (o 0.3.12 usava um e-mail que não
é o do login). O APK 0.3.13/code18 foi assinado pelo certificado público
esperado e tem SHA-256 `ae9d6aff8a3d21d64450a7eb21845f9691a4f4280955be9eb9894f84098c7ecf`.

### Verificação da 0.3.12 (filtro por organização e grupo, captura de tela)

A lista de sangrias da Compra local filtra só por organização (no cabeçalho
escuro) e grupo (chips com contagem); o filtro de unidade saiu porque a lista já
é agrupada por unidade. Só aparecem escopos com sangria pendente, a escolha fica
salva por conta no aparelho e a vinculação aberta leva o filtro ao grupo da
sangria. Compras aguardando conciliação seguem o mesmo filtro, sem depender de
sangria visível da unidade. A proteção contra captura de tela (`FLAG_SECURE`)
continua padrão e é retirada apenas para contas da lista
`SCREEN_CAPTURE_ACCOUNTS`, com sessão desbloqueada. `RulesTest`, `ViewModelsTest`
e o contrato de fonte cobrem o comportamento; aparelho físico permanece fora
desta homologação. O APK 0.3.12/code17 foi assinado pelo certificado público
esperado e tem SHA-256
`d181508f7cfe1e30114a037b4f5ceeb51bffbf2a43413d26f7b381ed4583853c`.

### Verificação da 0.3.11 (retomada da vinculação e filtros de unidade)

A confirmação de conciliação posterior saiu da seção desconectada de compras
pendentes e passou ao cartão da própria sangria. Uma sessão local aberta muda a
ação para “Retomar vinculação”, traz o cartão para a área visível e bloqueia uma
segunda captura até confirmar ou cancelar. A lista é agrupada por unidade e usa
filtros de organização, grupo e unidade derivados apenas do vínculo estrutural
cadastrado. Testes JVM, regra pura da hierarquia e contrato de fonte cobrem o
comportamento; aparelho físico permanece fora desta homologação. O APK
0.3.11/code16 foi assinado pelo certificado público esperado e tem SHA-256
`9afe7f8d6fe66a059bec1607b0ba296feeea357bb77bedb500c1dd3b197cb163`.

### Verificação da 0.3.9 (Escala em "Todas as unidades", seta desenhada)

A Escala abre em "Todas as unidades" a cada visita (com uma unidade só, abre
nela). A seta dos seletores e das seções da revisão da Compra local passou a
ser o componente desenhado `DropdownChevron`, no lugar dos caracteres de seta.
Os padrões de interface do app foram documentados em `docs/design/app.md`.
`ViewModelsTest` cobre o valor inicial da Escala e o teste de contrato
`coala-go-ui-contract.test.ts` cobre o reinício a cada visita e a proibição de
caracteres de seta. As telas não foram vistas em emulador nem aparelho (o
emulador ficou desligado por pedido do responsável) e os testes de tela foram
só compilados.

### Verificação da 0.3.8 (motivo da sangria, "Todas as unidades", barra sem deslize)

A lista de sangrias e a revisão da compra mostram o motivo digitado no PDV,
quando o PDV o envia. Escala (visão Equipe) e Metas ganham "Todas as unidades"
no seletor, apenas com mais de uma unidade; em Metas a opção abre o resumo de
`scope=all`. O resumo deslizante de "Hoje" saiu da barra do início (alça e
gesto de arrastar removidos por decisão do responsável); a barra mostra só os
dados dela e os selos dos cartões continuam. Testes JVM cobrem a regra do seletor (`RulesTest`); as telas não
têm teste de tela e não foram vistas em emulador nem aparelho. O motivo vem do
campo `descricao` do PDV, confirmado na resposta real em 2026-10-12. O emulador
permaneceu encerrado durante a preparação do release 0.3.8/code13.
