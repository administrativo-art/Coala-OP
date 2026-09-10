import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

export const UBER_MATCH_DATE_TOLERANCE_DAYS = 3;

export type UberCsvTransaction = {
  fingerprint: string;
  tripId: string;
  transactionTimestampUtc: string | null;
  requestDateLocal: string;
  requestTimeLocal: string | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
  requesterEmail: string | null;
  employeeId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  service: string | null;
  program: string | null;
  paymentMethod: string | null;
  transactionType: string | null;
  amountCents: number;
  currencyCode: string;
  receiptUrl: string | null;
  shortReference: string | null;
  networkTransactionId: string | null;
};

export type UberTripAggregate = {
  tripId: string;
  requestDateLocal: string;
  requestTimeLocal: string | null;
  transactionTimestampUtc: string | null;
  requesterFirstName: string | null;
  requesterLastName: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  employeeId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestName: string | null;
  service: string | null;
  program: string | null;
  paymentMethod: string | null;
  currencyCode: string;
  transactionAmountCents: number;
  receiptUrl: string | null;
  transactions: UberCsvTransaction[];
};

export type UberFinancialCandidate = {
  entityKind: 'expense' | 'transaction';
  entityId: string;
  amountCents: number;
  currencyCode: string;
  eventDate: string;
  description: string;
  supplier: string;
  primaryMatchKey: string;
  matchKeys: string[];
  inputFingerprint: string;
};

export type UberTripMatchCandidate = {
  documentId: string;
  tripId: string;
  primaryMatchKey: string;
  matchKeys: string[];
  requesterName: string | null;
  requesterEmail: string | null;
  employeeId: string | null;
  service: string | null;
  requestDateLocal: string;
  transactionAmountCents: number;
  currencyCode: string;
  receiptUrl: string | null;
  matchedExpenseIds: string[];
  matchedTransactionIds: string[];
};

export type UberMatchDecision =
  | { status: 'waiting'; reason: 'trip_not_available' }
  | { status: 'ambiguous'; reason: 'multiple_trips' | 'trip_already_claimed'; tripDocumentIds: string[] }
  | { status: 'matched'; trip: UberTripMatchCandidate };

const HEADER_ALIASES = {
  tripId: ['Trip/Eats ID', 'Trip ID'],
  transactionTimestampUtc: ['Transaction Timestamp (UTC)'],
  requestDateLocal: ['Request Date (Local)', 'Request Date'],
  requestTimeLocal: ['Request Time (Local)', 'Request Time'],
  requesterFirstName: ['First Name'],
  requesterLastName: ['Last Name'],
  requesterEmail: ['Email'],
  employeeId: ['Employee ID'],
  guestFirstName: ['Guest First Name'],
  guestLastName: ['Guest Last Name'],
  service: ['Service'],
  program: ['Program'],
  paymentMethod: ['Payment Method'],
  transactionType: ['Transaction Type'],
  transactionAmountLocal: [
    'Transaction Amount (Local Currency)',
    'Transaction Amount in Local Currency (incl. Taxes)',
  ],
  currencyCode: ['Local Currency Code', 'Currency Code'],
  receipts: ['Receipts', 'Receipt', 'Receipt PDF', 'Invoices'],
  shortReference: ['Short Reference'],
  networkTransactionId: ['Network Transaction ID', 'Network Transaction Id'],
} as const;

function text(value: unknown) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedHeader(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '');
}

function rowLookup(row: Record<string, unknown>) {
  return new Map(Object.entries(row).map(([key, value]) => [normalizedHeader(key), text(value)]));
}

function field(lookup: Map<string, string>, aliases: readonly string[]) {
  for (const alias of aliases) {
    const value = lookup.get(normalizedHeader(alias));
    if (value) return value;
  }
  return '';
}

function nullable(value: unknown) {
  const resolved = text(value);
  return resolved || null;
}

