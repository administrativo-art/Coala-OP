const DEFAULT_OFFICIAL_START_DATE = '2026-10-31';
const BRAZIL_TIME_ZONE = 'America/Belem';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function dateInBrazil(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRAZIL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(value: string): value is `${number}-${number}-${number}` {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function repPOfficialStartDate(environment: RuntimeEnvironment = process.env): string {
  const configured = environment.REP_P_OFFICIAL_START_DATE?.trim() || DEFAULT_OFFICIAL_START_DATE;
  return validDate(configured) ? configured : DEFAULT_OFFICIAL_START_DATE;
}

export function repPOfficialStartReached(now = new Date(), environment: RuntimeEnvironment = process.env): boolean {
  return dateInBrazil(now) >= repPOfficialStartDate(environment);
}

/** A civil date belongs to the pre-official pilot only before the immutable cutover date. */
export function repPPilotWorkDateAllowed(workDate: string, officialStartDate = repPOfficialStartDate()): boolean {
  return validDate(workDate) && workDate < officialStartDate;
}

export function repPOfficialMarkingEnabled(
  now = new Date(),
  environment: RuntimeEnvironment = process.env,
): boolean {
  return environment.REP_P_MARKING_ENABLED === 'true' && repPOfficialStartReached(now, environment);
}
