import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { generateRepPAfd, signRepPAfd } from '../../src/features/dp/rep-p/afd';
import { hashRepPType7 } from '../../src/features/dp/rep-p/core';
import {
  buildRepPDetachedCms, createRepPIcpSigners, inspectRepPIcpCredential, loadRepPIcpIdentity, verifyRepPDetachedCms, verifyRepPSignedPdf,
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
