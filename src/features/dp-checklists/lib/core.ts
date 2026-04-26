import { addDays, format, parse } from "date-fns";

import type {
  DPChecklistConditionalRule,
  DPChecklistExecution,
  DPChecklistExecutionItem,
  DPChecklistExecutionSection,
  DPChecklistOccurrenceType,
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
  activeItems: number;
  completedItems: number;
  completionPercent: number;
  requiredItems: number;
  completedRequiredItems: number;
  requiredCompletionPercent: number;
  isComplete: boolean;
  isOverdue: boolean;
  overdueSinceLocal: string | null;
  score: number;
  criticalAlerts: number;
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

export function buildManualChecklistExecutionId(params: {
  date: string;
  templateId: string;
  userId: string;
}) {
  return `manual__${params.date}__${params.templateId}__${params.userId}__${Date.now()}`;
}

export function sortChecklistTemplateItems(items: DPChecklistTemplateItem[]) {
  return [...items].sort((left, right) => left.order - right.order);
}

export function sortChecklistSections(sections: DPChecklistSection[]) {
  return [...sections].sort((left, right) => left.order - right.order);
}

export function countTemplateItems(template: Pick<DPChecklistTemplate, "sections">): number {
  return sortChecklistSections(template.sections).reduce(
    (sum, section) => sum + flattenTemplateItemsWithBranches(section.items, section).length,
    0
  );
}

export function buildChecklistExecutionSections(
  sections: DPChecklistSection[]
): DPChecklistExecutionSection[] {
  return sortChecklistSections(sections).map((section, index) => ({
    id: section.id,
    title: section.title,
    order: typeof section.order === "number" ? section.order : index,
    showIf: section.showIf,
    requirePhoto: section.requirePhoto,
    requireSignature: section.requireSignature,
  }));
}

export function flattenTemplateItemsWithBranches(
  items: DPChecklistTemplateItem[],
  section: Pick<DPChecklistSection, "id" | "title" | "showIf">,
  branchPath: DPChecklistExecutionItem["branchPath"] = [],
  depth = 1
): DPChecklistExecutionItem[] {
  return sortChecklistTemplateItems(items).flatMap((item, index) => {
    const flattenedItem: DPChecklistExecutionItem = {
      templateItemId: item.id,
      sectionId: section.id,
      sectionTitle: section.title,
      order: typeof item.order === "number" ? item.order : index,
      title: item.title,
      description: item.description,
      type: item.type,
      required: item.required,
      weight: item.weight,
      blockNext: item.blockNext,
      criticality: item.criticality,
      referenceValue: item.referenceValue,
      tolerancePercent: item.tolerancePercent,
      actionRequired: item.actionRequired,
      notifyRoleIds: item.notifyRoleIds,
      escalationMinutes: item.escalationMinutes,
      branchPath: [...branchPath],
      showIf: item.showIf,
      sectionShowIf: section.showIf,
      config: item.config,
      checked: item.type === "checkbox" ? null : undefined,
      yesNoValue: item.type === "yes_no" ? null : undefined,
      textValue:
        item.type === "text" || item.type === "select" ? "" : undefined,
      numberValue:
        item.type === "number" || item.type === "temperature"
          ? undefined
          : undefined,
      multiValues: item.type === "multi_select" ? [] : undefined,
      dateValue: item.type === "date" ? "" : undefined,
      photoUrls: item.type === "photo" ? [] : undefined,
      signatureUrl: item.type === "signature" ? undefined : undefined,
      isLate: false,
      isOutOfRange: false,
      completedAt: null,
      completedByUserId: null,
      linkedTaskId: null,
    };

    const branchChildren =
      depth < 4
        ? (item.conditionalBranches ?? []).flatMap((branch) =>
            flattenTemplateItemsWithBranches(
              branch.items,
              section,
              [
                ...(branchPath ?? []),
                {
                  parentItemId: item.id,
                  triggerValue: branch.value,
                },
              ],
              depth + 1
            )
          )
        : [];

    return [flattenedItem, ...branchChildren];
  });
}

export function buildChecklistExecutionItems(
  sections: DPChecklistSection[]
): DPChecklistExecutionItem[] {
  return sortChecklistSections(sections).flatMap((section) =>
    flattenTemplateItemsWithBranches(section.items, section)
  );
}

function isScheduledOccurrence(occurrenceType?: DPChecklistOccurrenceType) {
  return occurrenceType && occurrenceType !== "manual";
}

export function doesTemplateSupportAutomaticGeneration(
  template: Pick<DPChecklistTemplate, "templateType" | "occurrenceType" | "isActive">
) {
  if (!template.isActive) return false;
  if (
    template.templateType !== "routine" &&
    template.templateType !== "audit" &&
    template.templateType !== "maintenance"
  ) {
    return false;
  }

  return isScheduledOccurrence(template.occurrenceType);
}

export function doesTemplateMatchShift(
  template: Pick<
    DPChecklistTemplate,
    | "templateType"
    | "occurrenceType"
    | "unitIds"
    | "shiftDefinitionIds"
    | "jobRoleIds"
    | "jobFunctionIds"
    | "isActive"
  >,
  shift: {
    unitId: string;
    shiftDefinitionId?: string;
    userJobRoleId?: string | null;
    userJobFunctionIds?: string[];
  }
) {
  if (!doesTemplateSupportAutomaticGeneration(template)) return false;

  const matchesUnit =
    !template.unitIds?.length || template.unitIds.includes(shift.unitId);
  if (!matchesUnit) return false;

  if (template.shiftDefinitionIds?.length) {
    if (!shift.shiftDefinitionId) {
      return false;
    }
    if (!template.shiftDefinitionIds.includes(shift.shiftDefinitionId)) {
      return false;
    }
  }

  if (template.jobRoleIds?.length) {
    if (!shift.userJobRoleId || !template.jobRoleIds.includes(shift.userJobRoleId)) {
      return false;
    }
  }

  if (template.jobFunctionIds?.length) {
    const functionIds = new Set(shift.userJobFunctionIds ?? []);
    const hasCompatibleFunction = template.jobFunctionIds.some((id) =>
      functionIds.has(id)
    );
    if (!hasCompatibleFunction) {
      return false;
    }
  }

  return true;
}

export function getExecutionItemAnswer(item: DPChecklistExecutionItem): unknown {
  switch (item.type) {
    case "checkbox":
      return item.checked;
    case "yes_no":
      return item.yesNoValue;
    case "text":
    case "select":
      return item.textValue;
    case "multi_select":
      return item.multiValues;
    case "date":
      return item.dateValue;
    case "number":
    case "temperature":
      return item.numberValue;
    case "photo":
      return item.photoUrls;
    case "signature":
      return item.signatureUrl;
    default:
      return undefined;
  }
}

export function buildExecutionAnswerMap(items: DPChecklistExecutionItem[]) {
  return new Map(items.map((item) => [item.templateItemId, getExecutionItemAnswer(item)]));
}

export function evaluateShowIf(
  rule: DPChecklistConditionalRule,
  answers: Map<string, unknown>
) {
  const actual = answers.get(rule.itemId);

  switch (rule.operator) {
    case "equals":
      return actual === rule.value;
    case "not_equals":
      return actual !== rule.value;
    case "gt":
      return Number(actual) > Number(rule.value);
    case "lt":
      return Number(actual) < Number(rule.value);
    case "contains":
      return Array.isArray(actual) && actual.includes(rule.value);
    default:
      return false;
  }
}

export function isChecklistSectionVisible(
  section: Pick<DPChecklistExecutionSection, "showIf">,
  answers: Map<string, unknown>
) {
  return section.showIf ? evaluateShowIf(section.showIf, answers) : true;
}

export function isChecklistExecutionItemActive(
  item: Pick<
    DPChecklistExecutionItem,
    "branchPath" | "showIf" | "sectionShowIf"
  >,
  answers: Map<string, unknown>
) {
  const branchPath = item.branchPath ?? [];
  const branchMatches = branchPath.every((entry) => {
    const parentAnswer = answers.get(entry.parentItemId);
    return parentAnswer === entry.triggerValue;
  });

  if (!branchMatches) return false;
  if (item.sectionShowIf && !evaluateShowIf(item.sectionShowIf, answers)) return false;
  if (item.showIf && !evaluateShowIf(item.showIf, answers)) return false;
  return true;
}

export function getActiveExecutionItems(
  items: DPChecklistExecutionItem[],
  answers: Map<string, unknown>
) {
  return items.filter((item) => isChecklistExecutionItemActive(item, answers));
}

export function isItemOutOfRange(
  item: Pick<
    DPChecklistExecutionItem,
    "referenceValue" | "tolerancePercent" | "config"
  >,
  value: number
) {
  if (
    typeof item.referenceValue === "number" &&
    typeof item.tolerancePercent === "number"
  ) {
    const margin = Math.abs(item.referenceValue) * (item.tolerancePercent / 100);
    const min = item.referenceValue - margin;
    const max = item.referenceValue + margin;
    return value < min || value > max;
  }

  if (typeof item.config?.min === "number" && value < item.config.min) return true;
  if (typeof item.config?.max === "number" && value > item.config.max) return true;
  return false;
}

export function isChecklistExecutionItemSatisfied(
  item: Pick<
    DPChecklistExecutionItem,
    | "type"
    | "required"
    | "checked"
    | "yesNoValue"
    | "textValue"
    | "numberValue"
    | "multiValues"
    | "dateValue"
    | "photoUrls"
    | "signatureUrl"
  >
) {
  if (!item.required) return true;

  switch (item.type) {
    case "checkbox":
      return item.checked === true;
    case "yes_no":
      return typeof item.yesNoValue === "boolean";
    case "text":
    case "select":
      return typeof item.textValue === "string" && item.textValue.trim().length > 0;
    case "multi_select":
      return Array.isArray(item.multiValues) && item.multiValues.length > 0;
    case "date":
      return typeof item.dateValue === "string" && item.dateValue.trim().length > 0;
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
    | "type"
    | "checked"
    | "yesNoValue"
    | "textValue"
    | "numberValue"
    | "multiValues"
    | "dateValue"
    | "photoUrls"
    | "signatureUrl"
  >
) {
  switch (item.type) {
    case "checkbox":
      return item.checked === true;
    case "yes_no":
      return typeof item.yesNoValue === "boolean";
    case "text":
    case "select":
      return typeof item.textValue === "string" && item.textValue.trim().length > 0;
    case "multi_select":
      return Array.isArray(item.multiValues) && item.multiValues.length > 0;
    case "date":
      return typeof item.dateValue === "string" && item.dateValue.trim().length > 0;
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

export function validateSectionAssetRequirements(
  execution: Pick<DPChecklistExecution, "sections" | "items">
) {
  const answers = buildExecutionAnswerMap(execution.items);
  const activeItems = getActiveExecutionItems(execution.items, answers);
  const errors: string[] = [];

  execution.sections.forEach((section) => {
    if (!isChecklistSectionVisible(section, answers)) return;

    const sectionItems = activeItems.filter((item) => item.sectionId === section.id);
    if (!sectionItems.length) return;

    if (section.requirePhoto) {
      const hasPhoto = sectionItems.some(
        (item) => item.type === "photo" && Array.isArray(item.photoUrls) && item.photoUrls.length > 0
      );
      if (!hasPhoto) {
        errors.push(`A seção "${section.title}" exige pelo menos uma foto.`);
      }
    }

    if (section.requireSignature) {
      const hasSignature = sectionItems.some(
        (item) =>
          item.type === "signature" &&
          typeof item.signatureUrl === "string" &&
          item.signatureUrl.trim().length > 0
      );
      if (!hasSignature) {
        errors.push(`A seção "${section.title}" exige uma assinatura.`);
      }
    }
  });

  return errors;
}

export function isChecklistExecutionReadyToComplete(
  execution: Pick<DPChecklistExecution, "items" | "sections">
) {
  const answers = buildExecutionAnswerMap(execution.items);
  const activeItems = getActiveExecutionItems(execution.items, answers);

  const allSatisfied = activeItems.every(isChecklistExecutionItemSatisfied);
  if (!allSatisfied) return false;

  return validateSectionAssetRequirements(execution).length === 0;
}

function getExecutionItemScorePercent(item: DPChecklistExecutionItem) {
  if (!isChecklistExecutionItemCompleted(item)) return 0;
  if (item.isOutOfRange) return 0;
  return item.isLate ? 50 : 100;
}

export function calculateExecutionScore(
  items: DPChecklistExecutionItem[]
): number {
  const answers = buildExecutionAnswerMap(items);
  const activeItems = getActiveExecutionItems(items, answers);
  const totalWeight = activeItems.reduce((sum, item) => sum + (item.weight ?? 0), 0);
  if (totalWeight === 0) return 100;

  const earnedPoints = activeItems.reduce((sum, item) => {
    const weight = item.weight ?? 0;
    return sum + weight * getExecutionItemScorePercent(item);
  }, 0);

  return Math.round((earnedPoints / (totalWeight * 100)) * 100);
}

export function countExecutionCriticalAlerts(items: DPChecklistExecutionItem[]) {
  const answers = buildExecutionAnswerMap(items);
  const activeItems = getActiveExecutionItems(items, answers);
  return activeItems.filter(
    (item) =>
      item.criticality === "critical" &&
      ((item.type === "checkbox" && item.checked !== true) ||
        item.isOutOfRange === true ||
        (item.type === "yes_no" && item.yesNoValue === false))
  ).length;
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

export function getChecklistExecutionMetrics(params: {
  execution: Pick<
    DPChecklistExecution,
    "status" | "shiftEndDate" | "shiftEndTime" | "items" | "score" | "sections"
  >;
  at?: Date;
  timeZone?: string;
}): ChecklistExecutionMetrics {
  const at = params.at ?? new Date();
  const timeZone = params.timeZone ?? DEFAULT_LOGIN_ACCESS_TIMEZONE;
  const context = getLocalDateTimeContext(at, timeZone);
  const answers = buildExecutionAnswerMap(params.execution.items);
  const activeItems = getActiveExecutionItems(params.execution.items, answers);

  const totalItems = params.execution.items.length;
  const activeCount = activeItems.length;
  const completedItems = activeItems.filter(isChecklistExecutionItemCompleted).length;
  const requiredItems = activeItems.filter((item) => item.required).length;
  const completedRequiredItems = activeItems.filter(
    (item) => item.required && isChecklistExecutionItemSatisfied(item)
  ).length;
  const completionPercent =
    activeCount > 0 ? Math.round((completedItems / activeCount) * 100) : 100;
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
    typeof params.execution.score === "number"
      ? params.execution.score
      : calculateExecutionScore(params.execution.items);

  return {
    timeZone,
    evaluatedAt: at.toISOString(),
    localDate: context.isoDate,
    localTime: context.hhmm,
    totalItems,
    activeItems: activeCount,
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
    criticalAlerts: countExecutionCriticalAlerts(params.execution.items),
  };
}
