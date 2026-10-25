import { createHash } from 'node:crypto';

const UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;

type ZipEntry = Readonly<{ name: string; bytes: Buffer }>;

export type RepPReceiptArchiveItem = Readonly<{
  receiptId: string;
  workDate: string;
  nsr: number;
  markedAt: string;
  status: 'issued' | 'pending';
  issue: string | null;
  filename?: string | null;
  pdf?: Uint8Array | null;
  sha256?: string | null;
}>;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertZipName(name: string) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
    throw new TypeError('Nome incompatível com o arquivo ZIP.');
  }
  const bytes = Buffer.from(name, 'utf8');
  if (bytes.byteLength > 0xffff) throw new TypeError('Nome incompatível com o arquivo ZIP.');
  return bytes;
}

/** ZIP sem compressão: preserva exatamente os bytes assinados de cada PDF e evita dependência externa. */
export function createStoredZip(entries: readonly ZipEntry[]) {
  let offset = 0;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  for (const entry of entries) {
    const name = assertZipName(entry.name);
    const size = entry.bytes.byteLength;
    const checksum = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12); // 01/01/1980: metadado fixo para o arquivo ser reproduzível.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.byteLength + name.byteLength + size;
  }
  if (entries.length > 0xffff) throw new RangeError('Entradas demais no arquivo ZIP.');
  const centralOffset = offset;
  const centralSize = centrals.reduce((total, part) => total + part.byteLength, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

function safePdfName(receipt: RepPReceiptArchiveItem) {
  const original = receipt.filename?.trim();
  return original && /^[A-Za-z0-9._-]+\.pdf$/i.test(original)
    ? original : `comprovante-ponto-${receipt.workDate}-nsr-${receipt.nsr}.pdf`;
}

/** Monta o pacote pessoal e sinaliza expressamente quando há comprovantes ainda não emitidos. */
export function buildRepPReceiptArchive(input: {
  startDate: string;
  endDate: string;
  generatedAt: string;
  receipts: readonly RepPReceiptArchiveItem[];
}) {
  const indexItems: Array<Record<string, unknown>> = [];
  const pdfs: ZipEntry[] = [];
  let pdfBytes = 0;
  for (const receipt of [...input.receipts].sort((left, right) => left.markedAt.localeCompare(right.markedAt) || left.nsr - right.nsr)) {
    if (receipt.status !== 'issued') {
      indexItems.push({ receiptId: receipt.receiptId, workDate: receipt.workDate, nsr: receipt.nsr,
        markedAt: receipt.markedAt, status: 'pending', issue: receipt.issue });
      continue;
    }
    if (!receipt.pdf || !receipt.sha256 || !/^[a-f0-9]{64}$/.test(receipt.sha256)) {
      throw new TypeError('Comprovante emitido sem conteúdo íntegro.');
    }
    const bytes = Buffer.from(receipt.pdf);
    const calculated = createHash('sha256').update(bytes).digest('hex');
    if (calculated !== receipt.sha256) throw new TypeError('Comprovante emitido com hash divergente.');
    const filename = safePdfName(receipt);
    const path = `comprovantes/${receipt.receiptId}/${filename}`;
    pdfBytes += bytes.byteLength;
    if (pdfBytes > MAX_ARCHIVE_BYTES) throw new RangeError('Pacote de comprovantes excede o limite seguro.');
    pdfs.push({ name: path, bytes });
    indexItems.push({ receiptId: receipt.receiptId, workDate: receipt.workDate, nsr: receipt.nsr,
      markedAt: receipt.markedAt, status: 'available', filename: path, sha256: receipt.sha256 });
  }
  const unavailable = indexItems.filter((item) => item.status !== 'available').length;
  const complete = unavailable === 0;
  const index = {
    schemaVersion: 1,
    title: 'Índice de comprovantes de registro de ponto',
    period: { startDate: input.startDate, endDate: input.endDate },
    generatedAt: input.generatedAt,
    complete,
    summary: { total: indexItems.length, exported: pdfs.length, unavailable },
    notice: complete
      ? 'Todos os comprovantes do período foram incluídos com os bytes originais assinados.'
      : 'Pacote incompleto: os itens pendentes não foram substituídos nem omitidos do índice.',
    receipts: indexItems,
  };
  const entries: ZipEntry[] = [
    { name: 'indice-comprovantes.json', bytes: Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8') },
    ...pdfs,
  ];
  const bytes = createStoredZip(entries);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new RangeError('Pacote de comprovantes excede o limite seguro.');
  const state = complete ? 'completo' : 'incompleto';
  return { bytes, complete, total: indexItems.length, exported: pdfs.length, unavailable,
    filename: `comprovantes-ponto-${input.startDate}-a-${input.endDate}-${state}.zip`,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}
