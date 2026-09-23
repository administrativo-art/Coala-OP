import Papa from "papaparse";

const requiredColumns = [
  "DOCUMENTO", "STONECODE", "CATEGORIA", "DATA DA VENDA", "DATA DE VENCIMENTO",
  "STONE ID", "Nº DA PARCELA", "VALOR BRUTO", "VALOR LÍQUIDO", "ÚLTIMO STATUS",
] as const;
const maxRows = 20_000;
const million = BigInt(1_000_000);

export type OpenStoneReceivable = {
  transactionId: string;
  installment: string;
  saleDate: string;
  dueDate: string;
  brand: string;
  product: string;
  grossMicros: bigint;
  netMicros: bigint;
};

export type StoneReportPreview = {
  totalRows: number;
  paidRows: number;
  openRows: OpenStoneReceivable[];
  totalOpenMicros: bigint;
  byDueDate: { date: string; count: number; netMicros: bigint }[];
};

function fail(message: string): never { throw new Error(message); }
const normalizedCode = (value: string) => value.trim().replace(/^0+(?=\d)/, "");

function parseDate(value: string, row: number, field: "vencimento" | "venda" = "vencimento") {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) fail(`Data de ${field} inválida na linha ${row}.`);
  const [, d, m, y] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) {
    fail(`Data de ${field} inválida na linha ${row}.`);
  }
  return `${y}-${m}-${d}`;
}

function parseMicros(value: string, row: number) {
  const raw = value.trim();
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,6}$/.test(raw)) fail(`Valor inválido na linha ${row}.`);
  const negative = raw.startsWith("-");
  const [whole, fraction] = raw.replace(/^-/, "").replace(/\./g, "").split(",");
  const micros = BigInt(whole) * million + BigInt(fraction.padEnd(6, "0"));
  return negative ? -micros : micros;
}

export function formatStoneReportMoney(value: bigint, precision: 2 | 6 = 2) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const rounded = precision === 2 ? (absolute + BigInt(5_000)) / BigInt(10_000) : absolute;
  const unit = precision === 2 ? BigInt(100) : million;
  const whole = String(rounded / unit).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = String(rounded % unit).padStart(precision, "0");
  return `R$ ${negative ? "-" : ""}${whole},${fraction}`;
}

/** Parses the Stone portal's receivables report entirely in the browser; no upload or financial write. */
export function parseStoneReceivablesReportCsv(text: string, stoneCode: string): StoneReportPreview {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true, delimiter: ";", skipEmptyLines: "greedy",
    transformHeader: header => header.replace(/^\uFEFF/, "").trim(),
  });
  if (parsed.errors.length || !parsed.meta.fields || !requiredColumns.every(column => parsed.meta.fields?.includes(column))) {
    fail("O CSV não corresponde à Lista de recebimentos exportada pela Stone.");
  }
  if (!parsed.data.length || parsed.data.length > maxRows) fail("O relatório está vazio ou excede 20 mil linhas.");
  const code = normalizedCode(stoneCode);
  const documents = new Set<string>();
  const seenOpen = new Set<string>();
  const openRows: OpenStoneReceivable[] = [];
  const due = new Map<string, { count: number; netMicros: bigint }>();
  let paidRows = 0;
  let totalOpenMicros = BigInt(0);
  for (let index = 0; index < parsed.data.length; index++) {
    const row = parsed.data[index];
    const line = index + 2;
    if (normalizedCode(row.STONECODE ?? "") !== code) fail(`StoneCode diferente do selecionado na linha ${line}.`);
    const document = (row.DOCUMENTO ?? "").trim();
    if (!document) fail(`Documento ausente na linha ${line}.`);
    documents.add(document);
    const dueDate = parseDate(row["DATA DE VENCIMENTO"] ?? "", line);
    const grossMicros = parseMicros(row["VALOR BRUTO"] ?? "", line);
    const netMicros = parseMicros(row["VALOR LÍQUIDO"] ?? "", line);
    const status = (row["ÚLTIMO STATUS"] ?? "").trim();
    if (status === "Pago") { paidRows++; continue; }
    if (status !== "Aberto") fail(`Situação não reconhecida na linha ${line}.`);
    if ((row.CATEGORIA ?? "").trim() !== "Venda") fail(`Recebível aberto de categoria não reconhecida na linha ${line}.`);
    const transactionId = (row["STONE ID"] ?? "").trim();
    const installment = (row["Nº DA PARCELA"] ?? "").trim();
    if (!/^\d+$/.test(transactionId) || !/^[1-9]\d*$/.test(installment) || grossMicros <= BigInt(0) || netMicros < BigInt(0) || netMicros > grossMicros) {
      fail(`Parcela aberta incompleta na linha ${line}.`);
    }
    const saleDate = (row["DATA DA VENDA"] ?? "").trim().slice(0, 10);
    parseDate(saleDate, line, "venda");
    const key = `${transactionId}:${installment}`;
    if (seenOpen.has(key)) fail(`Parcela aberta duplicada na linha ${line}.`);
    seenOpen.add(key);
    openRows.push({ transactionId, installment, saleDate,
      dueDate, brand: (row.BANDEIRA ?? "").trim(), product: (row.PRODUTO ?? "").trim(), grossMicros, netMicros });
    totalOpenMicros += netMicros;
    const group = due.get(dueDate) ?? { count: 0, netMicros: BigInt(0) };
    group.count++;
    group.netMicros += netMicros;
    due.set(dueDate, group);
  }
  if (documents.size !== 1) fail("O arquivo contém mais de um documento; exporte apenas a conta selecionada.");
  openRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.transactionId.localeCompare(b.transactionId) || Number(a.installment) - Number(b.installment));
  return { totalRows: parsed.data.length, paidRows, openRows, totalOpenMicros,
    byDueDate: [...due].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })) };
}
