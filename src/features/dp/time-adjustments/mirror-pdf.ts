import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { formatCnpj, formatCpf, wrap } from '@/features/dp/rep-p/receipt';

import { hoursText, MIRROR_RENDERER_VERSION, MIRROR_TITLE, type MirrorAgreement, type MirrorSnapshot } from './mirror-core';

const KIND: Record<string, string> = { include: 'Inclusão', discard: 'Desconsideração', correct: 'Correção (desconsidera e inclui)' };
const ADJUSTMENT_STATUS: Record<string, string> = { in_review: 'em análise', approved: 'aprovado', rejected: 'recusado', cancelled: 'cancelado' };
const ABSENCE_STATUS: Record<string, string> = { approved: 'aprovada', rejected: 'recusada', cancelled: 'cancelada', submitted: 'enviada', in_review: 'em análise', adjustments_requested: 'ajustes pedidos' };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dateBR = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
const whenBR = (value: string | null) => value ? `${dateBR(value)} ${value.slice(11, 16)}` : '-';
/** Fontes padrão do PDF só codificam WinAnsi: emoji ou outro símbolo digitado num motivo viraria erro de geração. */
export const pdfSafe = (value: string) => value.normalize('NFC').replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/gu, '?');
export const mirrorFileName = (snapshot: MirrorSnapshot) => `espelho-ponto-${snapshot.competence}-v${snapshot.closureVersion}.pdf`;

/**
 * Espelho de ponto do mês fechado, derivado só do instantâneo gravado. O bloco final diz se a pessoa concordou
 * (com instante e carimbo do instantâneo) ou se a concordância está pendente; divergência é tratada com o DP.
 */
