import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { buildMirrorSnapshot, hoursText, MIRROR_PREVIEW_SNAPSHOT, mirrorIncompleteReason, mirrorSnapshotHash, pairedMinutes } from '../../src/features/dp/time-adjustments/mirror-core';
import { closingPackagePath, closingTermText, composeClosingPackage } from '../../src/features/dp/time-adjustments/closing-package';
import { pdfSafe, renderMirrorPdf } from '../../src/features/dp/time-adjustments/mirror-pdf';

const at = (date: string, time: string) => `${date}T${time}:00-0300`;
test('soma entre pares por instante: ímpar fica sem soma, virada de dia conta', () => {
  assert.equal(pairedMinutes([at('2026-01-05', '08:00'), at('2026-01-05', '12:00'), at('2026-01-05', '13:00'), at('2026-01-05', '16:00')]), 420);
  assert.equal(pairedMinutes([at('2026-01-05', '08:00'), at('2026-01-05', '12:00'), at('2026-01-05', '13:00')]), null);
  assert.equal(pairedMinutes([at('2026-01-05', '22:00'), at('2026-01-06', '02:00')]), 240);
  assert.equal(pairedMinutes([]), 0);
  assert.equal(hoursText(420), '07:00');
  assert.equal(hoursText(null), 'sem soma (ímpar)');
});

test('turno noturno: batidas do mesmo dia de trabalho ficam na ordem dos instantes', () => {
  const night = buildMirrorSnapshot({ ...MIRROR_PREVIEW_INPUT(), markings: [
    { workDate: '2026-01-05', nsr: 2, markedAt: at('2026-01-06', '02:00') }, { workDate: '2026-01-05', nsr: 1, markedAt: at('2026-01-05', '22:00') }] });
  assert.deepEqual(night.days[0].punches.map((item) => item.time), ['22:00', '02:00']);
  assert.equal(night.days[0].pairedMinutes, 240);
  assert.deepEqual(night.arpReading, { count: 2, maxNsr: 2, readAt: '2026-02-02T12:00:00.000Z' });
});

test('espelho incompleto não vai para assinatura', () => {
  assert.equal(mirrorIncompleteReason(MIRROR_PREVIEW_SNAPSHOT), null);
  assert.match(mirrorIncompleteReason({ ...MIRROR_PREVIEW_SNAPSHOT, truncated: true })!, /não comporta/);
  assert.match(mirrorIncompleteReason({ ...MIRROR_PREVIEW_SNAPSHOT, employee: { ...MIRROR_PREVIEW_SNAPSHOT.employee, cpf: null } })!, /identificação/);
});

test('espelho mantém a original desconsiderada marcada, acrescenta a incluída e a ausência aprovada', () => {
  const day = MIRROR_PREVIEW_SNAPSHOT.days.find((item) => item.date === '2026-01-05')!;
  assert.deepEqual(day.punches.map((item) => `${item.time}:${item.mark}`), ['08:02:original', '12:00:original', '12:01:discarded', '13:00:original', '16:03:original']);
  assert.equal(day.pairedMinutes, 3 * 60 + 58 + 3 * 60 + 3);
  assert.deepEqual(MIRROR_PREVIEW_SNAPSHOT.days.find((item) => item.date === '2026-01-06')!.absences, ['Atestado (aprovada por decurso de prazo)']);
  assert.equal(MIRROR_PREVIEW_SNAPSHOT.days.find((item) => item.date === '2026-01-11')!.shift, 'Folga');
  // Dias sem escala, batida nem ausência ficam fora.
  assert.equal(MIRROR_PREVIEW_SNAPSHOT.days.some((item) => item.date === '2026-01-20'), false);
  const included = buildMirrorSnapshot({ ...MIRROR_PREVIEW_INPUT(), declaration: { uid: 'p', name: 'P', absences: [], adjustments: [{ id: 'i', workDate: '2026-01-05', kind: 'include', status: 'approved',
    original: null, inclusion: { markedAt: '2026-01-05T17:00:00-0300' }, reason: 'Esqueci de bater a saída.', requestedBy: 'p', requestedAt: 'x', decidedBy: 'dp', decidedAt: 'y', decisionReason: null }] } });
  assert.equal(included.days[0].punches.at(-1)!.mark, 'included');
  assert.equal(mirrorSnapshotHash(MIRROR_PREVIEW_SNAPSHOT), mirrorSnapshotHash(structuredClone(MIRROR_PREVIEW_SNAPSHOT)));
});
function MIRROR_PREVIEW_INPUT() {
  return { workspaceId: 'w', competence: '2026-01', closureVersion: 1, manifestHash: 'h', generatedAt: '2026-02-02T12:00:00.000Z', clockSource: 'server' as const,
    employee: { uid: 'p', name: 'P', cpf: null }, employer: { legalName: null, cnpj: null }, markings: [{ workDate: '2026-01-05', nsr: 1, markedAt: '2026-01-05T08:00:00-0300' }],
    shifts: [], declaration: null, truncated: false, actors: {} };
}

