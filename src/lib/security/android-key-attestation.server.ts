import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/observability/app-error';
import { COALA_GO_RELEASE } from '@/lib/mobile-app-release';

import { androidChallenge, androidPassForChallenge, verifyAndroidKeyProof, type AndroidKeyProof, type AndroidRevocationList } from './android-key-attestation';
import { mobileAttestationSecret } from './mobile-app-attestation.server';

const revocationSchema = z.object({ entries: z.record(z.object({ status: z.string() }).passthrough()) }).passthrough();
let cached: { entries: AndroidRevocationList; until: number } | undefined;
let pending: Promise<AndroidRevocationList> | undefined;
async function revocations(): Promise<AndroidRevocationList> {
  if (cached && cached.until > Date.now()) return cached.entries;
  pending ??= (async () => {
    try {
      const response = await fetch('https://android.googleapis.com/attestation/status', {
        signal: AbortSignal.timeout(10_000), redirect: 'error', cache: 'no-store',
      });
      if (!response.ok) throw new Error('Revocation service unavailable');
      const body = await response.text();
      if (body.length > 2_000_000) throw new Error('Revocation response too large');
      const { entries } = revocationSchema.parse(JSON.parse(body));
      const maxAge = Math.min(3600, Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600));
      cached = { entries, until: Date.now() + maxAge * 1000 };
      return entries;
    } catch {
      throw new AppError({ code: 'MOBILE_KEY_REVOCATION_UNAVAILABLE', kind: 'TRANSIENT_EXTERNAL',
        safeMessage: 'A verificação segura do aparelho está temporariamente indisponível. Tente novamente com conexão.' });
    } finally { pending = undefined; }
  })();
  return pending;
}
export function issueAndroidKeyChallenge(uid: string) { return androidChallenge(mobileAttestationSecret(), uid); }
export async function issueAndroidKeyAttestation(uid: string, proof: AndroidKeyProof) {
  const secret = mobileAttestationSecret();
  if (!verifyAndroidKeyProof(proof, secret, uid, await revocations(), { minVersionCode: COALA_GO_RELEASE.minVersionCode })) {
    throw new AppError({ code: 'MOBILE_KEY_ATTESTATION_REJECTED', kind: 'AUTHORIZATION',
      safeMessage: 'Não foi possível verificar a assinatura do Coala Go e a proteção deste aparelho. Atualize pelo link oficial ou procure o suporte.' });
  }
  const pass = androidPassForChallenge(secret, proof.challengeToken, uid);
  if (!pass) throw new AppError({ code: 'MOBILE_KEY_CHALLENGE_EXPIRED', kind: 'AUTHORIZATION',
    safeMessage: 'A verificação do aparelho expirou. Tente novamente.' });
  return pass;
}
