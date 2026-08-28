import { closureDateFromIso } from "./date";
import { toCents } from "./money";
import type { CashClosureCashMovement, CashClosureCashMovementKind } from "./types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function rows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  if (!source) return [];
  for (const key of ["data", "items", "results", "sangrias", "suprimentos", "formasPagamento"]) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

function field(source: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function nestedField(source: UnknownRecord, parentKeys: string[], childKeys: string[]): unknown {
  for (const parentKey of parentKeys) {
    const parent = record(source[parentKey]);
    if (!parent) continue;
    const value = field(parent, childKeys);
    if (value !== undefined) return value;
  }
  return undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function boolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["true", "1", "sim", "s", "cancelado"].includes(value.trim().toLowerCase());
}

function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function movementDate(value: string): string | null {
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const brazilian = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  try {
    return closureDateFromIso(value);
  } catch {
    return null;
  }
}

function paymentMethods(raw: unknown) {
  const byId = new Map<string, { name: string; isCash: boolean }>();
  for (const value of rows(raw)) {
    const source = record(value);
    if (!source) continue;
    const id = text(field(source, ["codigo", "Codigo", "id", "Id", "codFormaPagamento", "codformapagamento"]));
    const name = text(field(source, ["nome", "Nome", "descr", "descricao", "Descricao", "formaPagamento"]));
    if (!id || !name) continue;
    const normalized = normalizeName(name);
    byId.set(id, { name, isCash: normalized === "DINHEIRO" || normalized.includes("DINHEIRO") });
  }
  return byId;
}

function parseMovement(input: {
  value: unknown;
  kind: CashClosureCashMovementKind;
  index: number;
  paymentMethodById: ReturnType<typeof paymentMethods>;
}): CashClosureCashMovement | null {
  const source = record(input.value);
  if (!source) return null;
  const rawAmount = field(source, ["valor", "Valor", "valorTotal", "ValorTotal", "valortotal", "quantia"]);
  if (typeof rawAmount !== "number" && typeof rawAmount !== "string") return null;
  const numericAmount = typeof rawAmount === "number"
    ? rawAmount
    : Number(rawAmount.includes(",")
      ? rawAmount.trim().replace(/\./g, "").replace(",", ".")
      : rawAmount.trim());
  if (!Number.isFinite(numericAmount) || numericAmount < 0) return null;
  const occurredAt = text(field(source, [
    "data", "Data", "dataHora", "DataHora", "dtmovimento", "dtMovimento", "dataMovimento",
    input.kind === "supply" ? "dataSuprimento" : "dataSangria",
  ]));
  if (!occurredAt) return null;
  const date = movementDate(occurredAt);
  if (!date) return null;
  const paymentMethodId = text(
    field(source, ["codFormaPagamento", "codformapagamento", "codformapgto", "formaPagamentoId", "idFormaPagamento"])
      ?? nestedField(source, ["formaPagamento", "formapagamento"], ["codigo", "id"]),
  );
  const directPaymentMethodName = text(
    field(source, ["nomeFormaPagamento", "formaPagamentoNome", "descricaoFormaPagamento"])
      ?? nestedField(source, ["formaPagamento", "formapagamento"], ["nome", "descricao"]),
  );
  const classified = paymentMethodId ? input.paymentMethodById.get(paymentMethodId) : undefined;
  const paymentMethodName = directPaymentMethodName ?? classified?.name ?? null;
  const normalizedPaymentName = paymentMethodName ? normalizeName(paymentMethodName) : "";
  const id = text(field(source, ["codigo", "Codigo", "id", "Id", "codMovimento", "codigoMovimento"]))
    ?? `${input.kind}-${date}-${input.index}`;
  return {
    id,
    kind: input.kind,
    amountCents: toCents(numericAmount),
    occurredAt,
    date,
    operatorId: text(
      field(source, [
        "codUsuario", "codusuario", "usuarioId", "usuario_id", "codOperador", "operadorId",
        "usuariorecebimento_id",
      ]) ?? nestedField(source, ["usuario", "operador"], ["codigo", "id"]),
    ),
    terminalId: text(
      field(source, ["codTerminal", "codterminal", "terminalId", "terminal_id"])
        ?? nestedField(source, ["terminal"], ["codigo", "id"]),
    ),
    paymentMethodId,
    paymentMethodName,
    isCash: classified?.isCash === true || normalizedPaymentName.includes("DINHEIRO"),
    cancelled: boolean(field(source, ["cancelado", "isCancelado", "iscancelado", "excluido", "isExcluido"])),
  };
}

function filialId(value: unknown) {
  const source = record(value);
  if (!source) return null;
  return text(
    field(source, ["codFilial", "codfilial", "codloja", "filialId", "filial_id"])
      ?? nestedField(source, ["filial"], ["codigo", "id"]),
  );
}

export function parsePdvCashMovements(input: {
  withdrawals: unknown;
  supplies: unknown;
  paymentMethods: unknown;
  date: string;
  filialId: string;
}): CashClosureCashMovement[] {
  const paymentMethodById = paymentMethods(input.paymentMethods);
  const parsed: CashClosureCashMovement[] = [];
  const sources = [
    { kind: "withdrawal" as const, values: rows(input.withdrawals) },
    { kind: "supply" as const, values: rows(input.supplies) },
  ];
  for (const source of sources) {
    source.values.forEach((value, index) => {
      const movementFilialId = filialId(value);
      if (movementFilialId && movementFilialId !== input.filialId) return;
      const movement = parseMovement({
        value,
        kind: source.kind,
        index,
        paymentMethodById,
      });
      if (movement?.date === input.date) parsed.push(movement);
    });
  }
  return parsed.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
}
