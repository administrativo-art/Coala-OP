import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PDFDocument } from 'pdf-lib';

import {
  REP_P_PILOT_RECEIPT_TITLE, renderRepPPilotReceipt, repPPilotReceiptFilename,
  type RepPPilotReceiptSnapshot,
} from '../../src/features/dp/rep-p/pilot-receipt';

const snapshot: RepPPilotReceiptSnapshot = {
  schemaVersion: 2,
  title: REP_P_PILOT_RECEIPT_TITLE,
  sequence: 2,
  markedAt: '2026-10-22T09:15:00-0300',
  hash: 'a'.repeat(64),
  employerName: 'CT Sorvetes LTDA',
  employerCnpj: '14276603000125',
  employeeName: 'Colaboradora Piloto',
  employeeCpf: '52998224725',
  unitName: 'Unidade de Teste',
  workLocation: 'Rua operacional, 10 - São Luís/MA',
  collectorId: '02',
  developerName: 'CT Sorvetes LTDA',
  developerCnpj: '14276603000125',
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
    assert.equal(parsed.getCreator(), 'coala-rep-p-pilot-v2');
  });

  it('recusa instantâneo incompleto ou inconsistente', async () => {
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, employeeName: ' ' }));
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, sequence: 0 }));
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, hash: 'inválido' }));
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, employeeCpf: '11111111111' }));
    await assert.rejects(renderRepPPilotReceipt({ ...snapshot, employerCnpj: '00000000000000' }));
  });

  it('continua capaz de reemitir snapshots antigos sem inventar dados novos', async () => {
    const legacy: RepPPilotReceiptSnapshot = {
      schemaVersion: 1, title: REP_P_PILOT_RECEIPT_TITLE, sequence: 1,
      markedAt: '2026-10-21T08:00:00-0300', hash: 'b'.repeat(64), employeeName: 'Pessoa Piloto',
      unitName: 'Unidade antiga', workLocation: 'Rua antiga, 1', collectorId: '01',
    };
    const rendered = await renderRepPPilotReceipt(legacy);
    const parsed = await PDFDocument.load(rendered.bytes, { updateMetadata: false });
    assert.equal(parsed.getCreator(), 'coala-rep-p-pilot-v1');
  });
});
