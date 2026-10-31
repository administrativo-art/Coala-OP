import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { crc16Kermit, generateRepPAfd, serializeRepPAfdEvent, signRepPAfd, type RepPAfdEvent } from '../../src/features/dp/rep-p/afd';
import { hashRepPType7 } from '../../src/features/dp/rep-p/core';

const establishmentId = 'establishment-a';
const cpf = '52998224725';
const profile = { establishmentId, employerCnpj: '14276603000125', employerLegalName: 'CT Sorvetes LTDA',
  inpiRegistration: '12345678901234567', developerCnpj: '14276603000125' };
const marking = (() => {
  const value = { recordType: '7' as const, nsr: 3, establishmentId,
    markedAt: '2026-10-18T08:15:00-0300', employeeCpf: cpf,
    recordedAt: '2026-10-18T08:15:00-0300', collectorId: '01' as const, mode: '0' as const,
    previousHash: null };
  return { ...value, hash: hashRepPType7(value) };
})();
const events: RepPAfdEvent[] = [
  { recordType: '2', nsr: 1, establishmentId, recordedAt: '2026-10-18T07:00:00-0300', responsibleCpf: cpf,
    employerCnpj: profile.employerCnpj, employerLegalName: profile.employerLegalName, workLocation: 'Rua de teste, 1' },
  { recordType: '5', nsr: 2, establishmentId, recordedAt: '2026-10-18T07:01:00-0300', operation: 'I',
    employeeCpf: cpf, employeeName: 'Maria Teste', responsibleCpf: cpf },
  marking,
  { recordType: '6', nsr: 4, establishmentId, recordedAt: '2026-10-18T09:00:00-0300', eventCode: '07' },
];

describe('AFD 004 REP-P', () => {
  it('implements the official CRC-16/KERMIT check vector', () => {
    assert.equal(crc16Kermit('123456789'), '2189');
  });

  it('serializes fixed-length event records and validates the type 7 hash', () => {
    assert.equal(serializeRepPAfdEvent(events[0]).length, 331);
    assert.equal(serializeRepPAfdEvent(events[1]).length, 118);
    assert.equal(serializeRepPAfdEvent(events[2]).length, 137);
    assert.equal(serializeRepPAfdEvent(events[3]).length, 36);
    assert.throws(() => serializeRepPAfdEvent({ ...marking, hash: '0'.repeat(64) }));
  });

  it('generates a latin1 CRLF file with header, trailer, signature marker and exact counts', () => {
    const result = generateRepPAfd({ profile, startDate: '2026-10-18', endDate: '2026-10-18',
      generatedAt: '2026-10-18T10:00:00-0300', events });
    const lines = result.bytes.toString('latin1').split('\r\n');
    assert.equal(lines.at(-1), '');
    assert.equal(lines[0].length, 302);
    assert.equal(lines.at(-3)?.length, 64);
    assert.equal(lines.at(-2)?.length, 100);
    assert.equal(result.lineCount, 7);
    assert.deepEqual(result.counts, { '2': 1, '3': 0, '4': 0, '5': 1, '6': 1, '7': 1 });
    assert.equal(result.filename, 'AFD1234567890123456714276603000125REP_P.txt');
    assert.equal(result.signatureFilename, `${result.filename}.p7s`);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => generateRepPAfd({ profile, startDate: '2026-02-30', endDate: '2026-03-01',
      generatedAt: '2026-10-18T10:00:00-0300', events: [] }));
  });

  it('preserva campo INPI vazio sem fabricar identificador no AFD', () => {
    const result = generateRepPAfd({ profile: { ...profile, inpiRegistration: '' },
      startDate: '2026-10-18', endDate: '2026-10-18', generatedAt: '2026-10-18T10:00:00-0300', events });
    assert.equal(result.filename, 'AFD14276603000125REP_P.txt');
    assert.equal(result.bytes.toString('latin1').split('\r\n')[0].length, 302);
    assert.ok(!result.bytes.toString('latin1').includes('00000000000000000'));
  });

  it('accepts only a detached CAdES result for the configured developer CNPJ', async () => {
    const pkg = generateRepPAfd({ profile, startDate: '2026-10-18', endDate: '2026-10-18',
      generatedAt: '2026-10-18T10:00:00-0300', events });
    const signed = await signRepPAfd(pkg, { async signDetached() {
      return { bytes: Buffer.from('synthetic-signature'), format: 'CAdES', detached: true,
        certificateCnpj: '14.276.603/0001-25' };
    } }, profile.developerCnpj);
    assert.equal(signed.signature.toString(), 'synthetic-signature');
    await assert.rejects(signRepPAfd(pkg, { async signDetached() {
      return { bytes: Buffer.from('x'), format: 'CAdES', detached: true, certificateCnpj: '11222333000181' };
    } }, profile.developerCnpj));
  });
});
