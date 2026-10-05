import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";

import type { ServerUserContext } from "@/lib/auth-server";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import {
  certifyInstagramPublication,
  type InstagramPublicationReadiness,
} from "@/features/instagram-scheduler/publication-readiness";

import {
  buildInstagramPostFolderPath,
  expectedInstagramPostConfirmation,
  type InstagramPostActionInput,
  type InstagramPostCreateInput,
  type InstagramPostUpdateInput,
} from "./contracts";
import { serializeInstagramPost } from "./serialize.server";

const POSTS = "instagramPosts";
const SCHEDULES = "instagramScheduledPosts";
const DEFAULT_INSTAGRAM_ACCOUNT_ID = "17841476184089270";

function fail(code: string, kind: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "AUTHORIZATION", safeMessage: string): never {
  throw new AppError({ code, kind, safeMessage, reportable: false });
}

function actorOf(context: ServerUserContext, source = "marketing-cli") {
  return {
    source,
    uid: context.decoded.uid,
    email: context.decoded.email ?? context.userDoc.email ?? null,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function instagramPostContentHash(data: DocumentData) {
  const payload = {
    title: data.title ?? "",
    format: data.format ?? "feed_image",
    direction: data.direction ?? "",
    caption: data.caption ?? "",
    shareToFeed: data.shareToFeed !== false,
    storyMentions: data.storyMentions ?? [],
    publicationMode: data.publicationMode ?? "automatic",
    manualInstructions: data.manualInstructions ?? "",
    media: (Array.isArray(data.media) ? data.media : []).map((item: DocumentData) => ({
      id: item.id,
      kind: item.kind,
      sha256: item.sha256,
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
    })),
  };
  return `sha256:${createHash("sha256").update(stable(payload)).digest("hex")}`;
}

function resetApprovals(next: DocumentData, previousHash: string | undefined) {
  const contentHash = instagramPostContentHash(next);
  if (contentHash === previousHash) return { contentHash };
  return {
    contentHash,
    contentApproval: { status: "pending" },
    publicationApproval: { status: "pending" },
    publicationCertification: FieldValue.delete(),
  };
}

function requireWorkspacePost(snapshot: DocumentSnapshot, workspaceId: string) {
  if (!snapshot.exists || snapshot.data()?.workspace_id !== workspaceId) {
    fail("INSTAGRAM_POST_NOT_FOUND", "NOT_FOUND", "Post não encontrado.");
  }
  return snapshot.data()!;
}

export async function createInstagramPost(context: ServerUserContext, input: InstagramPostCreateInput) {
  const ref = marketingDbAdmin.collection(POSTS).doc(input.clientMutationId);
  const actor = actorOf(context);
  const createInputHash = `sha256:${createHash("sha256").update(stable(input)).digest("hex")}`;
  await marketingDbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.exists) {
      if (current.data()?.workspace_id === context.workspace_id && current.data()?.createInputHash === createInputHash) return;
      fail("INSTAGRAM_POST_IDEMPOTENCY_CONFLICT", "CONFLICT", "O identificador desta criação já foi usado.");
    }
    const now = Timestamp.now();
    const base = {
      workspace_id: context.workspace_id,
      clientMutationId: input.clientMutationId,
      createInputHash,
      title: input.title,
      format: input.format,
      status: input.status,
      placement: input.placement,
      folderPath: buildInstagramPostFolderPath(ref.id, input),
      direction: input.direction,
      caption: input.caption,
      shareToFeed: input.shareToFeed,
      storyMentions: input.storyMentions,
      publicationMode: input.publicationMode,
      manualInstructions: input.manualInstructions,
      media: [],
      contentApproval: { status: "pending" },
      publicationApproval: { status: "pending" },
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
    };
    transaction.create(ref, { ...base, contentHash: instagramPostContentHash(base) });
  });
  return serializeInstagramPost(await ref.get());
}

