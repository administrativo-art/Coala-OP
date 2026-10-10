#!/usr/bin/env bash
# Gera o APK de instalação direta do Coala One, assinado com a chave definitiva.
#
# Requisitos (macOS, Homebrew): openjdk@21 e android-commandlinetools com
# platforms;android-36 e build-tools;36.0.0. A chave e a senha ficam fora do
# repositório, em ~/.coala-one/keystore.properties (storeFile, storePassword,
# keyAlias, keyPassword). Perder a chave obriga todos a reinstalar o aplicativo.
#
# Uso: scripts/build-apk.sh [destino.apk]
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROPS="${COALA_ONE_KEYSTORE_PROPERTIES:-$HOME/.coala-one/keystore.properties}"
OUT="${1:-$APP_DIR/../../public/app/CoalaOne.apk}"

[ -f "$PROPS" ] || { echo "Chave de assinatura não encontrada em $PROPS." >&2; exit 1; }
prop() { grep "^$1=" "$PROPS" | cut -d= -f2-; }
STORE_FILE="$(prop storeFile)"
[ -f "$STORE_FILE" ] || { echo "Arquivo da chave não encontrado: $STORE_FILE" >&2; exit 1; }

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$PATH"
export NODE_ENV=production

cd "$APP_DIR"
# O projeto nativo é regenerado a cada build; nada dentro de android/ é editado à mão.
npx expo prebuild --platform android --no-install

# As propriedades de assinatura entram num arquivo de propriedades dentro de android/ (pasta fora do git)
# só durante o build: assim a senha não aparece na linha de comando nem na lista de processos.
SIGNING_PROPS="$APP_DIR/android/gradle.properties"
cp "$SIGNING_PROPS" "$SIGNING_PROPS.sem-assinatura"
trap 'mv -f "$SIGNING_PROPS.sem-assinatura" "$SIGNING_PROPS" 2>/dev/null || true' EXIT
{
  echo ""
  echo "android.injected.signing.store.file=$STORE_FILE"
  echo "android.injected.signing.store.password=$(prop storePassword)"
  echo "android.injected.signing.key.alias=$(prop keyAlias)"
  echo "android.injected.signing.key.password=$(prop keyPassword)"
} >> "$SIGNING_PROPS"

(cd android && ./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a)

APK="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"
# O build só vale se o APK estiver assinado com a chave definitiva, nunca com a de depuração.
SIGNER="$("$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$APK" | grep "certificate DN" | head -1)"
case "$SIGNER" in
  *"CN=Coala One"*) ;;
  *) echo "APK assinado com a chave errada: $SIGNER" >&2; exit 1 ;;
esac

mkdir -p "$(dirname "$OUT")"
cp "$APK" "$OUT"
echo "APK pronto: $OUT"
echo "$SIGNER"
shasum -a 256 "$OUT"
