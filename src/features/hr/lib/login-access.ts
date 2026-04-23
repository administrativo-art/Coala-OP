import { addDays, format, parse } from "date-fns";

export const DEFAULT_LOGIN_ACCESS_TIMEZONE =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE ?? "America/Belem";

export const LOGIN_RESTRICTION_PRE_SHIFT_TOLERANCE_MINUTES = 15;
export const LOGIN_RESTRICTION_EXTENSION_MINUTES = 15;
export const LOGIN_RESTRICTION_MAX_EXTENSIONS = 2;

export type LoginRestrictionStatus = "unrestricted" | "allowed" | "blocked";

export type LoginRestrictionReason =
  | "disabled"
  | "within_shift"
  | "pre_shift_tolerance"
  | "after_shift_extension_active"
  | "before_shift_too_early"
  | "after_shift_requires_justification"
  | "after_shift_extension_limit_reached"
  | "day_off"
  | "no_schedule_assigned";

export type LoginRestrictionShiftInput = {
  id: string;
  scheduleId: string;
  unitId: string;
  date: string;
  startTime: string;
  endTime: string;
  type: "work" | "day_off";
  shiftDefinitionId?: string;
};

export type LoginRestrictionJustificationInput = {
  id: string;
  userId: string;
  shiftId: string;
  shiftDate: string;
  submittedAt: string;
  grantedUntil: string;
  sequence: number;
  grantedMinutes: number;
  reason: "after_shift_extension";
};

export type LoginRestrictionShiftWindow = LoginRestrictionShiftInput & {
  source: "schedule";
  spansMidnight: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
  accessStartDate: string | null;
  accessStartTime: string | null;
  accessStartMinutes: number | null;
  endDate: string;
  matchesNow: boolean;
  matchesPreShiftToleranceNow: boolean;
  startsAfterNow: boolean;
  endedBeforeNow: boolean;
};

export type LoginRestrictionActiveExtension = {
  justificationId: string;
  sequence: number;
  submittedAt: string;
  grantedUntil: string;
  grantedUntilLocal: string;
};

export type LoginRestrictionExtensionUsage = {
  used: number;
  remaining: number;
  max: number;
  minutesPerExtension: number;
};

export type LoginRestrictionEvaluation = {
  status: LoginRestrictionStatus;
  reason: LoginRestrictionReason;
  limiterEnabled: boolean;
  policy: "fail_open_without_schedule_with_limited_extensions";
  timeZone: string;
  evaluatedAt: string;
  localDate: string;
  localTime: string;
  previousDate: string;
  activeShift: LoginRestrictionShiftWindow | null;
  referenceShift: LoginRestrictionShiftWindow | null;
  nextShift: LoginRestrictionShiftWindow | null;
  activeExtension: LoginRestrictionActiveExtension | null;
  extensionUsage: LoginRestrictionExtensionUsage;
  nextAllowedAtLocal: string | null;
  allowedUntilLocal: string | null;
  shiftsConsidered: LoginRestrictionShiftWindow[];
};

type LocalDateTimeContext = {
  isoDate: string;
  hhmm: string;
  minutesOfDay: number;
};

type LocalMoment = {
  date: string;
  minutes: number;
};

