import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PDFDocument } from 'pdf-lib';

import {
  REP_P_PILOT_RECEIPT_TITLE, renderRepPPilotReceipt, repPPilotReceiptFilename,
  type RepPPilotReceiptSnapshot,
} from '../../src/features/dp/rep-p/pilot-receipt';

const snapshot: RepPPilotReceiptSnapshot = {
  schemaVersion: 1,
  title: REP_P_PILOT_RECEIPT_TITLE,
  sequence: 2,
  markedAt: '2026-10-22T09:15:00-0300',
  hash: 'a'.repeat(64),
  employeeName: 'Colaboradora Piloto',
  unitName: 'Unidade de Teste',
  workLocation: 'Rua operacional, 10 - São Luís/MA',
  collectorId: '02',
};

describe('Comprovante de ensaio do ponto', () => {
  it('é determinístico e deliberadamente não se apresenta como comprovante REP-P', async () => {
    const first = await renderRepPPilotReceipt(snapshot);
    const second = await renderRepPPilotReceipt({ ...snapshot });
    assert.ok(first.bytes.equals(second.bytes));
    assert.equal(first.filename, repPPilotReceiptFilename(snapshot));
    assert.equal(first.filename, 'ensaio-ponto-2026-10-22-sequencia-2.pdf');
    assert.match(first.sha256, /^[a-f0-9]{64}$/);
    const parsed = await PDFDocument.load(first.bytes, { updateMetadata: false });
    assert.equal(parsed.getPageCount(), 1);
    assert.equal(parsed.getTitle(), `${REP_P_PILOT_RECEIPT_TITLE} - sequência 2`);
    assert.equal(parsed.getSubject(), 'Ensaio operacional sem validade como comprovante REP-P');
  });

  it('recusa instantâneo incompleto ou inconsistente', async () => {
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, employeeName: ' ' }));
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, sequence: 0 }));
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, hash: 'inválido' }));
  });
});