export async function updateInstagramPost(
  context: ServerUserContext,
  id: string,
  changes: InstagramPostUpdateInput,
) {
  const ref = marketingDbAdmin.collection(POSTS).doc(id);
  const actor = actorOf(context);
  await marketingDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = requireWorkspacePost(snapshot, context.workspace_id);
    if (!["planned", "produced"].includes(current.status)) {
      fail("INSTAGRAM_POST_PROTECTED", "CONFLICT", "Posts programados ou publicados não podem ser editados por esta operação.");
    }
    const next: DocumentData = { ...current, ...changes };
    if (changes.status === "produced") {
      if (!String(next.direction ?? "").trim()) {
        fail("INSTAGRAM_POST_DIRECTION_REQUIRED", "VALIDATION", "Preencha o Direcionamento antes de marcar como Produzido.");
      }
      if (!Array.isArray(next.media) || next.media.length === 0) {
        fail("INSTAGRAM_POST_MEDIA_REQUIRED", "VALIDATION", "Envie ao menos uma mídia antes de marcar como Produzido.");
      }
      if (next.format !== "story" && !String(next.caption ?? "").trim()) {
        fail("INSTAGRAM_POST_CAPTION_REQUIRED", "VALIDATION", "Preencha a legenda antes de marcar como Produzido.");
      }
      requireCertifiedMedia(next, "marcar como Produzido");
    }
    const now = Timestamp.now();
    const approvalChanges = changes.status === "planned" && current.status !== "planned"
      ? {
          contentHash: instagramPostContentHash(next),
          contentApproval: { status: "pending" },
          publicationApproval: { status: "pending" },
          publicationCertification: FieldValue.delete(),
        }
      : resetApprovals(next, current.contentHash);
    transaction.update(ref, {
      ...changes,
      ...approvalChanges,
      version: (typeof current.version === "number" ? current.version : 1) + 1,
      updatedAt: now,
      updatedBy: actor,
    });
    transaction.set(ref.collection("events").doc(randomUUID()), {
      type: "content_updated",
      changedFields: Object.keys(changes).sort(),
      actor,
      createdAt: now,
    });
  });
  return serializeInstagramPost(await ref.get());
}

function requireAuthority(context: ServerUserContext) {
  if (!context.isDefaultAdmin) {
    fail("INSTAGRAM_POST_AUTHORITY_REQUIRED", "AUTHORIZATION", "Esta ação exige a autorização explícita de Tiago.");
  }
}

function approvalMatches(data: DocumentData, field: "contentApproval" | "publicationApproval") {
  const approval = data[field];
  return approval?.status === "approved" && approval?.artifactSha256 === data.contentHash;
}

function mediaReadiness(data: DocumentData): InstagramPublicationReadiness {
  const media = Array.isArray(data.media) ? data.media : [];
  return certifyInstagramPublication({ format: data.format, media });
}

function requireCertifiedMedia(data: DocumentData, action: string) {
  const readiness = mediaReadiness(data);
  if (readiness.status !== "certified") {
    const first = readiness.issues[0]?.message ?? "A mídia não atende aos requisitos do Instagram.";
    fail("INSTAGRAM_POST_MEDIA_NOT_CERTIFIED", "VALIDATION", `Não é possível ${action}: ${first}`);
  }
  return readiness;
}

