import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { buildRepPReceiptArchive, createStoredZip } from '../../src/features/dp/rep-p/receipt-archive';

function localEntries(zip: Buffer) {
  const result = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameSize = zip.readUInt16LE(offset + 26);
    const extraSize = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameSize + extraSize;
    result.set(zip.subarray(nameStart, nameStart + nameSize).toString('utf8'), zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  return result;
}

describe('pacote de comprovantes REP-P', () => {
  it('preserva os bytes originais e produz ZIP reproduzível com índice completo', () => {
    const pdf = Buffer.from('%PDF-1.7\ncomprovante assinado\n%%EOF');
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const input = { startDate: '2026-10-01', endDate: '2026-10-31', generatedAt: '2026-11-01T12:00:00.000Z', receipts: [{
      receiptId: `${'a'.repeat(64)}_000000003`, workDate: '2026-10-18', nsr: 3,
      markedAt: '2026-10-18T08:15:00-0300', status: 'issued' as const, issue: null,
      filename: 'comprovante-ponto-2026-10-18-nsr-3.pdf', pdf, sha256,
    }] };
    const first = buildRepPReceiptArchive(input);
    const second = buildRepPReceiptArchive(input);
    assert.ok(first.bytes.equals(second.bytes));
    assert.equal(first.complete, true);
    assert.match(first.filename, /-completo\.zip$/);
    const entries = localEntries(first.bytes);
    assert.equal(entries.size, 2);
    assert.ok([...entries.values()].some((bytes) => bytes.equals(pdf)));
    const index = JSON.parse(entries.get('indice-comprovantes.json')!.toString('utf8'));
    assert.deepEqual(index.summary, { total: 1, exported: 1, unavailable: 0 });
    assert.equal(index.receipts[0].sha256, sha256);
  });

  it('nomeia pacote parcial como incompleto e não inventa PDF para item pendente', () => {
    const result = buildRepPReceiptArchive({ startDate: '2026-10-01', endDate: '2026-10-31',
      generatedAt: '2026-11-01T12:00:00.000Z', receipts: [{ receiptId: `${'b'.repeat(64)}_000000004`,
        workDate: '2026-10-18', nsr: 4, markedAt: '2026-10-18T12:00:00-0300', status: 'pending', issue: 'REP_P_PADES_UNAVAILABLE' }] });
    assert.equal(result.complete, false);
    assert.match(result.filename, /-incompleto\.zip$/);
    const entries = localEntries(result.bytes);
    assert.deepEqual([...entries.keys()], ['indice-comprovantes.json']);
    const index = JSON.parse(entries.get('indice-comprovantes.json')!.toString('utf8'));
    assert.equal(index.complete, false);
    assert.deepEqual(index.summary, { total: 1, exported: 0, unavailable: 1 });
  });

  it('recusa hash divergente e caminhos inseguros', () => {
    assert.throws(() => buildRepPReceiptArchive({ startDate: '2026-10-01', endDate: '2026-10-31', generatedAt: '2026-11-01T12:00:00.000Z', receipts: [{
      receiptId: 'receipt', workDate: '2026-10-18', nsr: 4, markedAt: '2026-10-18T12:00:00-0300', status: 'issued', issue: null,
      filename: 'receipt.pdf', pdf: Buffer.from('x'), sha256: '0'.repeat(64),
    }] }), /hash divergente/);
    assert.throws(() => createStoredZip([{ name: '../segredo', bytes: Buffer.from('x') }]), /Nome incompatível/);
  });
});
