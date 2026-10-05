import "server-only";

import type { DocumentSnapshot, Timestamp } from "firebase-admin/firestore";

import { certifyInstagramPublication } from "@/features/instagram-scheduler/publication-readiness";

function iso(value: unknown): string | null {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  return typeof value === "string" ? value : null;
}

export function serializeInstagramPost(doc: DocumentSnapshot) {
  const data = doc.data() ?? {};
  const approval = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return {
      status: record.status === "approved" ? "approved" : "pending",
      approvedAt: iso(record.approvedAt),
      approvedBy: record.approvedBy ?? null,
      artifactSha256: typeof record.artifactSha256 === "string" ? record.artifactSha256 : null,
    };
  };

  const media = Array.isArray(data.media) ? data.media.map((item: Record<string, unknown>) => ({
    id: item.id,
    kind: item.kind,
    fileName: item.fileName,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    width: item.width ?? null,
    height: item.height ?? null,
    durationSeconds: item.durationSeconds ?? null,
    videoCodec: item.videoCodec ?? null,
    audioCodec: item.audioCodec ?? null,
    frameRate: item.frameRate ?? null,
    videoBitrateBps: item.videoBitrateBps ?? null,
    audioSampleRateHz: item.audioSampleRateHz ?? null,
    fastStart: item.fastStart ?? null,
    hasEditList: item.hasEditList ?? null,
    sha256: item.sha256,
    previewUrl: item.id ? `/api/integrations/instagram/posts/${encodeURIComponent(doc.id)}/media/${encodeURIComponent(String(item.id))}` : null,
  })) : [];
  const publicationReadiness = certifyInstagramPublication({
    format: data.format ?? "feed_image",
    media,
  });

  return {
    id: doc.id,
    title: data.title ?? "",
    format: data.format ?? "feed_image",
    status: data.status ?? "planned",
    approvalStatus: data.contentApproval?.status === "approved" ? "approved" : "pending",
    placement: data.placement ?? null,
    folderPath: data.folderPath ?? "",
    direction: data.direction ?? "",
    caption: data.caption ?? "",
    shareToFeed: data.shareToFeed !== false,
    storyMentions: Array.isArray(data.storyMentions) ? data.storyMentions : [],
    publicationMode: data.publicationMode === "manual" ? "manual" : "automatic",
    manualInstructions: data.manualInstructions ?? "",
    media,
    publicationReadiness,
    publicationCertification: data.publicationCertification ? {
      status: data.publicationCertification.status ?? "blocked",
      rulesVersion: data.publicationCertification.rulesVersion ?? null,
      contentHash: data.publicationCertification.contentHash ?? null,
      checkedAt: iso(data.publicationCertification.checkedAt),
      checkedBy: data.publicationCertification.checkedBy ?? null,
      issues: Array.isArray(data.publicationCertification.issues) ? data.publicationCertification.issues : [],
    } : null,
    contentHash: data.contentHash ?? "",
    contentApproval: approval(data.contentApproval),
    publicationApproval: approval(data.publicationApproval),
    schedule: data.schedule ? {
      at: iso(data.schedule.at),
      timezone: data.schedule.timezone ?? "America/Belem",
      scheduleId: data.schedule.scheduleId ?? null,
    } : null,
    publicationResult: data.publicationResult ? {
      instagramMediaId: data.publicationResult.instagramMediaId ?? null,
      instagramMediaIds: data.publicationResult.instagramMediaIds ?? [],
      permalink: data.publicationResult.permalink ?? null,
      publishedAt: iso(data.publicationResult.publishedAt),
      status: data.publicationResult.status ?? null,
      safeError: data.publicationResult.safeError ?? null,
    } : null,
    version: typeof data.version === "number" ? data.version : 1,
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}
