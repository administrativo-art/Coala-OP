import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { PDFDocument } from 'pdf-lib';

import { generateRepPAfd, signRepPAfd } from '../../src/features/dp/rep-p/afd';
import { hashRepPType7 } from '../../src/features/dp/rep-p/core';
import { decodeOid, der, parseDer } from '../../src/features/dp/rep-p/der';
import {
  buildRepPDetachedCms, createRepPIcpSigners, REP_P_CADES_SIGNATURE_POLICY, inspectRepPIcpCredential, loadRepPIcpIdentity, verifyRepPDetachedCms, verifyRepPSignedPdf,
} from '../../src/features/dp/rep-p/icp-signer';
import { REP_P_RECEIPT_TITLE, renderRepPReceiptPdf, signRepPReceipt, type RepPReceiptSnapshot } from '../../src/features/dp/rep-p/receipt';
import { createTestIcpCredential } from '../helpers/rep-p-test-certificate';

const developerCnpj = '14276603000125';
const credential = createTestIcpCredential();
const now = new Date('2026-10-18T11:15:00Z');
const markedAt = '2026-10-18T08:15:00-0300';
const snapshot: RepPReceiptSnapshot = {
  schemaVersion: 1, title: REP_P_RECEIPT_TITLE, nsr: 3, markedAt,
  hash: hashRepPType7({ nsr: 3, markedAt, employeeCpf: '52998224725', recordedAt: markedAt, collectorId: '01', mode: '0', previousHash: null }),
  employerLegalName: 'CT Sorvetes LTDA', employerCnpj: developerCnpj, cnoCaepf: null, workLocation: 'Rua fiscal, 1',
  inpiRegistration: '12345678901234567', developerCnpj, employeeName: 'Maria Teste', employeeCpf: '52998224725',
  collectorId: '01', establishmentId: 'establishment-a', executionUnitId: 'unit-b',
};

