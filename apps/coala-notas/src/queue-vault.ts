import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";

/**
 * As notas da fila offline ficam cifradas (AES-256-GCM) no disco. A chave vive
 * no cofre do Android, fora da pasta do app, então copiar os arquivos de um
 * aparelho com root não revela os documentos.
 */
const KEY_NAME = "coala-notas.queue-key.v1";
let cachedKey: Promise<AESEncryptionKey> | null = null;

async function loadKey() {
  const stored = await SecureStore.getItemAsync(KEY_NAME);
  if (stored) return AESEncryptionKey.import(stored, "base64");
  const key = await AESEncryptionKey.generate(256);
  await SecureStore.setItemAsync(KEY_NAME, await key.encoded("base64"), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return key;
}

function queueKey() {
  cachedKey ??= loadKey().catch((cause) => { cachedKey = null; throw cause; });
  return cachedKey;
}

/** Grava em `to` a versão cifrada de `from`. */
export async function sealFile(from: string, to: string) {
  const plain = await FileSystem.readAsStringAsync(from, { encoding: FileSystem.EncodingType.Base64 });
  const sealed = await aesEncryptAsync(plain, await queueKey());
  await FileSystem.writeAsStringAsync(to, await sealed.combined("base64"), { encoding: FileSystem.EncodingType.Base64 });
}

/** Grava em `to` o documento original a partir do arquivo cifrado `from`. */
export async function openFile(from: string, to: string) {
  const combined = await FileSystem.readAsStringAsync(from, { encoding: FileSystem.EncodingType.Base64 });
  const plain = await aesDecryptAsync(AESSealedData.fromCombined(combined), await queueKey(), { output: "base64" });
  await FileSystem.writeAsStringAsync(to, plain, { encoding: FileSystem.EncodingType.Base64 });
}
