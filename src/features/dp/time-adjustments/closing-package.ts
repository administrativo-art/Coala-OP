import { createHash } from 'node:crypto';

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import { wrap } from '@/features/dp/rep-p/receipt';

import { pdfSafe } from './mirror-pdf';

/**
 * Termo da última página, onde fica a assinatura: recebimento e ciência, nunca quitação (CLT art. 9º), e aceitação do
 * meio eletrônico (MP 2.200-2, art. 10 §2º). Divergência pode ser apresentada ao DP a qualquer tempo.
 */
export function closingTermText(input: { name: string; month: string }) {
  return [
    `Eu, ${input.name}, declaro que recebi o espelho de ponto e o contracheque de ${input.month} que compõem este documento.`,
    'Esta assinatura confirma o recebimento e a ciência do conteúdo. Ela não é quitação nem renúncia a horas, verbas ou direitos, e eventual divergência pode ser apresentada ao Departamento Pessoal a qualquer tempo, inclusive depois de assinar.',
    'Aceito a assinatura eletrônica deste documento pela plataforma Autentique, com o registro de data, hora, e-mail e endereço IP feito por ela. A empresa assina o pacote com o certificado digital (e-CNPJ) em arquivo separado, guardado com este documento.',
  ];
}

/**
 * Pacote do fechamento do mês (decisão do programador, 20/10/2026): espelho de ponto e contracheque num único PDF,
 * assinado pelo trabalhador na Autentique. As páginas são copiadas sem alteração; a empresa assina o pacote com o e-CNPJ
 * em arquivo destacado (.p7s), porque a Autentique acrescenta páginas e quebraria uma assinatura embutida.
 */
export async function composeClosingPackage(input: { mirror: Uint8Array; payslip: Uint8Array; title: string; name: string; month: string }) {
  const output = await PDFDocument.create({ updateMetadata: false });
  output.setTitle(input.title);
  output.setProducer('Coala One - pacote do fechamento');
  output.setCreator('Coala One - pacote do fechamento');
  const pages: Record<'mirror' | 'payslip', number> = { mirror: 0, payslip: 0 };
  for (const [part, bytes] of [['mirror', input.mirror], ['payslip', input.payslip]] as const) {
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    const copied = await output.copyPages(source, source.getPageIndices());
    copied.forEach((page) => output.addPage(page));
    pages[part] = copied.length;
  }
  const term = output.addPage([595.28, 841.89]);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  let y = 841.89 - 72;
  term.drawText(pdfSafe('Termo de recebimento e ciência'), { x: 56, y, size: 14, font: bold, color: rgb(0.1, 0.1, 0.12) });
  y -= 28;
  for (const paragraph of closingTermText({ name: input.name, month: input.month })) {
    for (const line of wrap(pdfSafe(paragraph), regular, 10.5, 595.28 - 112)) { term.drawText(line, { x: 56, y, size: 10.5, font: regular, color: rgb(0.1, 0.1, 0.12) }); y -= 15; }
    y -= 10;
  }
  const bytes = Buffer.from(await output.save({ useObjectStreams: false }));
  // A assinatura do trabalhador fica no termo (última página), sem cobrir o contracheque.
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), pages, pageCount: pages.mirror + pages.payslip + 1 };
}

export const closingPackagePath = (workspaceId: string, competence: string, version: number, uid: string) =>
  `time-closing-packages/${workspaceId}/${competence}/v${version}/${uid}`;