export async function renderMirrorPdf(snapshot: MirrorSnapshot, snapshotHash: string, agreement: MirrorAgreement | null, options: { preview?: boolean } = {}): Promise<Buffer> {
  const document = await PDFDocument.create({ updateMetadata: false });
  const created = new Date(Date.parse(snapshot.generatedAt));
  document.setTitle(`${MIRROR_TITLE} - ${snapshot.competence} - versão ${snapshot.closureVersion}`);
  document.setSubject(`Instantâneo SHA-256 ${snapshotHash}`);
  document.setCreator(MIRROR_RENDERER_VERSION);
  document.setProducer(MIRROR_RENDERER_VERSION);
  document.setCreationDate(created);
  document.setModificationDate(created);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const mono = await document.embedFont(StandardFonts.Courier);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.38, 0.38, 0.42);
  const margin = 36;
  const pages: PDFPage[] = [];
  let page = document.addPage([595.28, 841.89]);
  pages.push(page);
  const width = page.getWidth() - margin * 2;
  let y = page.getHeight() - margin;
  const ensure = (height: number) => {
    if (y - height >= margin + 24) return;
    page = document.addPage([595.28, 841.89]);
    pages.push(page);
    y = page.getHeight() - margin;
  };
  const text = (raw: string, x: number, size: number, font: PDFFont = regular, color = ink, maxWidth = width - (x - margin)) => {
    const lines = wrap(pdfSafe(raw), font, size, maxWidth);
    lines.forEach((line, index) => page.drawText(line, { x, y: y - size - index * (size + 2), size, font, color }));
    return lines.length * (size + 2);
  };
  const paragraph = (value: string, size = 9, font: PDFFont = regular, color = ink) => {
    const lines = wrap(pdfSafe(value), font, size, width);
    ensure(lines.length * (size + 2));
    y -= text(value, margin, size, font, color) + 3;
  };
  const [year, month] = snapshot.competence.split('-').map(Number);

  y -= text(MIRROR_TITLE, margin, 16, bold) + 2;
  y -= text(`Competência: ${MONTHS[month - 1]} de ${year} · versão ${snapshot.closureVersion} do fechamento`, margin, 10, regular, muted) + 8;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.6, color: muted });
  y -= 10;
  paragraph(`Empregador: ${snapshot.employer.legalName ?? 'não informado'}${snapshot.employer.cnpj ? ` · CNPJ ${formatCnpj(snapshot.employer.cnpj)}` : ''}`);
  paragraph(`Trabalhador: ${snapshot.employee.name}${snapshot.employee.cpf ? ` · CPF ${formatCpf(snapshot.employee.cpf)}` : ''}`);
  paragraph(`Batidas originais do REP-P com o NSR; (D) desconsiderada por ajuste aprovado, (I) incluída por ajuste aprovado. A batida original nunca é apagada. Lidas do REP-P em ${whenBR(snapshot.arpReading.readAt)}: ${snapshot.arpReading.count} batidas${snapshot.arpReading.maxNsr ? `, maior NSR ${snapshot.arpReading.maxNsr}` : ''}.`, 7.5, regular, muted);
  paragraph('A coluna "Soma (conferência)" soma os intervalos entre pares de batidas: não é apuração, saldo nem banco de horas.', 8, bold);
  if (snapshot.truncated) paragraph('Atenção: o mês tem mais batidas do que este espelho comporta; fale com o DP.', 8, bold);
  y -= 4;

  const columns = [margin, margin + 62, margin + 170, margin + 400, margin + 455];
  const header = () => {
    ensure(18);
    ['Dia', 'Escala', 'Batidas', 'Soma (conf.)', 'Ausência'].forEach((label, index) => page.drawText(label.toUpperCase(), { x: columns[index], y: y - 7, size: 7, font: bold, color: muted }));
    y -= 12;
  };
  header();
  for (const day of snapshot.days) {
    const date = new Date(`${day.date}T12:00:00Z`);
    const punches = day.punches.map((item) => `${item.time}${item.mark === 'discarded' ? ' (D)' : item.mark === 'included' ? ' (I)' : ''}${item.nsr ? ` #${item.nsr}` : ''}`).join('  ') || '-';
    const heights = [wrap(pdfSafe(day.shift ?? '-'), regular, 8, 100).length, wrap(punches, regular, 8, 222).length, wrap(pdfSafe(day.absences.join('; ')), regular, 8, width - 455 + margin).length];
    const height = Math.max(1, ...heights) * 10 + 4;
    if (y - height < margin + 24) { ensure(height + 20); header(); }
    text(`${dateBR(day.date).slice(0, 5)} ${WEEKDAYS[date.getUTCDay()]}`, columns[0], 8, bold, ink, 60);
    text(day.shift ?? '-', columns[1], 8, regular, ink, 100);
    text(punches, columns[2], 8, regular, ink, 222);
    text(hoursText(day.pairedMinutes), columns[3], 8, regular, ink, 50);
    if (day.absences.length) text(day.absences.join('; '), columns[4], 8, regular, ink, width - 455 + margin);
    y -= height;
    page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: margin + width, y: y + 2 }, thickness: 0.2, color: muted });
  }
  if (!snapshot.days.length) paragraph('Nenhum dia com escala, batida ou ausência neste mês.');

  y -= 8;
  paragraph('Declaração do fechamento', 11, bold);
  const actor = (uid: string | null) => uid ? snapshot.actors[uid] ?? `usuário ${uid.slice(0, 8)}` : '-';
  paragraph('Ajustes de ponto (todos, inclusive recusados e cancelados)', 9, bold);
  if (!snapshot.adjustments.length) paragraph('Nenhum pedido de ajuste no mês.', 8.5);
  for (const item of snapshot.adjustments) {
    const change = `${item.original ? `original ${item.original.markedAt.slice(11, 16)} (NSR ${item.original.nsr})` : 'sem batida original'}${item.inclusion ? `, incluída ${item.inclusion.markedAt.slice(11, 16)}` : ''}`;
    paragraph(`${dateBR(item.workDate)} · ${KIND[item.kind]} · ${ADJUSTMENT_STATUS[item.status]} · ${change}. Pedido por ${actor(item.requestedBy)} em ${whenBR(item.requestedAt)}: ${item.reason}${item.decidedBy ? ` Decidido por ${actor(item.decidedBy)} em ${whenBR(item.decidedAt)}${item.decisionReason ? `: ${item.decisionReason}` : ''}.` : ''}`, 8.5);
  }
  paragraph('Ausências (sem motivo nem anexo)', 9, bold);
  if (!snapshot.absences.length) paragraph('Nenhuma ausência no mês.', 8.5);
  for (const item of snapshot.absences) {
    paragraph(`${item.typeName} · ${item.startDate === item.endDate ? dateBR(item.startDate) : `${dateBR(item.startDate)} a ${dateBR(item.endDate)}`}${item.startTime && item.endTime ? ` ${item.startTime}-${item.endTime}` : ''} · ${item.quantity} ${item.unit === 'hour' ? 'h' : item.quantity === 1 ? 'dia' : 'dias'} · ${ABSENCE_STATUS[item.status] ?? item.status}${item.approval === 'tacit_timeout' ? ' por decurso de prazo' : item.approval === 'review' ? ' por análise' : ''}${item.decidedBy ? ` · decidido por ${actor(item.decidedBy)} em ${whenBR(item.decidedAt)}` : ''}.`, 8.5);
  }

  y -= 8;
  paragraph('Concordância do trabalhador', 11, bold);
  paragraph(agreement
    ? `Concordo com este espelho. Registrado eletronicamente por ${snapshot.employee.name} em ${whenBR(agreement.at)} (${agreement.clockSource === 'hora_legal' ? 'Hora Legal' : 'relógio do servidor'}, ${agreement.channel === 'mobile' ? 'pelo Coala Go com atestação do aplicativo' : 'pelo sistema web'}), sobre o instantâneo ${agreement.snapshotHash}.`
    : 'Pendente. Sem a concordância registrada, eventual divergência é tratada diretamente com o Departamento Pessoal.', 9, agreement ? regular : bold);

  const footer = options.preview ? 'Prévia do modelo com dados fictícios - sem validade.'
    : `Fechamento v${snapshot.closureVersion} · declaração ${snapshot.manifestHash.slice(0, 16)} · instantâneo ${snapshotHash.slice(0, 16)} · gerado em ${whenBR(snapshot.generatedAt)} (${snapshot.clockSource === 'hora_legal' ? 'Hora Legal' : 'relógio do servidor'}) · ${MIRROR_RENDERER_VERSION}`;
  pages.forEach((item, index) => {
    item.drawText(footer, { x: margin, y: margin - 8, size: 6.5, font: mono, color: muted });
    item.drawText(`${index + 1}/${pages.length}`, { x: margin + width - 20, y: margin - 8, size: 6.5, font: regular, color: muted });
  });
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
