import "server-only";

import type { DocumentSnapshot, Timestamp } from "firebase-admin/firestore";

import {
  instagramPublicationFormats,
  instagramPublicationStatuses,
  type InstagramPublicationFormat,
  type InstagramPublicationStatus,
  type InstagramScheduleListItem,
} from "./contracts";

function iso(value: unknown): string | null {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function format(value: unknown): InstagramPublicationFormat {
  return instagramPublicationFormats.includes(value as InstagramPublicationFormat)
    ? (value as InstagramPublicationFormat)
    : "feed_image";
}

function status(value: unknown): InstagramPublicationStatus {
  return instagramPublicationStatuses.includes(value as InstagramPublicationStatus)
    ? (value as InstagramPublicationStatus)
    : "failed";
}

export function serializeInstagramSchedule(doc: DocumentSnapshot): InstagramScheduleListItem {
  const data = doc.data() ?? {};
  const media = Array.isArray(data.media) ? data.media : [];

  return {
    id: doc.id,
    format: format(data.format),
    status: status(data.status),
    scheduledAt: iso(data.scheduledAt) ?? "",
    caption: typeof data.caption === "string" ? data.caption : "",
    media: media.slice(0, 10).map((item, index) => ({
      kind: item?.kind === "video" ? "video" : "image",
      fileName: typeof item?.fileName === "string" ? item.fileName : "mídia",
      contentType: typeof item?.contentType === "string" ? item.contentType : "application/octet-stream",
      sizeBytes: typeof item?.sizeBytes === "number" ? item.sizeBytes : 0,
      width: typeof item?.width === "number" ? item.width : null,
      height: typeof item?.height === "number" ? item.height : null,
      previewUrl:
        item?.kind === "image" && typeof item?.objectPath === "string"
          ? `/api/integrations/instagram/schedule/${encodeURIComponent(doc.id)}/media/${index}`
          : null,
    })),
    shareToFeed: data.shareToFeed !== false,
    location:
      typeof data.location?.id === "string" && typeof data.location?.name === "string"
        ? { id: data.location.id, name: data.location.name }
        : null,
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    publishedAt: iso(data.publishedAt),
    permalink: typeof data.permalink === "string" ? data.permalink : null,
    safeError: typeof data.safeError === "string" ? data.safeError : null,
    errorEventId: typeof data.errorEventId === "string" ? data.errorEventId : null,
    createdAt: iso(data.createdAt) ?? "",
  };
}
