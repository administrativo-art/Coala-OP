import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRepPHomologationSamples, REP_P_SAMPLE_EMPLOYER } from '../../src/features/dp/rep-p/homologation-samples';
import { loadRepPIcpIdentity, verifyRepPDetachedCms, verifyRepPSignedPdf } from '../../src/features/dp/rep-p/icp-signer';
import { createTestIcpCredential } from '../helpers/rep-p-test-certificate';

describe('Amostras de homologação do REP-P', () => {
  it('signs a fictitious AFD (CAdES) and receipt (PAdES) that verify and are clearly marked as samples', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const identity = loadRepPIcpIdentity(createTestIcpCredential().pem, '14276603000125', now);
    const samples = await buildRepPHomologationSamples(identity, { developerCnpj: '14276603000125', instant: '2026-10-18T09:00:00-0300', now });
    const afdText = samples.afd.bytes.toString('latin1');
    assert.ok(afdText.includes(REP_P_SAMPLE_EMPLOYER.legalName));
    assert.ok(afdText.includes(REP_P_SAMPLE_EMPLOYER.cnpj));
    assert.match(samples.afd.filename, /^AMOSTRA_AFD/);
    assert.equal(samples.afd.signatureFilename, `${samples.afd.filename}.p7s`);
    assert.equal(verifyRepPDetachedCms(samples.afd.signature, samples.afd.bytes).valid, true);
    assert.deepEqual(verifyRepPSignedPdf(samples.receipt.bytes), { valid: true, certificateCnpj: '14276603000125' });
    assert.match(samples.receipt.filename, /^AMOSTRA_comprovante-ponto-2026-10-18-nsr-3\.pdf$/);
  });
});
