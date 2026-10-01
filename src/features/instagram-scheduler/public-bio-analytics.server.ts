import "server-only";

import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { dbAdmin } from "@/lib/firebase-admin";
import { publicBioProjection } from "@/lib/public-bio";

import type { InstagramInsightsDays, PublicBioAnalyticsReport } from "./contracts";

const collection = dbAdmin.collection("publicBioAnalyticsDaily");

export const publicBioAnalyticsEventSchema = z.object({
  event: z.enum(["page_view", "link_click", "gallery_open"]),
  linkId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  placement: z.enum([
    "page",
    "header",
    "hero",
    "mobile",
    "promotion",
    "unit",
    "extra",
  ]).optional(),
}).strict().superRefine((value, context) => {
  if (value.event !== "page_view" && !value.linkId) {
    context.addIssue({ code: "custom", path: ["linkId"], message: "Informe o link acionado." });
  }
});

export type PublicBioAnalyticsEvent = z.infer<typeof publicBioAnalyticsEventSchema>;

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

function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export async function recordPublicBioAnalyticsEvent(event: PublicBioAnalyticsEvent) {
  const today = dateKey(new Date());
  const increments: Record<string, unknown> = {
    date: today,
    schemaVersion: 1,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (event.event === "page_view") increments.pageViews = FieldValue.increment(1);
  if (event.event === "link_click" || event.event === "gallery_open") increments.linkClicks = FieldValue.increment(1);
  if (event.event === "gallery_open") increments.galleryOpens = FieldValue.increment(1);
  if (event.linkId) increments[`link_${event.linkId}`] = FieldValue.increment(1);
  if (event.placement) increments[`placement_${event.placement}`] = FieldValue.increment(1);
  await collection.doc(today).set(increments, { merge: true });
}

export async function fetchPublicBioAnalytics(days: InstagramInsightsDays): Promise<PublicBioAnalyticsReport> {
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 24 * 60 * 60 * 1_000);
  const [snapshots, settings] = await Promise.all([
    collection
      .where(FieldPath.documentId(), ">=", dateKey(since))
      .where(FieldPath.documentId(), "<=", dateKey(until))
      .orderBy(FieldPath.documentId())
      .limit(days)
      .get(),
    dbAdmin.collection("public_site_settings").doc("coala-bio").get(),
  ]);

  const page = publicBioProjection(settings.get("published"));
  const labels = new Map(page?.links.map((link) => [link.id, link.label]) ?? []);
  const linkTotals = new Map<string, number>();
  let pageViews = 0;
  let linkClicks = 0;
  let galleryOpens = 0;
  const daily = snapshots.docs.map((snapshot) => {
    const data = snapshot.data();
    const dayPageViews = count(data.pageViews);
    const dayLinkClicks = count(data.linkClicks);
    pageViews += dayPageViews;
    linkClicks += dayLinkClicks;
    galleryOpens += count(data.galleryOpens);
    Object.entries(data).forEach(([key, value]) => {
      if (!key.startsWith("link_")) return;
      const id = key.slice(5);
      linkTotals.set(id, (linkTotals.get(id) ?? 0) + count(value));
    });
    return { date: snapshot.id, pageViews: dayPageViews, linkClicks: dayLinkClicks };
  });

  return {
    pageViews,
    linkClicks,
    galleryOpens,
    clickThroughRate: pageViews > 0 ? linkClicks / pageViews : null,
    daily,
    topLinks: [...linkTotals.entries()]
      .map(([id, clicks]) => ({ id, label: labels.get(id) ?? id, clicks }))
      .sort((left, right) => right.clicks - left.clicks)
      .slice(0, 8),
  };
}
