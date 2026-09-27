import { PaymentCliError } from "./payment-cli-transport";

export function paymentLookupQuery(kind: string, value: string) {
  if (kind === "expense-center-due-month") {
    const match = value.match(/^([^|\r\n]{1,160})\|(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match || Number(match[2]) < 2000 || Number(match[2]) > 2100) throw new PaymentCliError("Centro e mês inválidos.");
    const start = new Date(Date.UTC(Number(match[2]), Number(match[3]) - 1, 1, 3)).toISOString();
    const end = new Date(Date.UTC(Number(match[2]), Number(match[3]), 1, 3)).toISOString();
    return { from: [{ collectionId: "expenses" }], where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "resultCenter" }, op: "EQUAL", value: { stringValue: match[1] } } },
      { fieldFilter: { field: { fieldPath: "dueDate" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: start } } },
      { fieldFilter: { field: { fieldPath: "dueDate" }, op: "LESS_THAN", value: { timestampValue: end } } },
    ] } }, limit: 26 };
  }
  if (kind === "expense-unit-month") {
    if (!/^[a-zA-Z0-9_-]{1,170}:[a-zA-Z0-9_-]{1,170}:\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new PaymentCliError("Unidade, centro e mês inválidos.");
    const [unit, center, month] = value.split(":");
    const equal = (fieldPath: string, stringValue: string) => ({ fieldFilter: { field: { fieldPath }, op: "EQUAL", value: { stringValue } } });
    return { from: [{ collectionId: "expenses" }], where: { compositeFilter: { op: "AND", filters: [
      { compositeFilter: { op: "OR", filters: [equal("unitId", unit), equal("resultCenterId", center), equal("referenceResultCenterId", center)] } },
      { compositeFilter: { op: "OR", filters: [equal("provisionCompetence", month), equal("competenceMonth", month)] } },
    ] } }, limit: 26 };
  }
  if (kind === "expense-account-center") {
    if (!/^[a-zA-Z0-9_-]{1,170}:[a-zA-Z0-9_-]{1,170}$/.test(value)) throw new PaymentCliError("Conta e centro inválidos.");
    const [account, center] = value.split(":");
    return { from: [{ collectionId: "expenses" }], where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "accountPlan" }, op: "EQUAL", value: { stringValue: account } } },
      { fieldFilter: { field: { fieldPath: "resultCenterId" }, op: "EQUAL", value: { stringValue: center } } },
    ] } }, limit: 26 };
  }
  let collectionId: string;
  let fieldPath: string;
  let fieldValue: { doubleValue: number } | { stringValue: string };
  if (kind === "expense-amount") {
    const cents = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000) {
      throw new PaymentCliError("Valor de busca inválido.");
    }
    collectionId = "expenses"; fieldPath = "totalValue"; fieldValue = { doubleValue: cents / 100 };
  } else if (kind === "expense-supplier" || kind === "expense-account") {
    if (!/^[a-zA-Z0-9_-]{1,170}$/.test(value)) throw new PaymentCliError("Fornecedor ou conta inválidos.");
    collectionId = "expenses"; fieldPath = kind === "expense-account" ? "accountPlan" : "supplier"; fieldValue = { stringValue: value };
  } else throw new PaymentCliError("Busca não permitida.");
  return { from: [{ collectionId }], where: { fieldFilter: {
    field: { fieldPath }, op: "EQUAL", value: fieldValue,
  } }, limit: 26 };
}

export function decodeFirestoreValue(value: Record<string, unknown>): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("mapValue" in value) {
    const fields = (value.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  }
  if ("arrayValue" in value) return ((value.arrayValue as { values?: Record<string, unknown>[] }).values ?? []).map(decodeFirestoreValue);
  return null;
}
