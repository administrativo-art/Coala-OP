import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { hashRepPType7 } from '../../src/features/dp/rep-p/core';
import {
  missingRepPReceiptFields, REP_P_RECEIPT_TITLE, renderRepPReceiptPdf, repPReceiptFilename, signRepPReceipt,
  type RepPPadesSigner, type RepPReceiptSnapshot,
} from '../../src/features/dp/rep-p/receipt';

const cpf = '52998224725';
const markedAt = '2026-10-18T08:15:00-0300';
const snapshot: RepPReceiptSnapshot = {
  schemaVersion: 1, title: REP_P_RECEIPT_TITLE, nsr: 3, markedAt,
  hash: hashRepPType7({ nsr: 3, markedAt, employeeCpf: cpf, recordedAt: markedAt, collectorId: '01', mode: '0', previousHash: null }),
  employerLegalName: 'CT Sorvetes LTDA', employerCnpj: '14276603000125', cnoCaepf: null,
  workLocation: 'Rua fiscal, 1 - São Luís/MA', inpiRegistration: '12345678901234567',
  developerCnpj: '14276603000125', employeeName: 'Maria Teste', employeeCpf: cpf, collectorId: '01',
  establishmentId: 'establishment-a', executionUnitId: 'unit-b',
};

/** Simula a atualização incremental de um assinador PAdES real, sem certificado. */
function syntheticSigner(overrides: Partial<{ certificateCnpj: string; tamper: boolean; subFilter: string }> = {}): RepPPadesSigner {
  return {
    async signPdf(content) {
      const original = overrides.tamper ? Buffer.concat([content.subarray(0, 10), Buffer.from('X'), content.subarray(11)]) : content;
      const increment = `\n%synthetic\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${overrides.subFilter ?? 'ETSI.CAdES.detached'}`
        + ' /ByteRange [0 1 2 3] /Contents <00> >>\n%%EOF\n';
      return { bytes: Buffer.concat([original, Buffer.from(increment, 'latin1')]), format: 'PAdES',
        certificateCnpj: overrides.certificateCnpj ?? '14.276.603/0001-25' };
    },
  };
}

describe('Comprovante REP-P', () => {
  it('renders the same bytes for the same snapshot, with metadata frozen at the marking instant', async () => {
    const first = await renderRepPReceiptPdf(snapshot);
    const second = await renderRepPReceiptPdf({ ...snapshot });
    assert.ok(first.equals(second));
    assert.equal(first.subarray(0, 5).toString(), '%PDF-');
    const parsed = await PDFDocument.load(first, { updateMetadata: false });
    assert.equal(parsed.getPageCount(), 1);
    assert.equal(parsed.getTitle(), `${REP_P_RECEIPT_TITLE} - NSR 3`);
    assert.equal(parsed.getCreationDate()?.toISOString(), '2026-10-18T11:15:00.000Z');
    assert.ok(!first.equals(await renderRepPReceiptPdf({ ...snapshot, nsr: 4 })));
    assert.ok(!first.equals(await renderRepPReceiptPdf(snapshot, { preview: true })));
  });

  it('refuses to render while a legal field is missing or the snapshot is inconsistent', async () => {
    assert.deepEqual(missingRepPReceiptFields({ ...snapshot, workLocation: null, inpiRegistration: '' }),
      ['workLocation']);
    assert.ok((await renderRepPReceiptPdf({ ...snapshot, inpiRegistration: '' })).length > 0);
    // Número real do INPI (BR 51 AAAA NNNNNN-D) tem 13 dígitos; só dígitos, até 17 posições.
    assert.deepEqual(missingRepPReceiptFields({ ...snapshot, inpiRegistration: '5120221234567' }), []);
    assert.deepEqual(missingRepPReceiptFields({ ...snapshot, inpiRegistration: 'BR 51 2022 123456-7' }), ['inpiRegistration']);
    assert.ok((await renderRepPReceiptPdf({ ...snapshot, inpiRegistration: '5120221234567' })).length > 0);
    await assert.rejects(renderRepPReceiptPdf({ ...snapshot, workLocation: '  ' }));
    await assert.rejects(renderRepPReceiptPdf({ ...snapshot, hash: 'x' }));
    await assert.rejects(renderRepPReceiptPdf({ ...snapshot, employeeCpf: '11111111111' }));
  });

  it('accepts only an incremental PAdES signature from the developer certificate', async () => {
    const unsigned = await renderRepPReceiptPdf(snapshot);
    const signed = await signRepPReceipt(snapshot, unsigned, syntheticSigner());
    assert.ok(signed.bytes.subarray(0, unsigned.length).equals(unsigned));
    assert.equal(signed.certificateCnpj, '14276603000125');
    assert.equal(signed.filename, repPReceiptFilename(snapshot));
    assert.equal(signed.filename, 'comprovante-ponto-2026-10-18-nsr-3.pdf');
    assert.match(signed.sha256, /^[a-f0-9]{64}$/);
    assert.notEqual(signed.sha256, signed.unsignedSha256);
    await assert.rejects(signRepPReceipt(snapshot, unsigned, syntheticSigner({ certificateCnpj: '11222333000181' })));
    await assert.rejects(signRepPReceipt(snapshot, unsigned, syntheticSigner({ tamper: true })));
    await assert.rejects(signRepPReceipt(snapshot, unsigned, syntheticSigner({ subFilter: 'adbe.pkcs7.detached' })));
    await assert.rejects(signRepPReceipt(snapshot, unsigned, { async signPdf() { throw new Error('unavailable'); } }));
  });
});
