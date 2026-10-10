import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

/**
 * Atalho opcional para o bloqueio: digital ou rosto no lugar da senha.
 * A senha continua sendo a prova de identidade — a biometria só vale para a
 * conta que a ativou neste aparelho e por um prazo desde a última senha digitada.
 */
const STORAGE_KEY = "coala-notas.biometric-unlock.v1";
const PASSWORD_VALID_FOR_MS = 7 * 24 * 60 * 60 * 1000;

type Preference = { uid: string; lastPasswordAt: number };

async function readPreference(): Promise<Preference | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) as Partial<Preference> : null;
    return value && typeof value.uid === "string" && typeof value.lastPasswordAt === "number" ? value as Preference : null;
  } catch {
    return null;
  }
}

/** O aparelho tem leitor e ao menos uma digital ou rosto cadastrado. */
export async function biometricsAvailable() {
  try {
    return await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

/** A conta ativou a biometria aqui e digitou a senha dentro do prazo. */
export async function biometricUnlockReady(uid: string) {
  const preference = await readPreference();
  return preference?.uid === uid && Date.now() - preference.lastPasswordAt < PASSWORD_VALID_FOR_MS && await biometricsAvailable();
}

export async function biometricUnlockEnabled(uid: string) {
  return (await readPreference())?.uid === uid;
}

/** Chamado a cada senha conferida; `enabled` reflete a escolha do operador naquele momento. */
export async function recordPasswordUnlock(uid: string, enabled: boolean) {
  if (enabled) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ uid, lastPasswordAt: Date.now() } satisfies Preference));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}

/** Login com senha renova o prazo da própria conta; outra conta entrando apaga o atalho da anterior. */
export async function recordPasswordLogin(uid: string) {
  const preference = await readPreference();
  if (preference) await recordPasswordUnlock(uid, preference.uid === uid);
}

export async function promptBiometricUnlock() {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Desbloquear o Coala One",
      cancelLabel: "Usar senha",
      // O PIN do aparelho não vale: num celular compartilhado todos o conhecem.
      disableDeviceFallback: true,
      biometricsSecurityLevel: "strong",
    });
    return result.success;
  } catch {
    return false;
  }
}
