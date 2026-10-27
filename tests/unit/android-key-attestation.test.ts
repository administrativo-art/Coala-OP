import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import * as asn from 'asn1js';

import { androidChallenge, androidPassForChallenge, androidProofMessage, validAndroidChallenge, verifyAndroidKeyProof, type AndroidKeyProof } from '../../src/lib/security/android-key-attestation';

const secret = 'test-only-android-key-proof-secret-2026';
const uid = 'demo-android-user';
const signingDigest = 'ab'.repeat(32);
function bytes(value: string | Buffer) { return new asn.OctetString({ valueHex: Buffer.from(value) }); }
function integer(value: number) { return new asn.Integer({ value }); }
function explicit(id: number, node: asn.BaseBlock) {
  return new asn.Constructed({ idBlock: { tagClass: 3, tagNumber: id }, value: [node] });
}
type FixtureOptions = { challengeToken?: string; packageName?: string; signer?: string; hardware?: number; locked?: boolean; bootState?: number; version?: number };
function fixture(options: FixtureOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'coala-android-pki-'));
  try {
    const challenge = options.challengeToken ?? androidChallenge(secret, uid).challengeToken;
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    writeFileSync(join(directory, 'leaf.key'), key.export({ type: 'pkcs8', format: 'pem' }));
    const appId = new asn.Sequence({ value: [new asn.Set({ value: [new asn.Sequence({ value: [
      bytes(options.packageName ?? 'coalaone.go'), integer(options.version ?? 33),
    ] })] }), new asn.Set({ value: [bytes(Buffer.from(options.signer ?? signingDigest, 'hex'))] })] });
    const extension = new asn.Sequence({ value: [integer(100), new asn.Enumerated({ value: options.hardware ?? 1 }), integer(100),
      new asn.Enumerated({ value: options.hardware ?? 1 }), bytes(createHash('sha256').update(challenge).digest()), bytes(''),
      new asn.Sequence({ value: [explicit(709, bytes(Buffer.from(appId.toBER(false))))] }),
      new asn.Sequence({ value: [explicit(704, new asn.Sequence({ value: [bytes(Buffer.alloc(32)),
        new asn.Boolean({ value: options.locked ?? true }), new asn.Enumerated({ value: options.bootState ?? 0 }), bytes(Buffer.alloc(32))] }))] }),
    ] });
    writeFileSync(join(directory, 'leaf.cnf'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.3.6.1.4.1.11129.2.1.17=DER:${Buffer.from(extension.toBER(false)).toString('hex')}\n`);
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
    run('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'root.key',
      '-out', 'root.pem', '-days', '3', '-subj', '/CN=Demo Android root', '-addext', 'basicConstraints=critical,CA:TRUE');
    run('req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=Demo Android key');
    run('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '10', '-days', '2',
      '-extfile', 'leaf.cnf', '-out', 'leaf.pem');
    const leaf = new X509Certificate(readFileSync(join(directory, 'leaf.pem')));
    const root = new X509Certificate(readFileSync(join(directory, 'root.pem')));
    const rootKey = createHash('sha256').update(root.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    const proof: AndroidKeyProof = { provider: 'android-key', challengeToken: challenge,
      certificateChain: [leaf.raw.toString('base64'), root.raw.toString('base64')],
      signature: sign('sha256', Buffer.from(androidProofMessage(uid, challenge)), key).toString('base64') };
    return { proof, options: { trustedRootKeys: [rootKey], signingDigest, minVersionCode: 33 } };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
test('desafio de hardware é autenticado, limitado a cinco minutos e vinculado ao titular', () => {
  const now = Date.now();
  const { challengeToken } = androidChallenge(secret, uid, now);
  assert.equal(validAndroidChallenge(secret, challengeToken, uid, now + 1000), true);
  assert.equal(validAndroidChallenge(secret, challengeToken, 'another-user', now + 1000), false);
  assert.equal(validAndroidChallenge(secret, challengeToken, uid, now + 300_000), false);
  assert.equal(validAndroidChallenge(secret, `${challengeToken}x`, uid, now + 1000), false);
  assert.equal(validAndroidChallenge('other-secret', challengeToken, uid, now + 1000), false);
});
test('APK direto exige cadeia assinada, hardware, boot verificado, pacote, certificado e prova de posse', () => {
  const valid = fixture();
  assert.equal(verifyAndroidKeyProof(valid.proof, secret, uid, {}, valid.options), true);
  assert.equal(verifyAndroidKeyProof(valid.proof, secret, uid, {}), false, 'raiz do teste nunca é raiz de produção');
  assert.equal(verifyAndroidKeyProof(valid.proof, secret, 'other-user', {}, valid.options), false);
  assert.equal(verifyAndroidKeyProof({ ...valid.proof, signature: Buffer.alloc(72).toString('base64') }, secret, uid, {}, valid.options), false);
  assert.equal(verifyAndroidKeyProof(valid.proof, secret, uid, { '000A': { status: 'REVOKED' } }, valid.options), false);
  assert.equal(verifyAndroidKeyProof({ ...valid.proof, certificateChain: [...valid.proof.certificateChain].reverse() }, secret, uid, {}, valid.options), false);
  for (const options of [{ packageName: 'coalaone.go.debug' }, { signer: 'cd'.repeat(32) }, { hardware: 0 },
    { locked: false }, { bootState: 1 }, { version: 32 }]) {
    const rejected = fixture(options);
    assert.equal(verifyAndroidKeyProof(rejected.proof, secret, uid, {}, rejected.options), false, JSON.stringify(options));
  }
});
test('reenvios sequenciais e concorrentes da mesma prova não renovam nem estendem o passe', async () => {
  const now = Date.now();
  const { challengeToken } = androidChallenge(secret, uid, now);
  const first = androidPassForChallenge(secret, challengeToken, uid, now + 1000);
  assert.ok(first);
  assert.deepEqual(androidPassForChallenge(secret, challengeToken, uid, now + 299_000), first);
  const concurrent = await Promise.all(Array.from({ length: 10 }, async (_, i) => androidPassForChallenge(secret, challengeToken, uid, now + i * 1000)));
  for (const pass of concurrent) assert.deepEqual(pass, first);
  assert.equal(first.expiresAt, now + 3_600_000);
  assert.equal(androidPassForChallenge(secret, challengeToken, uid, now + 300_000), null);
});
