import type { User } from "@firebase/auth";
import * as Crypto from "expo-crypto";

import { appConfig } from "./config";

/**
 * Prova ao servidor que a chamada vem do Coala Notas distribuído pela Play Store.
 * No Expo Go e em builds locais o Play Integrity não existe: o app segue sem o
 * atestado e o servidor decide (modo `off`/`monitor` aceita, `enforce` recusa).
 */
export const ATTESTATION_HEADER = "X-Coala-App-Attestation";
// Renova antes do fim da validade de 1 h emitida pelo servidor.
const RENEW_BEFORE_MS = 5 * 60 * 1000;
// Depois de uma falha, não insiste a cada chamada: o Play Integrity tem cota diária.
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

type Integrity = { prepareIntegrityTokenProviderAsync(project: string): Promise<void>; requestIntegrityCheckAsync(hash: string): Promise<string> };
let current: { uid: string; token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;
let retryAt = 0;
let prepared = false;

function integrityModule(): Integrity | null {
  try {
    // Módulo nativo: ausente no Expo Go, por isso não pode ser um import estático.
    return require("@expo/app-integrity") as Integrity;
  } catch {
    return null;
  }
}

async function exchange(user: User): Promise<string | null> {
  const integrity = integrityModule();
  if (!integrity) return null;
  if (!prepared) { await integrity.prepareIntegrityTokenProviderAsync(appConfig.firebase.messagingSenderId); prepared = true; }
  const nonce = Crypto.randomUUID();
  // Mesmo cálculo do servidor: o veredito do Google fica preso a este usuário e a esta troca.
  const requestHash = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${user.uid}:${nonce}`, { encoding: Crypto.CryptoEncoding.BASE64 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const integrityToken = await integrity.requestIntegrityCheckAsync(requestHash);
  const response = await fetch(`${appConfig.apiBaseUrl}/api/mobile/app-attestation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ integrityToken, nonce }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { attestation: { token: string; expiresAt: number } | null };
  if (!payload.attestation) return null;
  current = { uid: user.uid, ...payload.attestation };
  return current.token;
}

/** Cabeçalhos extras das chamadas à API; vazio quando o atestado não está disponível. */
export async function attestationHeaders(user: User): Promise<Record<string, string>> {
  if (current && current.uid === user.uid && current.expiresAt - RENEW_BEFORE_MS > Date.now()) return { [ATTESTATION_HEADER]: current.token };
  if (Date.now() < retryAt) return {};
  pending ??= exchange(user).catch(() => null).finally(() => { pending = null; });
  const token = await pending;
  if (!token) { retryAt = Date.now() + RETRY_AFTER_FAILURE_MS; return {}; }
  return { [ATTESTATION_HEADER]: token };
}