function parseTimeToMinutes(value: string) {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatMinutesToTime(minutesOfDay: number) {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function nextIsoDate(date: string) {
  return format(addDays(parse(date, "yyyy-MM-dd", new Date()), 1), "yyyy-MM-dd");
}

function previousIsoDate(date: string) {
  return format(addDays(parse(date, "yyyy-MM-dd", new Date()), -1), "yyyy-MM-dd");
}

function shiftDateByOffset(date: string, offsetDays: number) {
  return format(
    addDays(parse(date, "yyyy-MM-dd", new Date()), offsetDays),
    "yyyy-MM-dd"
  );
}

function compareLocalMoments(
  leftDate: string,
  leftMinutes: number,
  rightDate: string,
  rightMinutes: number
) {
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  return leftMinutes - rightMinutes;
}

function normalizeLocalMoment(date: string, minutes: number): LocalMoment {
  if (minutes >= 0 && minutes < 1440) {
    return { date, minutes };
  }

  const dayOffset = Math.floor(minutes / 1440);
  let normalizedMinutes = minutes % 1440;

  if (normalizedMinutes < 0) {
    normalizedMinutes += 1440;
  }

  return {
    date: shiftDateByOffset(date, dayOffset),
    minutes: normalizedMinutes,
  };
}

function formatLocalMoment(date: string, minutes: number) {
  return `${date} ${formatMinutesToTime(minutes)}`;
}

function formatIsoInTimeZone(isoValue: string, timeZone: string) {
  const value = new Date(isoValue);

  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(value);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${getPart("year")}-${getPart("month")}-${getPart("day")} ${getPart("hour")}:${getPart("minute")}`;
}

function getLocalDateTimeContext(at: Date, timeZone: string): LocalDateTimeContext {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(at);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");
  const isoDate = `${year}-${month}-${day}`;
  const hhmm = `${hour}:${minute}`;
  const minutesOfDay = Number(hour) * 60 + Number(minute);

  return { isoDate, hhmm, minutesOfDay };
}

export function getLoginRestrictionProbeDates(at: Date, timeZone: string) {
  const context = getLocalDateTimeContext(at, timeZone);
  return {
    localDate: context.isoDate,
    previousDate: previousIsoDate(context.isoDate),
  };
}

function toShiftWindow(
  shift: LoginRestrictionShiftInput,
  context: LocalDateTimeContext
): LoginRestrictionShiftWindow | null {
  const startMinutes = parseTimeToMinutes(shift.startTime);
  const endMinutes = parseTimeToMinutes(shift.endTime);

  if (shift.type === "day_off") {
    return {
      ...shift,
      source: "schedule",
      spansMidnight: false,
      startMinutes: null,
      endMinutes: null,
      accessStartDate: null,
      accessStartTime: null,
      accessStartMinutes: null,
      endDate: shift.date,
      matchesNow: context.isoDate === shift.date,
      matchesPreShiftToleranceNow: false,
      startsAfterNow: false,
      endedBeforeNow: false,
    };
  }

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const spansMidnight = endMinutes <= startMinutes;
  const endMoment = normalizeLocalMoment(
    shift.date,
    spansMidnight ? endMinutes + 1440 : endMinutes
  );
  const accessStartMoment = normalizeLocalMoment(
    shift.date,
    startMinutes - LOGIN_RESTRICTION_PRE_SHIFT_TOLERANCE_MINUTES
  );

  const matchesNow =
    compareLocalMoments(shift.date, startMinutes, context.isoDate, context.minutesOfDay) <=
      0 &&
    compareLocalMoments(
      endMoment.date,
      endMoment.minutes,
      context.isoDate,
      context.minutesOfDay
    ) > 0;

  const matchesPreShiftToleranceNow =
    compareLocalMoments(
      accessStartMoment.date,
      accessStartMoment.minutes,
      context.isoDate,
      context.minutesOfDay
    ) <= 0 &&
    compareLocalMoments(
      shift.date,
      startMinutes,
      context.isoDate,
      context.minutesOfDay
    ) > 0;

  const startsAfterNow =
    compareLocalMoments(shift.date, startMinutes, context.isoDate, context.minutesOfDay) > 0;
  const endedBeforeNow =
    compareLocalMoments(
      endMoment.date,
      endMoment.minutes,
      context.isoDate,
      context.minutesOfDay
    ) <= 0;

  return {
    ...shift,
    source: "schedule",
    spansMidnight,
    startMinutes,
    endMinutes,
    accessStartDate: accessStartMoment.date,
    accessStartTime: formatMinutesToTime(accessStartMoment.minutes),
    accessStartMinutes: accessStartMoment.minutes,
    endDate: endMoment.date,
    matchesNow,
    matchesPreShiftToleranceNow,
    startsAfterNow,
    endedBeforeNow,
  };
}

function sortByStartAsc(left: LoginRestrictionShiftWindow, right: LoginRestrictionShiftWindow) {
  return compareLocalMoments(
    left.date,
    left.startMinutes ?? 0,
    right.date,
    right.startMinutes ?? 0
  );
}

function sortByStartDesc(left: LoginRestrictionShiftWindow, right: LoginRestrictionShiftWindow) {
  return sortByStartAsc(left, right) * -1;
}

function sortByEndDesc(left: LoginRestrictionShiftWindow, right: LoginRestrictionShiftWindow) {
  return compareLocalMoments(
    left.endDate,
    left.endMinutes ?? 0,
    right.endDate,
    right.endMinutes ?? 0
  ) * -1;
}

function buildExtensionUsage(used: number): LoginRestrictionExtensionUsage {
  return {
    used,
    remaining: Math.max(LOGIN_RESTRICTION_MAX_EXTENSIONS - used, 0),
    max: LOGIN_RESTRICTION_MAX_EXTENSIONS,
    minutesPerExtension: LOGIN_RESTRICTION_EXTENSION_MINUTES,
  };
}

export function evaluateLoginRestriction(params: {
  limiterEnabled: boolean;
  shifts: LoginRestrictionShiftInput[];
  justifications?: LoginRestrictionJustificationInput[];
  at?: Date;
  timeZone?: string;
}): LoginRestrictionEvaluation {
  const at = params.at ?? new Date();
  const timeZone = params.timeZone ?? DEFAULT_LOGIN_ACCESS_TIMEZONE;
  const context = getLocalDateTimeContext(at, timeZone);
  const previousDate = previousIsoDate(context.isoDate);

  const shiftsConsidered = params.shifts
    .filter((shift) => shift.date === context.isoDate || shift.date === previousDate)
    .map((shift) => toShiftWindow(shift, context))
    .filter((shift): shift is LoginRestrictionShiftWindow => shift !== null)
    .sort(sortByStartAsc);

  const baseResult = {
    limiterEnabled: params.limiterEnabled,
    policy: "fail_open_without_schedule_with_limited_extensions" as const,
    timeZone,
    evaluatedAt: at.toISOString(),
    localDate: context.isoDate,
    localTime: context.hhmm,
    previousDate,
    nextShift: null as LoginRestrictionShiftWindow | null,
    activeExtension: null as LoginRestrictionActiveExtension | null,
    extensionUsage: buildExtensionUsage(0),
    nextAllowedAtLocal: null as string | null,
    allowedUntilLocal: null as string | null,
    shiftsConsidered,
  };

  if (!params.limiterEnabled) {
    return {
      ...baseResult,
      status: "unrestricted",
      reason: "disabled",
      activeShift: null,
      referenceShift: null,
    };
  }

  if (shiftsConsidered.length === 0) {
    return {
      ...baseResult,
      status: "allowed",
      reason: "no_schedule_assigned",
      activeShift: null,
      referenceShift: null,
    };
  }

  const workShifts = shiftsConsidered
    .filter((shift) => shift.type === "work")
    .sort(sortByStartAsc);
  const nextShift =
    workShifts.filter((shift) => shift.startsAfterNow).sort(sortByStartAsc)[0] ?? null;

  const activeShift =
    workShifts.filter((shift) => shift.matchesNow).sort(sortByStartDesc)[0] ?? null;

  if (activeShift) {
    return {
      ...baseResult,
      status: "allowed",
      reason: "within_shift",
      activeShift,
      referenceShift: activeShift,
      nextShift,
      allowedUntilLocal:
        activeShift.endMinutes === null
          ? null
          : formatLocalMoment(activeShift.endDate, activeShift.endMinutes),
    };
  }

  const toleranceShift =
    workShifts
      .filter((shift) => shift.matchesPreShiftToleranceNow)
      .sort(sortByStartAsc)[0] ?? null;

  if (toleranceShift) {
    return {
      ...baseResult,
      status: "allowed",
      reason: "pre_shift_tolerance",
      activeShift: null,
      referenceShift: toleranceShift,
      nextShift,
      allowedUntilLocal:
        toleranceShift.endMinutes === null
          ? null
          : formatLocalMoment(toleranceShift.endDate, toleranceShift.endMinutes),
    };
  }

  const hasDayOffToday = shiftsConsidered.some(
    (shift) => shift.type === "day_off" && shift.date === context.isoDate
  );

  if (hasDayOffToday) {
    return {
      ...baseResult,
      status: "blocked",
      reason: "day_off",
      activeShift: null,
      referenceShift: null,
      nextShift,
    };
  }

  const lastCompletedShift =
    workShifts.filter((shift) => shift.endedBeforeNow).sort(sortByEndDesc)[0] ?? null;

  const shouldUseLastCompletedShift =
    lastCompletedShift !== null &&
    (!nextShift || lastCompletedShift.endDate === context.isoDate);

  if (shouldUseLastCompletedShift && lastCompletedShift) {
    const relevantJustifications = (params.justifications ?? [])
      .filter((item) => item.shiftId === lastCompletedShift.id)
      .sort((left, right) => left.sequence - right.sequence);
    const activeExtension = [...relevantJustifications]
      .reverse()
      .find((item) => {
        const grantedUntil = new Date(item.grantedUntil);
        return !Number.isNaN(grantedUntil.getTime()) && grantedUntil.getTime() > at.getTime();
      });
    const extensionUsage = buildExtensionUsage(relevantJustifications.length);

    if (activeExtension) {
      return {
        ...baseResult,
        status: "allowed",
        reason: "after_shift_extension_active",
        activeShift: null,
        referenceShift: lastCompletedShift,
        nextShift,
        activeExtension: {
          justificationId: activeExtension.id,
          sequence: activeExtension.sequence,
          submittedAt: activeExtension.submittedAt,
          grantedUntil: activeExtension.grantedUntil,
          grantedUntilLocal:
            formatIsoInTimeZone(activeExtension.grantedUntil, timeZone) ??
            activeExtension.grantedUntil,
        },
        extensionUsage,
        allowedUntilLocal:
          formatIsoInTimeZone(activeExtension.grantedUntil, timeZone) ??
          activeExtension.grantedUntil,
      };
    }

    return {
      ...baseResult,
      status: "blocked",
      reason:
        relevantJustifications.length >= LOGIN_RESTRICTION_MAX_EXTENSIONS
          ? "after_shift_extension_limit_reached"
          : "after_shift_requires_justification",
      activeShift: null,
      referenceShift: lastCompletedShift,
      nextShift,
      extensionUsage,
      nextAllowedAtLocal:
        nextShift?.accessStartDate && nextShift.accessStartMinutes !== null
          ? formatLocalMoment(nextShift.accessStartDate, nextShift.accessStartMinutes)
          : null,
    };
  }

  if (nextShift?.accessStartDate && nextShift.accessStartMinutes !== null) {
    return {
      ...baseResult,
      status: "blocked",
      reason: "before_shift_too_early",
      activeShift: null,
      referenceShift: nextShift,
      nextShift,
      nextAllowedAtLocal: formatLocalMoment(
        nextShift.accessStartDate,
        nextShift.accessStartMinutes
      ),
    };
  }

  return {
    ...baseResult,
    status: "allowed",
    reason: "no_schedule_assigned",
    activeShift: null,
    referenceShift: null,
    nextShift,
  };
}
