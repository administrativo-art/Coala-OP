import type {
  InstagramPublicationFormat,
  InstagramScheduleListItem,
} from "./contracts";
import {
  INSTAGRAM_SCHEDULE_MIN_LEAD_MS,
  isInstagramScheduleEditableStatus,
} from "./schedule-mutation-policy";

export const INSTAGRAM_TIME_ZONE = "America/Belem";

export const formatTheme: Record<InstagramPublicationFormat, {
  label: string;
  dot: string;
  background: string;
  ink: string;
}> = {
  feed_image: { label: "Feed", dot: "#4CBCD6", background: "#DDF3F8", ink: "#217A8F" },
  carousel: { label: "Carrossel", dot: "#F9C430", background: "#FEF1CC", ink: "#4A1A04" },
  reel: { label: "Reels", dot: "#F462A7", background: "#FDE3EF", ink: "#D90F6F" },
  story: { label: "Stories", dot: "#4A1A04", background: "#EFE3D8", ink: "#4A1A04" },
};

export function dateKeyInBelem(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: INSTAGRAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDaysToKey(value: string, amount: number) {
  const date = parseDateKey(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKeyFromUtcDate(date);
}

export function startOfWeekKey(value: string) {
  const date = parseDateKey(value);
  if (!date) return value;
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return dateKeyFromUtcDate(date);
}

export function monthStartKey(value: string) {
  const date = parseDateKey(value);
  if (!date) return value;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function addMonthsToKey(value: string, amount: number) {
  const date = parseDateKey(monthStartKey(value));
  if (!date) return value;
  date.setUTCMonth(date.getUTCMonth() + amount);
  return dateKeyFromUtcDate(date);
}

export function calendarMonthKeys(value: string) {
  const monthStart = monthStartKey(value);
  const gridStart = startOfWeekKey(monthStart);
  const month = parseDateKey(monthStart)?.getUTCMonth();
  const cells = Array.from({ length: 42 }, (_, index) => addDaysToKey(gridStart, index));
  const lastWeekHasMonth = cells.slice(35).some((key) => parseDateKey(key)?.getUTCMonth() === month);
  return lastWeekHasMonth ? cells : cells.slice(0, 35);
}

export function datePartsInBelem(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { hour: "--", minute: "--" };
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: INSTAGRAM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "--";
  return { hour: get("hour"), minute: get("minute") };
}

export function timeInBelem(value: string) {
  const { hour, minute } = datePartsInBelem(value);
  return `${hour}:${minute}`;
}

export function moveScheduleToDate(originalIso: string, dateKey: string) {
  const { hour, minute } = datePartsInBelem(originalIso);
  return `${dateKey}T${hour}:${minute}:00-03:00`;
}

export function scheduleAtInBelem(dateKey: string, time: string) {
  if (!parseDateKey(dateKey) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return "";
  const value = `${dateKey}T${time}:00-03:00`;
  return Number.isNaN(Date.parse(value)) ? "" : value;
}

export function minimumScheduleDateTimeInBelem(now = new Date()) {
  const minimumMillis = now.getTime() + INSTAGRAM_SCHEDULE_MIN_LEAD_MS;
  const roundedToNextMinute = new Date(Math.ceil(minimumMillis / 60_000) * 60_000);
  return {
    date: dateKeyInBelem(roundedToNextMinute),
    time: timeInBelem(roundedToNextMinute.toISOString()),
  };
}

export function shortDate(value: string) {
  const date = parseDateKey(value);
  return date
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date)
    : "";
}

export function longDate(value: string) {
  const date = parseDateKey(value);
  return date
    ? new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }).format(date).replace(".", "")
    : "";
}

export function monthLabel(value: string) {
  const date = parseDateKey(value);
  if (!date) return "";
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function weekLabel(start: string) {
  const end = addDaysToKey(start, 6);
  const first = parseDateKey(start);
  const last = parseDateKey(end);
  if (!first || !last) return "";
  const firstMonth = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(first).replace(".", "");
  const lastMonth = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(last).replace(".", "");
  return `${first.getUTCDate()} ${firstMonth} – ${last.getUTCDate()} ${lastMonth} ${last.getUTCFullYear()}`;
}

export function instagramPostTitle(item: InstagramScheduleListItem) {
  const captionLine = item.caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (captionLine) return captionLine.length > 72 ? `${captionLine.slice(0, 69)}…` : captionLine;
  const fileName = item.media[0]?.fileName?.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return fileName || formatTheme[item.format].label;
}

export function isScheduleEditable(item: InstagramScheduleListItem) {
  return isInstagramScheduleEditableStatus(item.status);
}
