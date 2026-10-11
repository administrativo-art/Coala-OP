#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$APP_DIR"
CURRENT_APK="${COALA_CURRENT_APK:-$APP_DIR/../../public/app/CoalaGo.apk}"
# Public certificate digest, verified against the former installer before its
# authorized retirement. This is not a private key or a credential.
EXPECTED_CERTIFICATE_SHA256="be5954ed83849474315dab9f6ed08e49d0de7b2401dc2915cacbe81ad2695837"
# Gradle consumes the same external properties as the existing Expo script.
# No key/password is read by this script, printed or copied into the repository.
./gradlew :app:assembleRelease --no-daemon
APK="$APP_DIR/app/build/outputs/apk/release/app-release.apk"
SIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"
CERTIFICATE="$("$SIGNER" verify --print-certs "$APK")"
case "$CERTIFICATE" in
  *"CN=Coala One"*) ;;
  *) echo "O APK não foi assinado pelo processo existente do Coala One." >&2; exit 1 ;;
esac
certificate_digest() { printf '%s\n' "$1" | awk '/certificate SHA-256 digest:/ { print $NF }'; }
[ "$(certificate_digest "$CERTIFICATE")" = "$EXPECTED_CERTIFICATE_SHA256" ] || {
  echo "Certificado diferente da chave existente do Coala One; build bloqueado." >&2; exit 1;
}
if [ -f "$CURRENT_APK" ]; then
  CURRENT_CERTIFICATE="$("$SIGNER" verify --print-certs "$CURRENT_APK")"
  [ "$(certificate_digest "$CURRENT_CERTIFICATE")" = "$EXPECTED_CERTIFICATE_SHA256" ] || {
    echo "Certificado do instalador de referência inesperado." >&2; exit 1;
  }
fi
AAPT="$ANDROID_HOME/build-tools/36.0.0/aapt"
package_identity() { "$AAPT" dump badging "$1" | awk -F "'" '/^package:/ { print $2; exit }'; }
[ "$(package_identity "$APK")" = "coalaone.go" ] || {
  echo "Package inesperado: somente Coala Go pode ser distribuído." >&2; exit 1;
}
if [ "$#" -gt 0 ]; then
  cp "$APK" "$1"
  APK="$1"
fi
echo "APK Coala Go gerado localmente: $APK"
shasum -a 256 "$APK"
