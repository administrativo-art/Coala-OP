# Coala Go — Android nativo

Kotlin, Jetpack Compose/Material 3, MVVM com ViewModel e StateFlow, Navigation Compose, Hilt, Retrofit/OkHttp, kotlinx.serialization, Coil, Room com payloads AES-256-GCM/Android Keystore, WorkManager, CameraX/seletor do sistema, BiometricPrompt e Firebase Auth nativo.

Android mínimo: **8 / API 26**, confirmado pelo usuário. Release usa `coalaone.go`; debug usa `coalaone.go.debug`. Coala Go é o único app mobile: após confirmar que não havia usuários, o responsável autorizou remover o Expo e o instalador antigo desta branch. Histórico Git e checkout original preservados.

## Configuração pública

Release lê configuração pública Android de `app/google-services.json` (ignorado pelo Git) ou `COALA_FIREBASE_CONFIG_FILE`. O client deve corresponder a `coalaone.go`. Debug não carrega esse arquivo, evitando Firebase real nos testes. Variáveis ou propriedades Gradle abaixo têm precedência:

| Nome | Conteúdo |
|---|---|
| `COALA_API_BASE_URL` | Origem HTTPS da mesma API do legado |
| `COALA_FIREBASE_API_KEY` | apiKey pública Firebase |
| `COALA_FIREBASE_APP_ID` | appId da aplicação **Android**, não o appId web do Expo |
| `COALA_FIREBASE_PROJECT_ID` | projectId Firebase |
| `COALA_FIREBASE_SENDER_ID` | Número do projeto Google para Play Integrity |
| `COALA_VERSION_CODE` | Código Android próprio do Go, padrão 8; crescente nas atualizações Go |
| `COALA_VERSION_NAME` | Versão exibida, padrão 0.3.3 |
| `COALA_LOCAL_TEST` | Somente debug: habilita HTTP e Auth emulator `10.0.2.2:9099` |

Debug sem configuração oferece simulação sem API/Firebase/Storage de negócio. Release recusa configuração pública ausente, appId web, HTTP, modo de teste ou ausência da assinatura existente. Não registrar `local.properties`, `google-services.json`, `.env`, APKs intermediários, senhas ou keystores no Git. A exceção de distribuição é o instalador assinado `public/app/CoalaGo.apk`, acompanhado por metadados e hash verificados.

## Verificação local

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug

# Com emulador Android exclusivo conectado:
./gradlew :app:connectedDebugAndroidTest