function parseMoneyCents(value: unknown) {
  let raw = text(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (!raw) return null;
  const negative = raw.startsWith('-') || /^\(.*\)$/.test(raw);
  raw = raw.replace(/[()\-+]/g, '').replace(/[^0-9.,]/g, '');
  if (!raw) return null;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (comma >= 0) {
    raw = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if ((raw.match(/\./g) ?? []).length > 1) {
    const last = raw.lastIndexOf('.');
    raw = `${raw.slice(0, last).replace(/\./g, '')}${raw.slice(last)}`;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((negative ? -Math.abs(parsed) : parsed) * 100);
}

function parseDate(value: unknown) {
  const raw = text(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return validDate(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  if (br) return validDate(`${br[3]}-${br[2]}-${br[1]}`);
  return null;
}

function validDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizedMerchantText(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function rowFingerprint(row: Omit<UberCsvTransaction, 'fingerprint'>) {
  return stableHash([
    row.tripId,
    row.transactionTimestampUtc,
    row.transactionType,
    row.amountCents,
    row.currencyCode,
    row.shortReference,
    row.networkTransactionId,
  ]);
}

function isRideRow(service: string) {
  const normalized = normalizedMerchantText(service);
  return !/(^| )(uber ?eats|eats|meal|delivery|courier)( |$)/.test(normalized);
}

function requesterName(firstName: string | null, lastName: string | null) {
  return nullable([firstName, lastName].filter(Boolean).join(' '));
}

export function parseUberTripCsv(input: Buffer | string): UberTripAggregate[] {
  const records = parse(input, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, unknown>>;
  if (records.length > 100_000) throw new Error('UBER_CSV_ROW_LIMIT_EXCEEDED');

  const parsedRows: UberCsvTransaction[] = [];
  for (const record of records) {
    const lookup = rowLookup(record);
    const tripId = field(lookup, HEADER_ALIASES.tripId);
    const service = field(lookup, HEADER_ALIASES.service);
    if (!tripId || !isRideRow(service)) continue;
    const amountCents = parseMoneyCents(field(lookup, HEADER_ALIASES.transactionAmountLocal));
    if (amountCents == null) continue;
    const transactionTimestampUtc = nullable(field(lookup, HEADER_ALIASES.transactionTimestampUtc));
    const requestDateLocal = parseDate(field(lookup, HEADER_ALIASES.requestDateLocal))
      ?? parseDate(transactionTimestampUtc);
    if (!requestDateLocal) continue;
    const currencyCode = field(lookup, HEADER_ALIASES.currencyCode).toUpperCase() || 'BRL';
    const row: Omit<UberCsvTransaction, 'fingerprint'> = {
      tripId,
      transactionTimestampUtc,
      requestDateLocal,
      requestTimeLocal: nullable(field(lookup, HEADER_ALIASES.requestTimeLocal)),
      requesterFirstName: nullable(field(lookup, HEADER_ALIASES.requesterFirstName)),
      requesterLastName: nullable(field(lookup, HEADER_ALIASES.requesterLastName)),
      requesterEmail: nullable(field(lookup, HEADER_ALIASES.requesterEmail)?.toLocaleLowerCase('pt-BR')),
      employeeId: nullable(field(lookup, HEADER_ALIASES.employeeId)),
      guestFirstName: nullable(field(lookup, HEADER_ALIASES.guestFirstName)),
      guestLastName: nullable(field(lookup, HEADER_ALIASES.guestLastName)),
      service: nullable(service),
      program: nullable(field(lookup, HEADER_ALIASES.program)),
      paymentMethod: nullable(field(lookup, HEADER_ALIASES.paymentMethod)),
      transactionType: nullable(field(lookup, HEADER_ALIASES.transactionType)),
      amountCents,
      currencyCode,
      receiptUrl: nullable(field(lookup, HEADER_ALIASES.receipts)),
      shortReference: nullable(field(lookup, HEADER_ALIASES.shortReference)),
      networkTransactionId: nullable(field(lookup, HEADER_ALIASES.networkTransactionId)),
    };
    parsedRows.push({ ...row, fingerprint: rowFingerprint(row) });
  }

  const grouped = new Map<string, UberCsvTransaction[]>();
  for (const row of parsedRows) {
    const key = `${row.tripId}\u0000${row.currencyCode}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.values()].map((rows) => {
    const uniqueRows = [...new Map(rows.map((row) => [row.fingerprint, row])).values()];
    const first = uniqueRows[0]!;
    return {
      tripId: first.tripId,
      requestDateLocal: first.requestDateLocal,
      requestTimeLocal: first.requestTimeLocal,
      transactionTimestampUtc: first.transactionTimestampUtc,
      requesterFirstName: first.requesterFirstName,
      requesterLastName: first.requesterLastName,
      requesterName: requesterName(first.requesterFirstName, first.requesterLastName),
      requesterEmail: first.requesterEmail,
      employeeId: first.employeeId,
      guestFirstName: first.guestFirstName,
      guestLastName: first.guestLastName,
      guestName: requesterName(first.guestFirstName, first.guestLastName),
      service: first.service,
      program: first.program,
      paymentMethod: first.paymentMethod,
      currencyCode: first.currencyCode,
      transactionAmountCents: uniqueRows.reduce((sum, row) => sum + row.amountCents, 0),
      receiptUrl: uniqueRows.find((row) => row.receiptUrl)?.receiptUrl ?? null,
      transactions: uniqueRows,
    } satisfies UberTripAggregate;
  }).sort((left, right) => left.requestDateLocal.localeCompare(right.requestDateLocal)
    || left.tripId.localeCompare(right.tripId));
}

export function uberTripDocumentId(tripId: string, currencyCode: string) {
  return `uber_${stableHash([tripId, currencyCode]).slice(0, 40)}`;
}

export function uberDailyFileDate(fileName: string) {
  const match = /^daily_trips[-_](\d{4})[-_](\d{2})[-_](\d{2})\.csv$/i.exec(fileName.trim());
  if (!match) return null;
  return validDate(`${match[1]}-${match[2]}-${match[3]}`);
}

export function normalizeSha256HostFingerprint(value: string) {
  const raw = value.trim().replace(/^SHA256:/i, '');
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLocaleLowerCase('en-US');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) {
    throw new Error('UBER_SFTP_HOST_FINGERPRINT_INVALID');
  }
  return decoded.toString('hex');
}

export function uberMatchKey(currencyCode: string, amountCents: number, eventDate: string) {
  return `uber:${currencyCode.toUpperCase()}:${amountCents}:${eventDate}`;
}

export function uberMatchKeys(currencyCode: string, amountCents: number, eventDate: string) {
  if (!validDate(eventDate) || !Number.isInteger(amountCents) || amountCents <= 0) return [];
  return Array.from({ length: UBER_MATCH_DATE_TOLERANCE_DAYS * 2 + 1 }, (_, index) =>
    uberMatchKey(currencyCode, amountCents, addDays(eventDate, index - UBER_MATCH_DATE_TOLERANCE_DAYS))
  );
}

export function uberTripPrimaryMatchKey(trip: Pick<UberTripAggregate, 'currencyCode' | 'transactionAmountCents' | 'requestDateLocal'>) {
  return uberMatchKey(trip.currencyCode, trip.transactionAmountCents, trip.requestDateLocal);
}

function dateFromUnknown(value: unknown) {
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return parseDate(value);
}

export function recognizeUberFinancialCandidate(
  entityKind: 'expense' | 'transaction',
  entityId: string,
  data: Record<string, unknown>,
): UberFinancialCandidate | null {
  if (entityKind === 'transaction' && data.direction !== 'out') return null;
  if (entityKind === 'expense' && (
    data.status === 'cancelled'
    || data.status === 'draft'
    || data.cardStatementRevisionStatus === 'removed'
  )) return null;
  const description = text(data.rawBankDescription || data.description);
  const supplier = text(data.supplier);
  const merchant = normalizedMerchantText(`${supplier} ${description}`);
  if (!/(^| )uber( |$)/.test(merchant) || /(^| )(uber ?eats|ubereats)( |$)/.test(merchant)) return null;
  const rawAmount = entityKind === 'expense' ? data.totalValue : data.amount;
  const amountCents = Math.round(Number(rawAmount) * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  const eventDate = dateFromUnknown(
    entityKind === 'expense'
      ? data.cardChargeDate || data.originalCardChargeDate || data.competenceDate || data.dueDate
      : data.date,
  );
  if (!eventDate) return null;
  const rawCurrency = text(data.currencyCode || data.currency || 'BRL').toUpperCase();
  const currencyCode = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'BRL';
  const primaryMatchKey = uberMatchKey(currencyCode, amountCents, eventDate);
  const matchKeys = uberMatchKeys(currencyCode, amountCents, eventDate);
  return {
    entityKind,
    entityId,
    amountCents,
    currencyCode,
    eventDate,
    description,
    supplier,
    primaryMatchKey,
    matchKeys,
    inputFingerprint: stableHash([entityKind, entityId, amountCents, currencyCode, eventDate, merchant]),
  };
}

export function decideUberTripMatch(
  candidate: UberFinancialCandidate,
  trips: UberTripMatchCandidate[],
): UberMatchDecision {
  const matching = trips.filter((trip) => trip.matchKeys.includes(candidate.primaryMatchKey));
  if (matching.length === 0) return { status: 'waiting', reason: 'trip_not_available' };
  if (matching.length > 1) {
    return { status: 'ambiguous', reason: 'multiple_trips', tripDocumentIds: matching.map((trip) => trip.documentId) };
  }
  const trip = matching[0]!;
  const claimedIds = candidate.entityKind === 'expense' ? trip.matchedExpenseIds : trip.matchedTransactionIds;
  if (claimedIds.some((id) => id !== candidate.entityId)) {
    return { status: 'ambiguous', reason: 'trip_already_claimed', tripDocumentIds: [trip.documentId] };
  }
  return { status: 'matched', trip };
}

export function uberTripMatchCandidate(documentId: string, data: Record<string, unknown>): UberTripMatchCandidate | null {
  const tripId = text(data.tripId);
  const requestDateLocal = parseDate(data.requestDateLocal);
  const transactionAmountCents = Number(data.transactionAmountCents);
  const currencyCode = text(data.currencyCode).toUpperCase();
  const primaryMatchKey = text(data.primaryMatchKey);
  const matchKeys = Array.isArray(data.matchKeys) ? data.matchKeys.map(text).filter(Boolean) : [];
  if (!tripId || !requestDateLocal || !Number.isInteger(transactionAmountCents) || transactionAmountCents <= 0
    || !currencyCode || !primaryMatchKey || matchKeys.length === 0) return null;
  return {
    documentId,
    tripId,
    primaryMatchKey,
    matchKeys,
    requesterName: nullable(data.requesterName),
    requesterEmail: nullable(data.requesterEmail),
    employeeId: nullable(data.employeeId),
    service: nullable(data.service),
    requestDateLocal,
    transactionAmountCents,
    currencyCode,
    receiptUrl: nullable(data.receiptUrl),
    matchedExpenseIds: Array.isArray(data.matchedExpenseIds) ? data.matchedExpenseIds.map(text).filter(Boolean) : [],
    matchedTransactionIds: Array.isArray(data.matchedTransactionIds) ? data.matchedTransactionIds.map(text).filter(Boolean) : [],
  };
}
