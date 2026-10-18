/**
 * DER mínimo para montar e ler as estruturas CMS/X.509 da assinatura REP-P.
 * Cobre só formas definidas (DER), tags de um byte e os tipos usados aqui.
 */

export type DerNode = Readonly<{
  tag: number;
  /** Bytes completos do nó (cabeçalho + conteúdo), úteis para copiar Name/certificado sem reencode. */
  raw: Buffer;
  content: Buffer;
  children: readonly DerNode[];
}>;

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), encodeLength(body.length), body]);
}

export const der = Object.freeze({
  sequence: (...items: Buffer[]) => tlv(0x30, ...items),
  set: (...items: Buffer[]) => tlv(0x31, ...[...items].sort(Buffer.compare)),
  /** SET OF com ordem preservada, para quando o chamador já garante a ordenação canônica. */
  setOrdered: (...items: Buffer[]) => tlv(0x31, ...items),
  integer(value: number | Buffer): Buffer {
    const hex = typeof value === 'number' ? value.toString(16) : '';
    let bytes = typeof value === 'number' ? Buffer.from(hex.length % 2 ? `0${hex}` : hex, 'hex') : value;
    while (bytes.length > 1 && bytes[0] === 0 && bytes[1] < 0x80) bytes = bytes.subarray(1);
    if (bytes[0] >= 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return tlv(0x02, bytes);
  },
  null: () => Buffer.from([0x05, 0x00]),
  octetString: (value: Buffer) => tlv(0x04, value),
  oid(value: string): Buffer {
    const [first, second, ...rest] = value.split('.').map(Number);
    const bytes = [first * 40 + second];
    for (const arc of rest) {
      const chunk = [arc & 0x7f];
      for (let remaining = Math.floor(arc / 128); remaining > 0; remaining = Math.floor(remaining / 128)) chunk.unshift((remaining & 0x7f) | 0x80);
      bytes.push(...chunk);
    }
    return tlv(0x06, Buffer.from(bytes));
  },
  utcTime(date: Date): Buffer {
    const iso = date.toISOString();
    return tlv(0x17, Buffer.from(`${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`, 'ascii'));
  },
  /** [n] EXPLICIT (construído). */
  explicit: (tagNumber: number, ...content: Buffer[]) => tlv(0xa0 | tagNumber, ...content),
  /** [n] IMPLICIT construído, trocando a tag de um SET/SEQUENCE já codificado. */
  implicitConstructed(tagNumber: number, encoded: Buffer): Buffer {
    return Buffer.concat([Buffer.from([0xa0 | tagNumber]), encoded.subarray(1)]);
  },
});

export function parseDer(input: Buffer, offset = 0): DerNode & { end: number } {
  if (offset + 2 > input.length) throw new TypeError('DER truncado.');
  const tag = input[offset];
  if ((tag & 0x1f) === 0x1f) throw new TypeError('Tag DER multibyte não suportada.');
  let length = input[offset + 1];
  let headerLength = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new TypeError('Comprimento DER não suportado.');
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + input[offset + 2 + index];
    headerLength += count;
  }
  const start = offset + headerLength;
  const end = start + length;
  if (end > input.length) throw new TypeError('DER truncado.');
  const content = input.subarray(start, end);
  const children: DerNode[] = [];
  if (tag & 0x20) {
    for (let cursor = start; cursor < end;) {
      const child = parseDer(input, cursor);
      children.push(child);
      cursor = child.end;
    }
  }
  return { tag, raw: input.subarray(offset, end), content, children, end };
}

export function decodeOid(node: DerNode): string {
  if (node.tag !== 0x06) throw new TypeError('OID esperado.');
  const bytes = node.content;
  const arcs = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) { arcs.push(value); value = 0; }
  }
  return arcs.join('.');
}
