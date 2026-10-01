import { AppError } from "@/lib/observability/app-error";

const LOOKBACK_DAYS = 35;

export type StonePixReservation =
  | { status: "processed" }
  | { status: "waiting" }
  | { status: "reserved"; leaseId: string; attempt: number };

export type StonePixRequestRepository = {
  reserve(input: { document: string; referenceDate: string; now: Date }): Promise<StonePixReservation>;
  accepted(input: { document: string; referenceDate: string; leaseId: string; status: number; now: Date }): Promise<void>;
  failed(input: { document: string; referenceDate: string; leaseId: string; errorCode: string; now: Date }): Promise<void>;
};

export function isStonePixRequestDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function dateInTimeZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function stonePixRequestDates(now: Date, startDate: string, lookbackDays = LOOKBACK_DAYS) {
  if (!isStonePixRequestDate(startDate) || !Number.isInteger(lookbackDays)
    || lookbackDays < 1 || lookbackDays > 90) {
    throw new AppError({ code: "STONE_PIX_SYNC_INVALID_CONFIGURATION", kind: "UNEXPECTED_APPLICATION" });
  }
  const yesterday = shiftDate(dateInTimeZone(now, "America/Sao_Paulo"), -1);
  const first = startDate > shiftDate(yesterday, -(lookbackDays - 1))
    ? startDate
    : shiftDate(yesterday, -(lookbackDays - 1));
  if (first > yesterday) return [];
  const dates: string[] = [];
  for (let current = first; current <= yesterday; current = shiftDate(current, 1)) dates.push(current);
  return dates;
}

export async function syncStonePixRequests(input: {
  document: string;
  startDate: string;
  now: Date;
  repository: StonePixRequestRepository;
  requestFile: (input: { document: string; referenceDate: string }) => Promise<{ status: number }>;
}) {
  const dates = stonePixRequestDates(input.now, input.startDate);
  const result = { considered: dates.length, requested: 0, waiting: 0, processed: 0, failed: 0 };
  let lastError: unknown = null;
  for (const referenceDate of dates) {
    const reservation = await input.repository.reserve({
      document: input.document, referenceDate, now: input.now,
    });
    if (reservation.status === "processed") { result.processed += 1; continue; }
    if (reservation.status === "waiting") { result.waiting += 1; continue; }
    try {
      const response = await input.requestFile({ document: input.document, referenceDate });
      await input.repository.accepted({ document: input.document, referenceDate,
        leaseId: reservation.leaseId, status: response.status, now: input.now });
      result.requested += 1;
    } catch (error) {
      const errorCode = error instanceof AppError ? error.code : "STONE_PIX_REQUEST_UNEXPECTED";
      await input.repository.failed({ document: input.document, referenceDate,
        leaseId: reservation.leaseId, errorCode, now: input.now });
      result.failed += 1;
      lastError = error;
    }
  }
  if (lastError) {
    throw new AppError({ code: "STONE_PIX_SYNC_PARTIAL_FAILURE", kind: "TRANSIENT_EXTERNAL",
      safeMessage: "Alguns arquivos Pix ainda não puderam ser solicitados.", cause: lastError });
  }
  return result;
}
