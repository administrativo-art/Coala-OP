import "server-only";

import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";

import type {
  InstagramInsightContentItem,
  InstagramInsightContentSnapshot,
  InstagramInsightsDays,
  InstagramInsightsHistory,
  InstagramInsightStoredDay,
  InstagramInsightTotals,
} from "./contracts";

const accountCollection = dbAdmin.collection("instagramAccountInsightsDaily");
const storyCollection = dbAdmin.collection("instagramStoryInsightSnapshots");
const contentCollection = dbAdmin.collection("instagramContentInsightSnapshots");

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value : "";
}

function httpsOrNull(value: unknown) {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

function timestampIso(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function totals(data: Record<string, unknown>): InstagramInsightTotals {
  return {
    views: numberOrNull(data.views),
    reach: numberOrNull(data.reach),
    accountsEngaged: numberOrNull(data.accountsEngaged),
    totalInteractions: numberOrNull(data.totalInteractions),
    likes: numberOrNull(data.likes),
    comments: numberOrNull(data.comments),
    shares: numberOrNull(data.shares),
    saves: numberOrNull(data.saves),
    replies: numberOrNull(data.replies),
    reposts: numberOrNull(data.reposts),
    follows: numberOrNull(data.follows),
    unfollows: numberOrNull(data.unfollows),
  };
}

function storyItem(id: string, data: Record<string, unknown>): InstagramInsightContentItem | null {
  const publishedAt = timestampIso(data.publishedAt);
  if (!publishedAt) return null;
  return {
    id,
    format: "Story",
    caption: stringOrEmpty(data.caption),
    previewUrl: null,
    permalink: httpsOrNull(data.permalink),
    publishedAt,
    views: numberOrNull(data.views),
    reach: numberOrNull(data.reach),
    totalInteractions: null,
    likes: null,
    comments: null,
    shares: numberOrNull(data.shares),
    saves: null,
    replies: numberOrNull(data.replies),
    bioLinkClicks: numberOrNull(data.bioLinkClicks),
    storyLinkClicks: numberOrNull(data.storyLinkClicks),
  };
}

function contentItem(id: string, data: Record<string, unknown>): InstagramInsightContentSnapshot | null {
  const publishedAt = timestampIso(data.publishedAt);
  const stage = data.stage;
  if (!publishedAt || !["first48h", "day7", "day30"].includes(String(stage))) return null;
  const format = data.format === "Reel" || data.format === "Carrossel" ? data.format : "Feed";
  return {
    id,
    stage: stage as InstagramInsightContentSnapshot["stage"],
    format,
    caption: stringOrEmpty(data.caption),
    previewUrl: null,
    permalink: httpsOrNull(data.permalink),
    publishedAt,
    views: numberOrNull(data.views),
    reach: numberOrNull(data.reach),
    totalInteractions: numberOrNull(data.totalInteractions),
    likes: numberOrNull(data.likes),
    comments: numberOrNull(data.comments),
    shares: numberOrNull(data.shares),
    saves: numberOrNull(data.saves),
    replies: null,
    bioLinkClicks: null,
    storyLinkClicks: null,
  };
}

export async function fetchInstagramInsightsHistory(days: InstagramInsightsDays): Promise<InstagramInsightsHistory> {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 24 * 60 * 60 * 1_000);
  const publishedSince = Timestamp.fromDate(since);
  const [accountSnapshots, storySnapshots, contentSnapshots] = await Promise.all([
    accountCollection
      .where(FieldPath.documentId(), ">=", dateKey(since))
      .where(FieldPath.documentId(), "<=", dateKey(until))
      .orderBy(FieldPath.documentId())
      .limit(days)
      .get(),
    storyCollection
      .where("publishedAt", ">=", publishedSince)
      .orderBy("publishedAt", "desc")
      .limit(50)
      .get(),
    contentCollection
      .where("publishedAt", ">=", publishedSince)
      .orderBy("publishedAt", "desc")
      .limit(50)
      .get(),
  ]);

  const daily: InstagramInsightStoredDay[] = accountSnapshots.docs.map((snapshot) => {
    const data = snapshot.data();
    return {
      date: snapshot.id,
      followersCount: numberOrNull(data.followersCount),
      mediaCount: numberOrNull(data.mediaCount),
      settled: data.settled === true,
      totals: totals(data),
    };
  });

  return {
    daily,
    stories: storySnapshots.docs.flatMap((snapshot) => {
      const item = storyItem(snapshot.id, snapshot.data());
      return item ? [item] : [];
    }),
    contentSnapshots: contentSnapshots.docs.flatMap((snapshot) => {
      const data = snapshot.data();
      const sourceId = typeof data.id === "string" ? data.id : snapshot.id;
      const item = contentItem(`${sourceId}_${String(data.stage)}`, data);
      return item ? [item] : [];
    }),
  };
}
