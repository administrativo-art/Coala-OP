import { createHash, createHmac, randomBytes, timingSafeEqual, verify, X509Certificate } from 'node:crypto';

import * as asn from 'asn1js';
import { z } from 'zod';
import { signMobileAttestation } from './mobile-app-attestation';

export const ANDROID_CHALLENGE_TTL_MS = 5 * 60_000;
export const COALA_GO_SIGNING_SHA256 = 'be5954ed83849474315dab9f6ed08e49d0de7b2401dc2915cacbe81ad2695837';
// SPKI SHA-256 from https://android.googleapis.com/attestation/root, checked 2026-10-27.
export const ANDROID_ATTESTATION_ROOT_KEYS = [
  'feb2ea7551ee316ed4bb443c8293b884dbfdea40b603ee3e4f4a897e4580fbae',
  '3ee44512a1af2beb39c889490c60ea3f82e43f5d5a5532f5ab9419f676cd07ec',
] as const;
const OID = '1.3.6.1.4.1.11129.2.1.17';
const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const androidKeyProofSchema = z.object({
  provider: z.literal('android-key'),
  challengeToken: z.string().min(80).max(1500),
  certificateChain: z.array(b64.min(100).max(16_000)).min(2).max(6),
  signature: b64.min(80).max(256),
}).strict();
export type AndroidKeyProof = z.infer<typeof androidKeyProofSchema>;
const challengeSchema = z.object({ purpose: z.literal('coala-go-android-key-v1'), uid: z.string().min(1).max(180),
  issuedAt: z.number().int(), expiresAt: z.number().int(), nonce: z.string().length(43) }).strict();
