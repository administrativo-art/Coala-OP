import { addDays, format, parse } from "date-fns";

import type {
  DPChecklistExecution,
  DPChecklistExecutionItem,
  DPChecklistSection,
  DPChecklistTemplate,
  DPChecklistTemplateItem,
} from "@/types";
import { DEFAULT_LOGIN_ACCESS_TIMEZONE } from "@/features/hr/lib/login-access";

type ChecklistLocalDateTimeContext = {
  isoDate: string;
  hhmm: string;
  minutesOfDay: number;
};

type ChecklistExecutionMoment = {
  date: string;
  minutes: number;
};

export type ChecklistExecutionMetrics = {
  timeZone: string;
  evaluatedAt: string;
  localDate: string;
  localTime: string;
  totalItems: number;
  completedItems: number;
  completionPercent: number;
  requiredItems: number;
  completedRequiredItems: number;
  requiredCompletionPercent: number;
  isComplete: boolean;
  isOverdue: boolean;
  overdueSinceLocal: string | null;
  score: number;
};

function nextDate(date: string) {
  return format(addDays(parse(date, "yyyy-MM-dd", new Date()), 1), "yyyy-MM-dd");
}

export function parseTimeToMinutes(value: string): number | null {
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

export function compareLocalMoments(
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

export function getLocalDateTimeContext(
  at: Date,
  timeZone: string
): ChecklistLocalDateTimeContext {
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

function formatLocalMoment(moment: ChecklistExecutionMoment) {
  return `${moment.date} ${formatMinutesToTime(moment.minutes)}`;
}

export function resolveShiftEndDate(
  date: string,
  startTime: string,
  endTime: string
) {
  return endTime <= startTime ? nextDate(date) : date;
}

export function buildChecklistExecutionId(params: {
  date: string;
  scheduleId: string;
  shiftId: string;
  templateId: string;
}) {
  return `${params.date}__${params.scheduleId}__${params.shiftId}__${params.templateId}`;
}

export function sortChecklistTemplateItems(items: DPChecklistTemplateItem[]) {
  return [...items].sort((left, right) => left.order - right.order);
}

export function sortChecklistSections(sections: DPChecklistSection[]) {
  return [...sections].sort((left, right) => left.order - right.order);
}

export function countTemplateItems(template: Pick<DPChecklistTemplate, "sections">): number {
  return template.sections.reduce((sum, section) => sum + section.items.length, 0);
}

export function buildChecklistExecutionItems(
  sections: DPChecklistSection[]
): DPChecklistExecutionItem[] {
  return sortChecklistSections(sections).flatMap((section) =>
    sortChecklistTemplateItems(section.items).map((item) => ({
      templateItemId: item.id,
      sectionId: section.id,
      sectionTitle: section.title,
      order: item.order,
      title: item.title,
      description: item.description,
      type: item.type,
      required: item.required,
      weight: item.weight,
      config: item.config,
      checked: item.type === "checkbox" ? false : undefined,
      textValue: item.type === "text" || item.type === "select" ? "" : undefined,
      numberValue:
        item.type === "number" || item.type === "temperature" ? undefined : undefined,
      photoUrls: item.type === "photo" ? [] : undefined,
      signatureUrl: item.type === "signature" ? undefined : undefined,
      isLate: false,
      isOutOfRange: false,
      completedAt: null,
      completedByUserId: null,
    }))
  );
}

export function doesTemplateMatchShift(
  template: Pick<DPChecklistTemplate, "unitIds" | "shiftDefinitionIds" | "isActive">,
  shift: {
    unitId: string;
    shiftDefinitionId?: string;
  }
) {
  if (!template.isActive) return false;

  const matchesUnit =
    !template.unitIds?.length || template.unitIds.includes(shift.unitId);
  if (!matchesUnit) return false;

  if (!template.shiftDefinitionIds?.length) {
    return true;
  }

  if (!shift.shiftDefinitionId) {
    return false;
  }

  return template.shiftDefinitionIds.includes(shift.shiftDefinitionId);
}

export function isChecklistExecutionItemSatisfied(
  item: Pick<
    DPChecklistExecutionItem,
    "type" | "required" | "checked" | "textValue" | "numberValue" | "photoUrls" | "signatureUrl"
  >
) {
  if (!item.required) return true;

  switch (item.type) {
    case "checkbox":
      return item.checked === true;
    case "text":
      return typeof item.textValue === "string" && item.textValue.trim().length > 0;
    case "select":
      return typeof item.textValue === "string" && item.textValue.trim().length > 0;
    case "number":
    case "temperature":
      return typeof item.numberValue === "number" && Number.isFinite(item.numberValue);
    case "photo":
      return Array.isArray(item.photoUrls) && item.photoUrls.length > 0;
    case "signature":
      return typeof item.signatureUrl === "string" && item.signatureUrl.trim().length > 0;
    default:
      return false;
  }
}

export function isChecklistExecutionItemCompleted(
  item: Pick<
    DPChecklistExecutionItem,
    "type" | "checked" | "textValue" | "numberValue" | "photoUrls" | "signatureUrl"
  >
) {
  switch (item.type) {
    case "checkbox":
      return item.checked === true;
    case "text":
    case "select":
      return typeof item.textValue === "string" && item.textValue.trim().length > 0;
    case "number":
    case "temperature":
      return typeof item.numberValue === "number" && Number.isFinite(item.numberValue);
    case "photo":
      return Array.isArray(item.photoUrls) && item.photoUrls.length > 0;
    case "signature":
      return typeof item.signatureUrl === "string" && item.signatureUrl.trim().length > 0;
    default:
      return false;
  }
}

export function isChecklistExecutionReadyToComplete(
  execution: Pick<DPChecklistExecution, "items">
) {
  return execution.items.every(isChecklistExecutionItemSatisfied);
}

export function isAfterShiftEnd(params: {
  now: Date;
  shiftEndDate: string;
  shiftEndTime: string;
  timeZone?: string;
}): boolean {
  const { now, shiftEndDate, shiftEndTime } = params;
  const timeZone = params.timeZone ?? DEFAULT_LOGIN_ACCESS_TIMEZONE;
  const endMinutes = parseTimeToMinutes(shiftEndTime);
  if (endMinutes === null) return false;

  const context = getLocalDateTimeContext(now, timeZone);
  return (
    compareLocalMoments(
      shiftEndDate,
      endMinutes,
      context.isoDate,
      context.minutesOfDay
    ) <= 0
  );
}

export function calculateExecutionScore(
  items: DPChecklistExecutionItem[]
): number {
  const totalWeight = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  if (totalWeight === 0) return 100;

  let earnedPoints = 0;
  for (const item of items) {
    const weight = item.weight ?? 1;
    if (isChecklistExecutionItemCompleted(item)) {
      earnedPoints += item.isLate ? weight * 50 : weight * 100;
    }
  }

  return Math.round((earnedPoints / (totalWeight * 100)) * 100);
}

export function getChecklistExecutionMetrics(params: {
  execution: Pick<
    DPChecklistExecution,
    "status" | "shiftEndDate" | "shiftEndTime" | "items" | "score"
  >;
  at?: Date;
  timeZone?: string;
}): ChecklistExecutionMetrics {
  const at = params.at ?? new Date();
  const timeZone = params.timeZone ?? DEFAULT_LOGIN_ACCESS_TIMEZONE;
  const context = getLocalDateTimeContext(at, timeZone);

  const totalItems = params.execution.items.length;
  const completedItems = params.execution.items.filter(
    isChecklistExecutionItemCompleted
  ).length;
  const requiredItems = params.execution.items.filter((item) => item.required).length;
  const completedRequiredItems = params.execution.items.filter(
    (item) => item.required && isChecklistExecutionItemSatisfied(item)
  ).length;
  const completionPercent =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const requiredCompletionPercent =
    requiredItems > 0
      ? Math.round((completedRequiredItems / requiredItems) * 100)
      : 100;

  const shiftEndMinutes = parseTimeToMinutes(params.execution.shiftEndTime);
  const endMoment: ChecklistExecutionMoment | null =
    shiftEndMinutes === null
      ? null
      : {
          date: params.execution.shiftEndDate,
          minutes: shiftEndMinutes,
        };

  const isOverdue =
    params.execution.status !== "completed" &&
    params.execution.status !== "overdue" &&
    endMoment !== null &&
    compareLocalMoments(
      endMoment.date,
      endMoment.minutes,
      context.isoDate,
      context.minutesOfDay
    ) <= 0;

  const effectiveIsOverdue = params.execution.status === "overdue" || isOverdue;

  const score =
    params.execution.score !== undefined && params.execution.score !== null
      ? params.execution.score
      : params.execution.status === "completed"
        ? calculateExecutionScore(params.execution.items)
        : completionPercent;

  return {
    timeZone,
    evaluatedAt: at.toISOString(),
    localDate: context.isoDate,
    localTime: context.hhmm,
    totalItems,
    completedItems,
    completionPercent,
    requiredItems,
    completedRequiredItems,
    requiredCompletionPercent,
    isComplete: params.execution.status === "completed",
    isOverdue: effectiveIsOverdue,
    overdueSinceLocal:
      effectiveIsOverdue && endMoment
        ? formatLocalMoment(endMoment)
        : null,
    score,
  };
}
