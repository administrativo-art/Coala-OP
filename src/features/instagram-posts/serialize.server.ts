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
    id: String(item.id ?? ""),
    kind: String(item.kind ?? ""),
    fileName: String(item.fileName ?? ""),
    contentType: typeof item.contentType === "string" ? item.contentType : null,
    sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : null,
    width: typeof item.width === "number" ? item.width : null,
    height: typeof item.height === "number" ? item.height : null,
    durationSeconds: typeof item.durationSeconds === "number" ? item.durationSeconds : null,
    videoCodec: typeof item.videoCodec === "string" ? item.videoCodec : null,
    audioCodec: typeof item.audioCodec === "string" ? item.audioCodec : null,
    frameRate: typeof item.frameRate === "number" ? item.frameRate : null,
    videoBitrateBps: typeof item.videoBitrateBps === "number" ? item.videoBitrateBps : null,
    audioSampleRateHz: typeof item.audioSampleRateHz === "number" ? item.audioSampleRateHz : null,
    fastStart: typeof item.fastStart === "boolean" ? item.fastStart : null,
    hasEditList: typeof item.hasEditList === "boolean" ? item.hasEditList : null,
    sha256: typeof item.sha256 === "string" ? item.sha256 : null,
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
    planning: {
      designRationale: typeof data.planning?.designRationale === "string" ? data.planning.designRationale : "",
      formatRationale: typeof data.planning?.formatRationale === "string" ? data.planning.formatRationale : "",
      objective: typeof data.planning?.objective === "string" ? data.planning.objective : null,
      callToAction: typeof data.planning?.callToAction === "string" ? data.planning.callToAction : "",
      plannedAt: iso(data.planning?.plannedAt),
      updatedAt: iso(data.planning?.updatedAt),
    },
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
      mode: data.schedule.mode === "manual" ? "manual" : "automatic",
    } : null,
    manualReminder: data.manualReminder?.status === "due" ? {
      status: "due",
      notifiedAt: iso(data.manualReminder.notifiedAt),
      instructions: data.manualReminder.instructions ?? "",
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
