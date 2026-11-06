import { createHash } from "node:crypto";

/**
 * Pix copia e cola (BR Code / EMV MPM) de guia recebida na caixa financeira.
 *
 * Só aceita QR dinâmico (cobrança com vencimento, `cobv`) de recebedor em allowlist,
 * porque o valor e o recebedor vêm do servidor do PSP no momento do pagamento.
 * A allowlist começa somente com a guia do FGTS Digital (Caixa).
 */

type TlvField = { id: string; value: string };

export type PixCopyPasteReceiver = "fgts_digital";

const ALLOWED_DYNAMIC_RECEIVERS: ReadonlyArray<{
  receiver: PixCopyPasteReceiver;
  locationHost: string;
  locationPathPrefix: string;
  merchantName: string;
}> = [
  {
    receiver: "fgts_digital",
    locationHost: "pix-qrcode.caixa.gov.br",
    locationPathPrefix: "/api/v2/cobv/",
    merchantName: "CAIXA ECONOMICA FEDERAL",
  },
];

export type ParsedPixCopyPaste = {
  payload: string;
  payloadHash: string;
  receiver: PixCopyPasteReceiver;
  merchantName: string;
  merchantCity: string;
  locationUrl: string;
  locationHost: string;
  amountCents: number | null;
};

function parseTlv(value: string): TlvField[] | null {
  const fields: TlvField[] = [];
  let index = 0;
  while (index < value.length) {
    const id = value.slice(index, index + 2);
    const lengthText = value.slice(index + 2, index + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText)) return null;
    const length = Number(lengthText);
    const content = value.slice(index + 4, index + 4 + length);
    if (content.length !== length) return null;
    fields.push({ id, value: content });
    index += 4 + length;
  }
  return fields;
}

/** CRC-16/CCITT-FALSE exigido pelo Manual de Padrões para Iniciação do Pix (campo 63). */
export function pixCrc16(value: string) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value, "utf8")) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function pixCopyPastePayloadHash(payload: string) {
  return createHash("sha256").update(payload).digest("hex");
}

function normalizedName(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Devolve `null` para qualquer código malformado, estático ou de recebedor não permitido. */
export function parseAllowedPixCopyPaste(raw: string): ParsedPixCopyPaste | null {
  const payload = String(raw ?? "").trim();
  if (payload.length < 30 || payload.length > 512 || /[\r\n\t]/.test(payload)) return null;
  if (!payload.startsWith("000201")) return null;
  const crcIndex = payload.length - 4;
  if (payload.slice(crcIndex - 4, crcIndex) !== "6304") return null;
  if (pixCrc16(payload.slice(0, crcIndex)) !== payload.slice(crcIndex).toUpperCase()) return null;
  const fields = parseTlv(payload);
  if (!fields) return null;
  const field = (id: string) => fields.filter((item) => item.id === id);
  if (field("00")[0]?.value !== "01") return null;
  // 01 = 12 indica QR de uso único (dinâmico); estático (11) é recusado.
  if (field("01").length && field("01")[0]?.value !== "12") return null;
  if (field("53")[0]?.value !== "986" || field("58")[0]?.value !== "BR") return null;
  const accounts = field("26");
  if (accounts.length !== 1) return null;
  const account = parseTlv(accounts[0].value);
  if (!account) return null;
  const gui = account.find((item) => item.id === "00")?.value.toLowerCase();
  const location = account.find((item) => item.id === "25")?.value;
  if (gui !== "br.gov.bcb.pix" || !location || account.some((item) => item.id === "01")) return null;
  let url: URL;
  try {
    url = new URL(`https://${location}`);
  } catch {
    return null;
  }
  const merchantName = field("59")[0]?.value ?? "";
  const merchantCity = field("60")[0]?.value ?? "";
  const allowed = ALLOWED_DYNAMIC_RECEIVERS.find((item) => (
    url.hostname === item.locationHost
    && url.pathname.startsWith(item.locationPathPrefix)
    && url.pathname.length > item.locationPathPrefix.length
    && !url.search && !url.hash && !url.port && !url.username
    && normalizedName(merchantName) === item.merchantName
  ));
  if (!allowed) return null;
  const amountText = field("54")[0]?.value;
  let amountCents: number | null = null;
  if (amountText !== undefined) {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountText)) return null;
    amountCents = Math.round(Number(amountText) * 100);
  }
  return {
    payload,
    payloadHash: pixCopyPastePayloadHash(payload),
    receiver: allowed.receiver,
    merchantName,
    merchantCity,
    locationUrl: `${url.hostname}${url.pathname}`,
    locationHost: url.hostname,
    amountCents,
  };
}

export function maskPixCopyPaste(payload: string) {
  return payload.length <= 16 ? "••••" : `${payload.slice(0, 8)}…${payload.slice(-8)}`;
}