# Na raiz do repositório, após os testes JVM:
node --import tsx scripts/verify-android-contracts.mts
```

Os testes JVM exportam payloads reais serializados em `app/build/contract-fixtures.json`. O verificador TypeScript os valida contra os mesmos schemas Zod do backend; não há cópia divergente de schema no script.

O teste Firebase instrumentado exige o Auth Emulator local na porta 9099, projeto `demo-coala-go`; a configuração é `test-emulators.json`. O dispositivo Android acessa o host em `10.0.2.2`. Debug permite HTTP somente para esse endereço, localhost e 127.0.0.1; release não inclui a configuração de rede de debug. Os testes de seleção de documento usam Espresso Intents para entregar um arquivo de teste, sem abrir navegador nem usar notas reais.

## Assinatura e distribuição

`bash scripts/build-apk.sh [destino.apk]` gera o release local. Gradle reutiliza o arquivo externo `~/.coala-one/keystore.properties` (ou `COALA_ONE_KEYSTORE_PROPERTIES`) do processo atual, em memória; não copia nem imprime a chave/senhas. O script verifica o certificado público `CN=Coala One`, apesar do novo nome exibido. O APK não é copiado automaticamente para `public/app/` nem publicado.

O build verifica o digest público SHA-256 fixado após comparação com o APK antigo: `be5954ed83849474315dab9f6ed08e49d0de7b2401dc2915cacbe81ad2695837`. Compara também com o instalador Go existente (ou `COALA_CURRENT_APK`) se disponível. Nome do certificado sozinho não comprova a mesma chave. Nunca inspeciona a chave privada.

Instalador preparado em `public/app/CoalaGo.apk`, usado pela página `/app` e pelo atualizador. Metadados em `src/lib/mobile-app-release.ts` devem acompanhar versão Gradle e hash SHA-256 do APK; testes impedem divergência. Preparação local não publica o link em produção. Consulte o [roteiro](../../docs/engineering/coala-go-device-migration.md) e a [matriz](../../docs/engineering/coala-go-parity.md).

## Fila e isolamento por conta

Room guarda IDs, hash do UID, estado e confirmação cifrada. Documentos e metadados de compra ficam em arquivo AES-GCM no diretório privado `noBackupFilesDir`, com chave individual por UID no Android Keystore. AAD prende cada payload à conta e ao envio. Documentos grandes não atravessam o CursorWindow do SQLite. Arquivos atômicos são recuperados se o processo parar antes do insert; tombstones de confirmação impedem ressuscitar uma compra após apagar os documentos.

WorkManager repete usando o mesmo UUID, somente com rede, e valida a conta no envio. O cliente HTTP confere o UID esperado imediatamente antes de colocar o token na requisição. O upload confirmado permanece disponível para revisão; os documentos só são apagados após confirmar a compra. Sair da conta preserva a fila.

## Handoff visual nativo

O handoff `Coala One App - Prototipo.dc.html` foi adaptado para **Coala Go**,
sem runtime HTML ou dados fictícios no release. Inter Tight e JetBrains Mono
estão embarcadas em `res/font`, com licenças SIL OFL em `assets/font-licenses`.
Não há nova biblioteca. `Motion.kt` implementa a aurora com gradientes radiais
compatíveis com API 26, ilustrações em Canvas, progressos e preferência de
movimento do sistema. `Brand` usa Brush em spans de texto reais, com ciclos
de seis segundos na marca e 4,5 segundos no slogan, sem máscara ou recorte.
As transições de navegação têm fade/pequeno deslocamento; os cards de revisão
expandem suavemente. Escala zero desliga movimentos decorativos e mostra o
progresso final. Animações nunca simulam resposta de servidor.

Home usa hero de compra e grid filtrado pelas permissões reais, preservando
Signage. Metas oferece Dias/Equipe/Prêmio; Escala seleciona um dia da semana
e Equipe/Só minha, sem perder a navegação semanal. Compra, contagem e
recebimento mantêm seus ViewModels, validações, confirmações e contratos.
Limites/estados reais prevalecem sobre números, timers e sucessos do protótipo.

`DesignMotionTest` verifica movimento, redução e fonte ampliada;
`DesignScreensTest` captura telas nativas em simulação e navega nas novas abas;
`ComposeFlowsTest` continua cobrindo as ações de negócio. As capturas liberam
FLAG_SECURE somente na janela de teste, nunca no aplicativo distribuído.

## Bibliotecas adicionais (integrações)

- AndroidX Activity, Fragment, Lifecycle, Core e Test: integração de Compose, ciclo de vida, FileProvider, BiometricPrompt e instrumentação.
- Google Play Integrity: implementação nativa da atestação existente.
- ZXing **core**: CameraX entrega imagens mas não decodifica QR; decodificador local para `COALA-SIGNAGE`, sem rede ou armazenamento externo.
- kotlinx-coroutines-play-services: adaptação cancelável de Tasks Firebase/Integrity.
- JUnit, MockWebServer e WorkManager Testing: testes JVM/HTTP e instrumentação, sem dependências de produção adicionais.

## Limites de homologação

Compilação/testes locais não comprovam Firebase real, Play Integrity reconhecendo release sideloaded, câmera física, biometria real nem atualização Go sobre Go. O responsável autorizou retirar o legado antes desse aceite por não haver usuários; as lacunas continuam explicitadas na matriz, sem equivaler a homologação de produção.
