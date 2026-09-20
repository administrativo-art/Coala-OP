import type { FinancialInboxMessage } from "./types";

export const FINANCIAL_INBOX_SEARCH_INDEX_VERSION = 1;
export const FINANCIAL_INBOX_SEARCH_STATE_ID = `inbox-search-index-v${FINANCIAL_INBOX_SEARCH_INDEX_VERSION}`;
const MAX_INDEX_TERMS = 600;
const MAX_PREFIX_LENGTH = 24;

type SearchableInboxMessage = Pick<
  FinancialInboxMessage,
  "from" | "fromAddress" | "senderDomain" | "subject" | "classification"
>;

export function normalizeFinancialInboxSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function amountSearchValues(amountCents: number | null | undefined) {
  if (amountCents == null) return [];
  const value = (amountCents / 100).toFixed(2);
  return [value, value.replace(".", ","), String(amountCents)];
}

export function financialInboxSearchValues(message: SearchableInboxMessage) {
  return [
    message.classification.supplierName,
    message.classification.billingIdentity?.supplierTaxId,
    message.classification.billingIdentity?.customerAccount,
    message.classification.billingIdentity?.contractNumber,
    ...(message.classification.billingIdentity?.serviceNumbers ?? []),
    message.classification.fiscalIdentity?.collectorName,
    message.classification.fiscalIdentity?.taxpayerName,
    message.classification.fiscalIdentity?.taxpayerTaxId,
    message.classification.fiscalIdentity?.taxpayerRegistration,
    message.classification.fiscalIdentity?.documentNumber,
    message.classification.fiscalIdentity?.documentKind,
    ...(message.classification.fiscalIdentity?.revenueCodes ?? []),
    ...(message.classification.fiscalIdentity?.revenueDescriptions ?? []),
    ...(message.classification.fiscalIdentity?.revenueItems ?? []).flatMap((item) => [item.code, item.description]),
    ...amountSearchValues(message.classification.amountCents),
    message.classification.competence,
    message.classification.dueDate,
    message.from,
    message.fromAddress,
    message.senderDomain,
    message.subject,
  ].filter(Boolean).map(String);
}

function addTermVariants(target: Set<string>, value: string) {
  const normalized = normalizeFinancialInboxSearch(value);
  for (const word of normalized.split(" ").filter(Boolean)) {
    target.add(word);
    for (let length = 1; length <= Math.min(word.length, MAX_PREFIX_LENGTH); length += 1) {
      target.add(word.slice(0, length));
    }
    if (/^\d+$/.test(word)) {
      for (let length = 4; length <= Math.min(word.length, MAX_PREFIX_LENGTH); length += 1) {
        target.add(word.slice(-length));
      }
    }
  }
  const digits = normalized.replace(/\D/g, "");
  if (digits.length >= 2) {
    target.add(digits);
    for (let length = 2; length <= Math.min(digits.length, MAX_PREFIX_LENGTH); length += 1) {
      target.add(digits.slice(0, length));
    }
    for (let length = 4; length <= Math.min(digits.length, MAX_PREFIX_LENGTH); length += 1) {
      target.add(digits.slice(-length));
    }
  }
}

export function buildFinancialInboxSearchTerms(message: SearchableInboxMessage) {
  const terms = new Set<string>();
  for (const value of financialInboxSearchValues(message)) {
    addTermVariants(terms, value);
    if (terms.size >= MAX_INDEX_TERMS) break;
  }
  return [...terms].slice(0, MAX_INDEX_TERMS);
}

export function financialInboxSearchLookupToken(search: string) {
  const normalized = normalizeFinancialInboxSearch(search);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) return null;
  return words.sort((left, right) => right.length - left.length)[0];
}