export async function actOnInstagramPost(
  context: ServerUserContext,
  id: string,
  input: InstagramPostActionInput,
) {
  requireAuthority(context);
  const ref = marketingDbAdmin.collection(POSTS).doc(id);
  const actor = actorOf(context);
  await marketingDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = requireWorkspacePost(snapshot, context.workspace_id);
    const expected = expectedInstagramPostConfirmation({
      action: input.action,
      postId: id,
      contentHash: current.contentHash,
      scheduledAt: input.action === "schedule" ? input.scheduledAt : undefined,
    });
    if (input.authorization.confirmation !== expected) {
      fail("INSTAGRAM_POST_CONFIRMATION_MISMATCH", "AUTHORIZATION", `Confirmação inválida. Use exatamente: ${expected}`);
    }

    const now = Timestamp.now();
    const authorizedExecution = {
      authorizedBy: actor,
      executedBy: actor,
      statement: input.authorization.statement,
      confirmedAt: now,
    };
    const eventRef = ref.collection("events").doc(randomUUID());

    if (input.action === "approve_content") {
      if (current.status !== "produced") fail("INSTAGRAM_POST_NOT_PRODUCED", "CONFLICT", "Marque o post como Produzido antes da aprovação.");
      requireCertifiedMedia(current, "aprovar o conteúdo");
      transaction.update(ref, {
        contentApproval: {
          status: "approved",
          artifactSha256: current.contentHash,
          approvedAt: now,
          approvedBy: actor,
          authorization: authorizedExecution,
        },
        updatedAt: now,
        updatedBy: actor,
      });
      transaction.create(eventRef, { type: input.action, contentHash: current.contentHash, ...authorizedExecution, createdAt: now });
      return;
    }

    if (!approvalMatches(current, "contentApproval")) {
      fail("INSTAGRAM_POST_CONTENT_APPROVAL_REQUIRED", "CONFLICT", "A aprovação de conteúdo válida é obrigatória.");
    }

    if (input.action === "approve_publication") {
      if (current.status !== "produced") {
        fail("INSTAGRAM_POST_NOT_PRODUCED", "CONFLICT", "Somente um post Produzido pode receber aprovação de publicação.");
      }
      transaction.update(ref, {
        publicationApproval: {
          status: "approved",
          artifactSha256: current.contentHash,
          approvedAt: now,
          approvedBy: actor,
          authorization: authorizedExecution,
        },
        updatedAt: now,
        updatedBy: actor,
      });
      transaction.create(eventRef, { type: input.action, contentHash: current.contentHash, ...authorizedExecution, createdAt: now });
      return;
    }

    if (input.action === "cancel") {
      if (current.status !== "scheduled" || !current.schedule?.scheduleId) {
        fail("INSTAGRAM_POST_NOT_SCHEDULED", "CONFLICT", "Somente um post programado pode ser cancelado.");
      }
      const scheduleRef = marketingDbAdmin.collection(SCHEDULES).doc(current.schedule.scheduleId);
      const targetRef = current.schedule.mode === "manual"
        ? marketingDbAdmin.collection("instagramManualPublicationReminders").doc(current.schedule.scheduleId)
        : scheduleRef;
      const schedule = await transaction.get(targetRef);
      if (schedule.exists && schedule.data()?.workspace_id === context.workspace_id) {
        transaction.update(targetRef, {
          status: "cancelled",
          wakeAt: FieldValue.delete(),
          nextAttemptAt: FieldValue.delete(),
          cancelledAt: now,
          cancelledBy: actor,
          updatedAt: now,
        });
      }
      transaction.update(ref, {
        status: "produced",
        schedule: FieldValue.delete(),
        updatedAt: now,
        updatedBy: actor,
      });
      transaction.create(eventRef, { type: input.action, scheduleId: current.schedule.scheduleId, ...authorizedExecution, createdAt: now });
      return;
    }

    if (!approvalMatches(current, "publicationApproval")) {
      fail("INSTAGRAM_POST_PUBLICATION_APPROVAL_REQUIRED", "CONFLICT", "A aprovação de publicação válida é obrigatória.");
    }
    if (!["produced", "scheduled"].includes(current.status)) {
      fail("INSTAGRAM_POST_NOT_READY", "CONFLICT", "Somente um post Produzido ou Programado pode ser agendado ou publicado.");
    }
    if (current.status === "published") fail("INSTAGRAM_POST_ALREADY_PUBLISHED", "CONFLICT", "O post já foi publicado.");
    const readiness = requireCertifiedMedia(current, input.action === "schedule" ? "agendar" : "publicar");
    const publicationCertification = {
      ...readiness,
      contentHash: current.contentHash,
      checkedAt: now,
      checkedBy: actor,
    };

    const scheduledDate = input.action === "publish" ? new Date() : new Date(input.scheduledAt);
    if (input.action === "schedule" && scheduledDate.getTime() < Date.now() + 120_000) {
      fail("INSTAGRAM_POST_SCHEDULE_TOO_SOON", "VALIDATION", "Escolha um horário com pelo menos dois minutos de antecedência.");
    }
    const scheduledAt = Timestamp.fromDate(scheduledDate);
    const timezone = input.action === "schedule" ? input.timezone : "America/Belem";

    if (current.publicationMode === "manual") {
      const reminderRef = marketingDbAdmin.collection("instagramManualPublicationReminders").doc(id);
      transaction.set(reminderRef, {
        workspace_id: context.workspace_id,
        editorialPostId: id,
        status: "scheduled",
        scheduledAt,
        wakeAt: scheduledAt,
        instructions: current.manualInstructions ?? "",
        publicationCertification,
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
      }, { merge: true });
      transaction.update(ref, {
        status: "scheduled",
        schedule: { at: scheduledAt, timezone, scheduleId: id, mode: "manual" },
        publicationCertification,
        updatedAt: now,
        updatedBy: actor,
      });
      transaction.create(eventRef, { type: input.action, mode: "manual", scheduledAt, ...authorizedExecution, createdAt: now });
      return;
    }

    const scheduleRef = marketingDbAdmin.collection(SCHEDULES).doc(id);
    const existingSchedule = await transaction.get(scheduleRef);
    if (existingSchedule.exists && ["processing", "published", "manual_review"].includes(existingSchedule.data()?.status)) {
      fail("INSTAGRAM_POST_SCHEDULE_PROTECTED", "CONFLICT", "O trabalho de publicação já iniciou e não pode ser substituído.");
    }
    const media = current.media.map((item: DocumentData) => ({
      id: item.id,
      kind: item.kind,
      contentType: item.contentType,
      fileName: item.fileName,
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
      objectPath: item.objectPath,
      deliveryUrl: item.deliveryUrl,
    }));
    transaction.set(scheduleRef, {
      workspace_id: context.workspace_id,
      editorialPostId: id,
      instagramAccountId: process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID,
      format: current.format,
      status: "scheduled",
      scheduledAt,
      nextAttemptAt: scheduledAt,
      wakeAt: scheduledAt,
      caption: current.caption,
      shareToFeed: current.shareToFeed !== false,
      storyMentions: current.storyMentions ?? [],
      location: current.location ?? null,
      media,
      attempts: 0,
      contentHash: current.contentHash,
      publicationCertification,
      authorization: authorizedExecution,
      createdAt: existingSchedule.exists ? existingSchedule.data()?.createdAt ?? now : now,
      updatedAt: now,
      createdBy: existingSchedule.exists ? existingSchedule.data()?.createdBy ?? actor : actor,
      updatedBy: actor,
    });
    transaction.update(ref, {
      status: "scheduled",
      schedule: { at: scheduledAt, timezone, scheduleId: scheduleRef.id, mode: "automatic" },
      publicationCertification,
      updatedAt: now,
      updatedBy: actor,
    });
    transaction.create(eventRef, { type: input.action, mode: "automatic", scheduledAt, scheduleId: scheduleRef.id, ...authorizedExecution, createdAt: now });
  });
  return serializeInstagramPost(await ref.get());
}

export async function getInstagramPost(context: ServerUserContext, id: string) {
  const snapshot = await marketingDbAdmin.collection(POSTS).doc(id).get();
  requireWorkspacePost(snapshot, context.workspace_id);
  return serializeInstagramPost(snapshot);
}