test('PDF sai com o bloco de assinaturas (ou a concordância antiga), mesmo com emoji no motivo', async () => {
  const snapshot = structuredClone(MIRROR_PREVIEW_SNAPSHOT);
  snapshot.adjustments[0].reason = 'Bati duas vezes 😅 na saída → intervalo';
  const pending = await renderMirrorPdf(snapshot, 'a'.repeat(64), null);
  const agreed = await renderMirrorPdf(snapshot, 'a'.repeat(64), { at: '2026-02-03T10:00:00.000Z', clockSource: 'hora_legal', uid: 'preview', snapshotHash: 'a'.repeat(64), channel: 'mobile' });
  assert.ok((await PDFDocument.load(pending)).getPageCount() >= 1);
  assert.notEqual(Buffer.compare(pending, agreed), 0);
  assert.equal(pdfSafe('ok 😅 → ç'), 'ok ? ? ç');
});

test('pacote do fechamento junta espelho e contracheque sem alterar as páginas', async () => {
  const mirror = await renderMirrorPdf(MIRROR_PREVIEW_SNAPSHOT, 'a'.repeat(64), null);
  const payslipDoc = await PDFDocument.create();
  payslipDoc.addPage([595, 842]);
  const payslip = Buffer.from(await payslipDoc.save());
  const bundle = await composeClosingPackage({ mirror, payslip, title: 'Espelho e contracheque', name: 'Maria', month: 'agosto de 2026' });
  const mirrorPages = (await PDFDocument.load(mirror)).getPageCount();
  assert.deepEqual(bundle.pages, { mirror: mirrorPages, payslip: 1 });
  // Última página: termo de recebimento e ciência, onde fica a assinatura.
  assert.equal((await PDFDocument.load(bundle.bytes)).getPageCount(), mirrorPages + 2);
  assert.equal(bundle.pageCount, mirrorPages + 2);
  assert.match(closingTermText({ name: 'Maria', month: 'agosto de 2026' }).join(' '), /não é quitação/);
  assert.match(bundle.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(composeClosingPackage({ mirror, payslip: Buffer.from('não é pdf'), title: 'x', name: 'M', month: 'm' }));
  assert.equal(closingPackagePath('ws', '2026-08', 2, 'u'), 'time-closing-packages/ws/2026-08/v2/u');
});

test('prazo de 24 horas da assinatura do pacote: recusado ou enviado há mais de 24 horas está atrasado', async () => {
  const { isOverdue } = await import('../../src/features/dp/time-adjustments/closing-package');
  const now = new Date('2026-10-20T12:00:00.000Z');
  assert.equal(isOverdue({ status: 'sent', sentAt: '2026-10-19T11:59:00.000Z' }, now), true);
  assert.equal(isOverdue({ status: 'sent', sentAt: '2026-10-19T12:01:00.000Z' }, now), false);
  assert.equal(isOverdue({ status: 'refused', sentAt: '2026-10-20T11:00:00.000Z' }, now), true);
  assert.equal(isOverdue({ status: 'signed', sentAt: '2026-10-01T00:00:00.000Z' }, now), false);
});