describe('Assinador ICP-Brasil A1 do REP-P', () => {
  it('loads only a key-matching, in-force certificate of the developer CNPJ', () => {
    const identity = loadRepPIcpIdentity(credential.pem, '14.276.603/0001-25', now);
    assert.equal(identity.cnpj, developerCnpj);
    assert.throws(() => loadRepPIcpIdentity(credential.pem, '11222333000181', now), { code: 'REP_P_ICP_CNPJ_MISMATCH' });
    assert.throws(() => loadRepPIcpIdentity(credential.pem, developerCnpj, new Date('2031-01-01T00:00:00Z')),
      { code: 'REP_P_ICP_CERTIFICATE_EXPIRED' });
    const certificateOnly = credential.pem.slice(credential.pem.indexOf('-----BEGIN CERTIFICATE-----'));
    assert.throws(() => loadRepPIcpIdentity(certificateOnly, developerCnpj, now), { code: 'REP_P_ICP_KEY_MISSING' });
    const otherKey = createTestIcpCredential().pem.split('-----BEGIN CERTIFICATE-----')[0];
    assert.throws(() => loadRepPIcpIdentity(`${otherKey}-----BEGIN CERTIFICATE-----${credential.pem.split('-----BEGIN CERTIFICATE-----')[1]}`,
      developerCnpj, now), { code: 'REP_P_ICP_CERTIFICATE_MISSING' });
  });

  it('builds a detached CMS that verifies only against the exact content', () => {
    const identity = loadRepPIcpIdentity(credential.pem, developerCnpj, now);
    const content = Buffer.from('conteúdo AFD', 'latin1');
    const cms = buildRepPDetachedCms(identity, content, { signingTime: now });
    assert.deepEqual(verifyRepPDetachedCms(cms, content), { valid: true, certificateCnpj: developerCnpj });
    assert.equal(verifyRepPDetachedCms(cms, Buffer.from('conteúdo alterado')).valid, false);
    const tampered = Buffer.from(cms); tampered[tampered.length - 5] ^= 0xff;
    assert.equal(verifyRepPDetachedCms(tampered, content).valid, false);
  });

  it('signs the AFD through the existing CAdES contract', async () => {
    const identity = loadRepPIcpIdentity(credential.pem, developerCnpj, now);
    const pkg = generateRepPAfd({ profile: { establishmentId: 'e', employerCnpj: developerCnpj, employerLegalName: 'CT Sorvetes LTDA',
      inpiRegistration: '12345678901234567', developerCnpj }, startDate: '2026-10-18', endDate: '2026-10-18',
    generatedAt: '2026-10-18T10:00:00-0300', events: [] });
    const signed = await signRepPAfd(pkg, createRepPIcpSigners(identity, () => now).cades, developerCnpj);
    assert.equal(verifyRepPDetachedCms(signed.signature, pkg.bytes).valid, true);
  });

  it('declares the ICP-Brasil AD-RB policy in the AFD CAdES, pinned to the official policy file', async () => {
    const policyFile = readFileSync(new URL('../../docs/rep-p/referencias/icp-brasil/PA_AD_RB_v2_4.der', import.meta.url));
    assert.equal(createHash('sha256').update(policyFile).digest('hex'), REP_P_CADES_SIGNATURE_POLICY.sha256);
    assert.ok(policyFile.includes(der.oid(REP_P_CADES_SIGNATURE_POLICY.oid)));
    const identity = loadRepPIcpIdentity(credential.pem, developerCnpj, now);
    const signedAttributes = (cms: Buffer) => {
      const signedData = parseDer(cms).children[1].children[0];
      const signerInfo = signedData.children[signedData.children.length - 1].children[0];
      return new Map(signerInfo.children[3].children.map((item) => [decodeOid(item.children[0]), item.children[1].children[0]]));
    };
    const signers = createRepPIcpSigners(identity, () => now);
    const cades = signedAttributes((await signers.cades.signDetached(Buffer.from('afd'))).bytes);
    const policy = cades.get('1.2.840.113549.1.9.16.2.15')!;
    assert.equal(decodeOid(policy.children[0]), REP_P_CADES_SIGNATURE_POLICY.oid);
    assert.equal(policy.children[1].children[1].content.toString('hex'), REP_P_CADES_SIGNATURE_POLICY.sha256);
    assert.equal(policy.children[2].children[0].children[1].content.toString('ascii'), REP_P_CADES_SIGNATURE_POLICY.uri);
    assert.ok(cades.has('1.2.840.113549.1.9.16.2.47') && cades.has('1.2.840.113549.1.9.5'));
    // PAdES segue sem política nem signingTime até a validação no verificador do ITI decidir o formato.
    const padesPdf = (await signers.pades.signPdf(await renderRepPReceiptPdf(snapshot))).bytes.toString('latin1');
    const contents = Buffer.from(/\/Contents <([0-9A-F]+)>/.exec(padesPdf)![1], 'hex');
    const pades = signedAttributes(parseDer(contents).raw);
    assert.equal(pades.has('1.2.840.113549.1.9.16.2.15') || pades.has('1.2.840.113549.1.9.5'), false);
  });

  it('signs the receipt incrementally as PAdES, keeping original bytes and a loadable PDF', async () => {
    const identity = loadRepPIcpIdentity(credential.pem, developerCnpj, now);
    const unsigned = await renderRepPReceiptPdf(snapshot);
    const signed = await signRepPReceipt(snapshot, unsigned, createRepPIcpSigners(identity, () => now).pades);
    assert.ok(signed.bytes.subarray(0, unsigned.length).equals(unsigned));
    assert.deepEqual(verifyRepPSignedPdf(signed.bytes), { valid: true, certificateCnpj: developerCnpj });
    const reloaded = await PDFDocument.load(signed.bytes, { updateMetadata: false });
    assert.equal(reloaded.getPageCount(), 1);
    assert.ok(reloaded.getForm().getFields().some((field) => field.getName() === 'Assinatura REP-P'));
    const tampered = Buffer.from(signed.bytes);
    tampered[200] ^= 0x01;
    assert.equal(verifyRepPSignedPdf(tampered).valid, false);
  });

  it('refuses to sign once the certificate expires', async () => {
    const identity = loadRepPIcpIdentity(credential.pem, developerCnpj, now);
    const signers = createRepPIcpSigners(identity, () => new Date('2031-01-01T00:00:00Z'));
    await assert.rejects(signers.pades.signPdf(await renderRepPReceiptPdf(snapshot)), { code: 'REP_P_ICP_CERTIFICATE_EXPIRED' });
    await assert.rejects(signers.cades.signDetached(Buffer.from('x')), { code: 'REP_P_ICP_CERTIFICATE_EXPIRED' });
  });

  it('records the instant from an asynchronous official clock and waits when it refuses', async () => {
    const identity = loadRepPIcpIdentity(credential.pem, developerCnpj, now);
    const official = new Date('2026-10-18T12:34:56Z');
    const signed = await createRepPIcpSigners(identity, async () => official).pades.signPdf(await renderRepPReceiptPdf(snapshot));
    assert.match(signed.bytes.toString('latin1'), /\/M \(D:20261018123456Z\)/);
    const refusing = createRepPIcpSigners(identity, async () => { throw Object.assign(new Error('hora'), { code: 'REP_P_TIME_UNAVAILABLE' }); });
    await assert.rejects(refusing.pades.signPdf(await renderRepPReceiptPdf(snapshot)), { code: 'REP_P_TIME_UNAVAILABLE' });
    await assert.rejects(refusing.cades.signDetached(Buffer.from('x')), { code: 'REP_P_TIME_UNAVAILABLE' });
  });

  it('reports validity for monitoring, warning 30 days before expiry, without throwing', () => {
    const status = (date: string) => inspectRepPIcpCredential(credential.pem, developerCnpj, new Date(date));
    assert.deepEqual(inspectRepPIcpCredential(undefined, developerCnpj), { state: 'unconfigured' });
    assert.deepEqual(inspectRepPIcpCredential('lixo', developerCnpj), { state: 'invalid', issue: 'REP_P_ICP_KEY_MISSING' });
    assert.equal(inspectRepPIcpCredential(credential.pem, '11222333000181').state, 'invalid');
    const current = status('2026-10-18T00:00:00Z');
    assert.equal(current.state, 'valid');
    assert.ok(current.state === 'valid' && current.notAfter === '2030-01-01T00:00:00.000Z' && current.cnpj === developerCnpj);
    assert.equal(status('2029-12-15T00:00:00Z').state, 'expiring');
    assert.equal(status('2030-02-01T00:00:00Z').state, 'expired');
    assert.equal(status('2025-06-01T00:00:00Z').state, 'not_yet_valid');
  });
});