function mac(secret: string, data: string) { return createHmac('sha256', secret).update(data).digest('base64url'); }
function equal(a: Buffer, b: Buffer) { return a.length === b.length && timingSafeEqual(a, b); }
export function androidChallenge(secret: string, uid: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ purpose: 'coala-go-android-key-v1', uid, issuedAt: now,
    expiresAt: now + ANDROID_CHALLENGE_TTL_MS, nonce: randomBytes(32).toString('base64url') })).toString('base64url');
  return { challengeToken: `${payload}.${mac(secret, payload)}`, expiresAt: now + ANDROID_CHALLENGE_TTL_MS };
}
function challengeIssuedAt(secret: string, token: string, uid: string, now: number): number | null {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length || !equal(Buffer.from(mac(secret, payload)), Buffer.from(signature))) return null;
  try {
    const data = challengeSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    return data.uid === uid && data.issuedAt <= now && data.expiresAt > now
      && data.expiresAt - data.issuedAt === ANDROID_CHALLENGE_TTL_MS ? data.issuedAt : null;
  } catch { return null; }
}
export function validAndroidChallenge(secret: string, token: string, uid: string, now = Date.now()) {
  return challengeIssuedAt(secret, token, uid, now) !== null;
}
/** Called after hardware verification. Replaying a proof yields the exact same pass, never a renewed lifetime. */
export function androidPassForChallenge(secret: string, token: string, uid: string, now = Date.now()) {
  const issuedAt = challengeIssuedAt(secret, token, uid, now);
  return issuedAt === null ? null : signMobileAttestation(secret, uid, issuedAt);
}
export function androidProofMessage(uid: string, token: string) { return `coala-go-direct-app-v1\n${uid}\n${token}`; }
type Node = asn.BaseBlock;
function parse(data: Uint8Array): Node {
  const result = asn.fromBER(Uint8Array.from(data), { maxDepth: 32, maxNodes: 1500, maxContentLength: 64_000, parseEmbedded: false });
  if (result.offset !== data.length || result.result.error) throw new Error('Invalid DER');
  return result.result;
}
function children(node: Node): Node[] {
  if (!(node instanceof asn.Constructed)) throw new Error('Constructed value required');
  return node.valueBlock.value;
}
function octets(node: Node) {
  if (!(node instanceof asn.OctetString) || node.idBlock.isConstructed) throw new Error('Octet string required');
  return Buffer.from(node.valueBlock.valueHexView);
}
function number(node: Node) {
  if (!(node instanceof asn.Integer) || !Number.isSafeInteger(node.valueBlock.valueDec)) throw new Error('Integer required');
  return node.valueBlock.valueDec;
}
function tag(list: Node, id: number) {
  const matches = children(list).filter((node) => node.idBlock.tagClass === 3 && node.idBlock.tagNumber === id);
  if (matches.length !== 1) throw new Error('Missing or duplicate authorization');
  const content = children(matches[0]);
  if (content.length !== 1) throw new Error('Invalid explicit authorization');
  return content[0];
}
function extension(certificate: X509Certificate): Node | null {
  const cert = children(parse(certificate.raw));
  const tbs = children(cert[0]);
  const extensions = tbs.filter((node) => node.idBlock.tagClass === 3 && node.idBlock.tagNumber === 3);
  if (extensions.length !== 1) return null;
  const matches = children(children(extensions[0])[0]).filter((node) => {
    const fields = children(node);
    return fields[0] instanceof asn.ObjectIdentifier && fields[0].valueBlock.toString() === OID;
  });
  if (matches.length > 1) throw new Error('Duplicate attestation extension');
  if (!matches.length) return null;
  return parse(octets(children(matches[0]).at(-1)!));
}
export type AndroidRevocationList = Record<string, { status: string; reason?: string }>;
export type AndroidKeyVerification = { now?: number; trustedRootKeys?: readonly string[]; signingDigest?: string; minVersionCode?: number; packageName?: string };
/** Verifies hardware evidence server-side. The caller supplies a fresh, HTTPS-fetched revocation list. */
export function verifyAndroidKeyProof(input: AndroidKeyProof, secret: string, uid: string, revocations: AndroidRevocationList,
  options: AndroidKeyVerification = {}): boolean {
  try {
    const now = options.now ?? Date.now();
    if (!androidKeyProofSchema.safeParse(input).success || !validAndroidChallenge(secret, input.challengeToken, uid, now)) return false;
    const chain = input.certificateChain.map((value) => new X509Certificate(Buffer.from(value, 'base64')));
    const root = chain.at(-1)!;
    const rootKey = createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    if (!(options.trustedRootKeys ?? ANDROID_ATTESTATION_ROOT_KEYS).includes(rootKey) || !root.ca || !root.verify(root.publicKey)) return false;
    for (let i = 0; i < chain.length; i++) {
      const certificate = chain[i];
      const serial = certificate.serialNumber.toLowerCase().replace(/^0+/, '') || '0';
      if (Object.keys(revocations).some((key) => (key.toLowerCase().replace(/^0+/, '') || '0') === serial)) return false;
      // Android's older root is trusted by public key across certificate renewals.
      if (i < chain.length - 1 && (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now)) return false;
      if (i < chain.length - 1 && (!chain[i + 1].ca || !certificate.checkIssued(chain[i + 1]) || !certificate.verify(chain[i + 1].publicKey))) return false;
    }
    // Trust the first attestation from the root; never a forged extension added beneath it.
    let description: Node | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const candidate = extension(chain[i]);
      if (candidate) { if (i !== 0) return false; description = candidate; break; }
    }
    if (!description) return false;
    const fields = children(description);
    if (fields.length !== 8 || ![1, 2].includes(number(fields[1])) || ![1, 2].includes(number(fields[3]))) return false;
    if (!equal(octets(fields[4]), createHash('sha256').update(input.challengeToken).digest())) return false;
    const hardware = fields[7];
    const trust = children(tag(hardware, 704));
    if (!(trust[1] instanceof asn.Boolean) || !trust[1].valueBlock.value || number(trust[2]) !== 0) return false;
    const application = children(parse(octets(tag(fields[6], 709))));
    if (application.length !== 2) return false;
    const packages = children(application[0]);
    const digests = children(application[1]);
    if (packages.length !== 1 || digests.length !== 1) return false;
    const pkg = children(packages[0]);
    if (pkg.length !== 2 || octets(pkg[0]).toString() !== (options.packageName ?? 'coalaone.go') || number(pkg[1]) < (options.minVersionCode ?? 1)) return false;
    if (octets(digests[0]).toString('hex') !== (options.signingDigest ?? COALA_GO_SIGNING_SHA256)) return false;
    if (chain[0].publicKey.asymmetricKeyType !== 'ec' || chain[0].publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    return verify('sha256', Buffer.from(androidProofMessage(uid, input.challengeToken)), chain[0].publicKey, Buffer.from(input.signature, 'base64'));
  } catch { return false; }
}
