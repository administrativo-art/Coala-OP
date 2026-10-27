# Coala Go — primeira instalação e homologação

O responsável confirmou que ninguém utiliza o app antigo e autorizou sua remoção. Coala Go é o único app mobile nesta branch: código em `apps/coala-one-android`, package `coalaone.go`, Android 8/API26 ou superior. O Expo e `public/app/CoalaMobile.apk` foram removidos localmente; histórico Git e checkout original permanecem disponíveis para recuperação. Não há migração operacional de usuários ou filas.

## Instalação inicial

1. Integrar/publicar backend, metadados e APK somente após autorização específica; alterações atuais são locais.
2. Baixar pela página `/app`, botão "Baixar Coala Go"; caminho publicado `/app/CoalaGo.apk`, versão 0.3.25/code30.
3. Instalar em aparelho piloto Android8+ e fazer login com conta de homologação autorizada.
4. Conferir permissões, fotos, contagem, recebimento, compra/revisão/offline, escala, metas e Signage. Ensaiar câmera, biometria e reinício sem perda da fila.
5. Homologar a [verificação de hardware e assinatura do APK direto](android-direct-apk-attestation.md): o cadastro Firebase não comprova a instalação. Decisão de 27/10/2026 elimina publicação em loja; a autorização offline continua exigindo passe verificado no servidor.
6. Expandir o uso somente após registrar aceite das lacunas na [matriz](coala-go-parity.md).

## Atualizações e recuperação

- `/api/app/version` passa a representar Go por padrão; a query Go explícita continua suportada. Seleção explícita do package retirado devolve instalador nulo, nunca APK Go.
- `src/lib/mobile-app-release.ts`, versão Gradle, hash e `public/app/CoalaGo.apk` precisam acompanhar o mesmo release. A assinatura pública foi comprovada igual à antiga; o processo reutiliza a chave externa sem copiá-la ou exibi-la.
- Atualização Go sobre Go exige mesmo package/certificado e versionCode crescente. O usuário confirma no instalador Android. Não limpar dados/desinstalar com fila Go pendente.
- Em aparelhos exclusivamente de teste que tenham instalado `com.coalaone.notas`, remover esse package é ação manual separada. O Go não lê sua fila nem login; concluir eventuais documentos de teste pelo antigo antes de desinstalar.
- Reversão de código permanece possível pelo histórico, mas nenhuma versão antiga deve ser distribuída automaticamente. O antigo não está mais oferecido na página.

Nenhum aparelho real é modificado automaticamente. O link muda somente quando a versão do repositório é promovida para produção.
