import { createHash } from "node:crypto";
import { createInterClient } from "./client.server";

type InterStatementPayload = Record<string, unknown>;

export type InterStatementEntry = {
  externalId: string;
  references: string[];
  date: string;
  amount: number;
  description: string;
  operationType: string;
  transactionType: string;
  raw: InterStatementPayload;
};

type InterStatementPage = {
  transacoes?: InterStatementPayload[];
  totalElementos?: number;
  totalPaginas?: number;
  ultimaPagina?: boolean;
  hasMore?: boolean;
};

function firstText(source: InterStatementPayload, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;

  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return 0;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: string) {
  const isoDate = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;

  const brazilianDate = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (brazilianDate) return `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}`;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("O Banco Inter retornou uma transação sem data válida.");
  return parsed.toISOString().slice(0, 10);
}

function signedAmount(rawAmount: number, operationType: string) {
  if (rawAmount < 0) return rawAmount;
  const normalized = operationType
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  const debit = new Set(["D", "DEBITO", "DEBIT", "SAIDA", "PAGAMENTO"]);
  return debit.has(normalized) ? -Math.abs(rawAmount) : Math.abs(rawAmount);
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeInterStatementEntries(rawEntries: InterStatementPayload[]) {
  const fallbackOccurrences = new Map<string, number>();

  return rawEntries.map((raw): InterStatementEntry => {
    const date = normalizeDate(
      firstText(raw, ["dataEntrada", "dataTransacao", "dataInclusao", "dataHora", "data"])
    );
    const operationType = firstText(raw, ["tipoOperacao", "natureza", "operacao"]);
    const transactionType = firstText(raw, ["tipoTransacao", "tipo", "categoria"]);
    const amount = signedAmount(parseMoney(raw.valor ?? raw.amount), operationType);
    const title = firstText(raw, ["titulo", "title"]);
    const detail = firstText(raw, ["descricao", "description", "historico"]);
    const description = title && detail && title.toLocaleLowerCase("pt-BR") !== detail.toLocaleLowerCase("pt-BR")
      ? `${title} — ${detail}`
      : detail || title || "Movimentação Banco Inter";
    const references = [...new Set([
      firstText(raw, ["idTransacao"]),
      firstText(raw, ["codigoTransacao"]),
      firstText(raw, ["identificador"]),
      firstText(raw, ["endToEndId"]),
      firstText(raw, ["codigoSolicitacao"]),
      firstText(raw, ["codigoAutenticacao"]),
      firstText(raw, ["numeroDocumento"]),
      firstText(raw, ["id"]),
    ].filter(Boolean))];
    const bankIdentifier = firstText(raw, [
      "idTransacao",
      "codigoTransacao",
      "identificador",
      "endToEndId",
      "codigoSolicitacao",
      "codigoAutenticacao",
      "numeroDocumento",
      "id",
    ]);

    if (bankIdentifier) {
      return {
        externalId: `bank-${stableHash([
          bankIdentifier,
          date,
          Math.round(amount * 100),
          description.trim().toLocaleLowerCase("pt-BR"),
        ].join("|")).slice(0, 40)}`,
        references,
        date,
        amount,
        description,
        operationType,
        transactionType,
        raw,
      };
    }

    const fallbackBase = [
      date,
      Math.round(amount * 100),
      description.trim().toLocaleLowerCase("pt-BR"),
      operationType.trim().toLocaleLowerCase("pt-BR"),
      transactionType.trim().toLocaleLowerCase("pt-BR"),
    ].join("|");
    const occurrence = (fallbackOccurrences.get(fallbackBase) ?? 0) + 1;
    fallbackOccurrences.set(fallbackBase, occurrence);

    return {
      externalId: `fallback-${stableHash(`${fallbackBase}|${occurrence}`).slice(0, 40)}`,
      references,
      date,
      amount,
      description,
      operationType,
      transactionType,
      raw,
    };
  });
}

export function interStatementTransactionDocumentId(accountId: string, externalId: string) {
  return `inter_${stableHash(`${accountId}|${externalId}`).slice(0, 48)}`;
}

export function interStatementSessionDocumentId(accountId: string, month: string) {
  return `inter_${stableHash(accountId).slice(0, 12)}_${month}`;
}

export async function listInterStatementEntries(startDate: string, endDate: string) {
  const client = await createInterClient("extrato.read", { basePath: "/banking/v2" });
  const rawEntries: InterStatementPayload[] = [];
  const pageSize = 1_000;
  let page = 0;

  while (page < 100) {
    const response = await client.get<InterStatementPage>("/extrato/completo", {
      params: {
        dataInicio: startDate,
        dataFim: endDate,
        pagina: page,
        tamanhoPagina: pageSize,
      },
    });
    const transactions = Array.isArray(response.data?.transacoes) ? response.data.transacoes : [];
    rawEntries.push(...transactions);

    const totalPages = Number(response.data?.totalPaginas ?? 0);
    const isLastPage = response.data?.ultimaPagina === true;
    if (isLastPage || transactions.length < pageSize || (totalPages > 0 && page + 1 >= totalPages)) break;
    page += 1;
  }

  return normalizeInterStatementEntries(rawEntries);
}
