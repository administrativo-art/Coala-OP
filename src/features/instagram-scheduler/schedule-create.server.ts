import "server-only";

import { randomUUID } from "node:crypto";

import { getStorage } from "firebase-admin/storage";
import { Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";

import type { ServerUserContext } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";

import {
  instagramScheduleInputSchema,
  type InstagramPublicationFormat,
} from "./contracts";
import { certifyInstagramPublication } from "./publication-readiness";
import {
  detectInstagramLibraryMedia,
  INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES,
  INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES,
  safeInstagramLibraryFileName,
} from "./media-validation";
import { serializeInstagramSchedule } from "./serialize.server";

const DEFAULT_INSTAGRAM_ACCOUNT_ID = "17841476184089270";

type PreparedMedia = {
  buffer: Buffer;
  kind: "image" | "video";
  contentType: string;
  extension: string;
  fileName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
  videoBitrateBps: number | null;
  audioSampleRateHz: number | null;
  fastStart: boolean | null;
  hasEditList: boolean | null;
};

function invalid(code: string, safeMessage: string, cause?: unknown): never {
  throw new AppError({
    code,
    kind: "VALIDATION",
    safeMessage,
    reportable: false,
    cause,
  });
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseMentions(value: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      return invalid("INSTAGRAM_SCHEDULE_INVALID_MENTIONS", "Revise as menções do Story.");
    }
    return parsed;
  } catch (cause) {
    return invalid("INSTAGRAM_SCHEDULE_INVALID_MENTIONS", "Revise as menções do Story.", cause);
  }
}

async function prepareMedia(file: File): Promise<PreparedMedia> {
  if (file.size <= 0) invalid("INSTAGRAM_SCHEDULE_EMPTY_FILE", `${file.name || "O arquivo"} está vazio.`);
  if (file.size > INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES) {
    invalid("INSTAGRAM_SCHEDULE_FILE_TOO_LARGE", "Vídeos devem ter até 24 MB e imagens até 8 MB.");
  }

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const detected = await detectInstagramLibraryMedia(sourceBuffer);
  const maxBytes = detected.kind === "image"
    ? INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES
    : INSTAGRAM_LIBRARY_VIDEO_MAX_BYTES;
  if (sourceBuffer.byteLength > maxBytes) {
    invalid(
      "INSTAGRAM_SCHEDULE_FILE_TOO_LARGE",
      detected.kind === "image" ? "Imagens devem ter até 8 MB." : "Vídeos devem ter até 24 MB.",
    );
  }

  const buffer = detected.kind === "image" && detected.contentType !== "image/jpeg"
    ? await sharp(sourceBuffer).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer()
    : sourceBuffer;
  if (detected.kind === "image" && buffer.byteLength > INSTAGRAM_LIBRARY_IMAGE_MAX_BYTES) {
    invalid("INSTAGRAM_SCHEDULE_FILE_TOO_LARGE", "A imagem convertida para JPG excede 8 MB.");
  }
  const contentType = detected.kind === "image" ? "image/jpeg" : detected.contentType;
  const extension = detected.kind === "image" ? "jpg" : detected.extension;

  return {
    buffer,
    kind: detected.kind,
    contentType,
    extension,
    fileName: safeInstagramLibraryFileName(file.name, extension),
    sizeBytes: buffer.byteLength,
    width: detected.width,
    height: detected.height,
    durationSeconds: detected.durationSeconds,
    videoCodec: detected.videoCodec,
    audioCodec: detected.audioCodec,
    frameRate: detected.frameRate,
    videoBitrateBps: detected.videoBitrateBps,
    audioSampleRateHz: detected.audioSampleRateHz,
    fastStart: detected.fastStart,
    hasEditList: detected.hasEditList,
  };
}

function validateScheduledAt(value: string) {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) {
    invalid("INSTAGRAM_SCHEDULE_INVALID_DATE", "Informe uma data e um horário válidos.");
  }
  if (scheduledAt.getTime() < Date.now() + 120_000) {
    invalid("INSTAGRAM_SCHEDULE_TOO_SOON", "Escolha um horário com pelo menos dois minutos de antecedência.");
  }
  return scheduledAt;
}

export async function createInstagramScheduleFromForm(input: {
  context: ServerUserContext;
  form: FormData;
}) {
  const { context, form } = input;
  const files = form.getAll("media").filter((value): value is File => value instanceof File);
  if (files.length === 0 || files.length > 10) {
    invalid("INSTAGRAM_SCHEDULE_INVALID_MEDIA_COUNT", "Selecione de 1 a 10 arquivos.");
  }

  const preparedMedia = await Promise.all(files.map(prepareMedia));
  const scheduledAt = validateScheduledAt(formText(form, "scheduledAt"));
  const format = formText(form, "format") as InstagramPublicationFormat;
  const locationId = formText(form, "locationId");
  const locationName = formText(form, "locationName");
  if (Boolean(locationId) !== Boolean(locationName)) {
    invalid("INSTAGRAM_SCHEDULE_INVALID_LOCATION", "Revise a localização selecionada.");
  }

  const parsed = instagramScheduleInputSchema.safeParse({
    format,
    scheduledAt: scheduledAt.toISOString(),
    caption: formText(form, "caption"),
    media: preparedMedia.map((media) => ({
      localPath: media.fileName,
      kind: media.kind,
      contentType: media.contentType,
      fileName: media.fileName,
      sizeBytes: media.sizeBytes,
      width: media.width ?? undefined,
      height: media.height ?? undefined,
      durationSeconds: media.durationSeconds ?? undefined,
      videoCodec: media.videoCodec ?? undefined,
      audioCodec: media.audioCodec,
      frameRate: media.frameRate ?? undefined,
      videoBitrateBps: media.videoBitrateBps ?? undefined,
      audioSampleRateHz: media.audioSampleRateHz,
      fastStart: media.fastStart ?? undefined,
      hasEditList: media.hasEditList ?? undefined,
    })),
    shareToFeed: formText(form, "shareToFeed") !== "false",
    storyMentions: parseMentions(formText(form, "storyMentions")),
    location: locationId && locationName ? { id: locationId, name: locationName } : undefined,
  });
  if (!parsed.success) {
    invalid(
      "INSTAGRAM_SCHEDULE_INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Revise os dados do agendamento.",
      parsed.error,
    );
  }
  const publicationCertification = {
    ...certifyInstagramPublication({ format: parsed.data.format, media: parsed.data.media }),
    checkedAt: Timestamp.now(),
  };

  const ref = marketingDbAdmin.collection("instagramScheduledPosts").doc();
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const createdAt = Timestamp.now();
  const uploadedPaths: string[] = [];

  await ref.create({
    workspace_id: context.workspace_id,
    instagramAccountId: process.env.META_INSTAGRAM_ACCOUNT_ID ?? DEFAULT_INSTAGRAM_ACCOUNT_ID,
    format: parsed.data.format,
    status: "uploading",
    scheduledAt: Timestamp.fromDate(scheduledAt),
    caption: parsed.data.caption,
    shareToFeed: parsed.data.shareToFeed,
    storyMentions: parsed.data.storyMentions,
    location: parsed.data.location ?? null,
    media: [],
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    createdBy: {
      source: "instagram-workspace",
      uid: context.decoded.uid,
      email: context.decoded.email ?? context.userDoc.email ?? null,
    },
  });

  try {
    const uploadedMedia = [];
    for (let index = 0; index < preparedMedia.length; index += 1) {
      const media = preparedMedia[index]!;
      const objectPath = `instagram/scheduled/${ref.id}/${String(index + 1).padStart(2, "0")}-${media.fileName}`;
      const downloadToken = randomUUID();
      await bucket.file(objectPath).save(media.buffer, {
        resumable: media.kind === "video",
        metadata: {
          contentType: media.contentType,
          cacheControl: "private, max-age=3600",
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            uploadedBy: context.decoded.uid,
            workspaceId: context.workspace_id,
            instagramScheduleId: ref.id,
          },
        },
      });
      uploadedPaths.push(objectPath);
      uploadedMedia.push({
        kind: media.kind,
        contentType: media.contentType,
        fileName: media.fileName,
        sizeBytes: media.sizeBytes,
        width: media.width,
        height: media.height,
        durationSeconds: media.durationSeconds,
        videoCodec: media.videoCodec,
        audioCodec: media.audioCodec,
        frameRate: media.frameRate,
        videoBitrateBps: media.videoBitrateBps,
        audioSampleRateHz: media.audioSampleRateHz,
        fastStart: media.fastStart,
        hasEditList: media.hasEditList,
        objectPath,
        deliveryUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(firebaseClientConfig.storageBucket)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`,
      });
    }

    await ref.update({
      status: "scheduled",
      nextAttemptAt: Timestamp.fromDate(scheduledAt),
      wakeAt: Timestamp.fromDate(scheduledAt),
      media: uploadedMedia,
      publicationCertification,
      updatedAt: Timestamp.now(),
    });
  } catch (cause) {
    await Promise.allSettled(uploadedPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    await ref.delete().catch(() => undefined);
    throw cause;
  }

  return serializeInstagramSchedule(await ref.get());
}
