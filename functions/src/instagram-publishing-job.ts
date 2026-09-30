import { randomUUID } from "node:crypto";
import { getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  hasAmbiguousInstagramPublish,
  normalizeInstagramStoryProgress,
  type InstagramPublicationProgress,
} from "./instagram-story-sequence.js";

const metaSystemUserToken = defineSecret("META_SYSTEM_USER_TOKEN");
const metaGraphApiVersion = defineString("META_GRAPH_API_VERSION", { default: "v25.0" });

const db = getFirestore("coala-signage");
const COLLECTION = "instagramScheduledPosts";
const WORKSPACE_ID = "coala";
const MAX_ATTEMPTS = 4;
const BATCH_LIMIT = 2;
const LEASE_MILLISECONDS = 8 * 60 * 1000;

type PublicationFormat = "feed_image" | "carousel" | "reel" | "story";
type MediaItem = { kind: "image" | "video"; deliveryUrl: string };
type PublicationDocument = {
  instagramAccountId?: string;
  format?: PublicationFormat;
  status?: string;
  scheduledAt?: Timestamp;
  nextAttemptAt?: Timestamp;
  wakeAt?: Timestamp;
  leaseExpiresAt?: Timestamp;
  leaseId?: string;
  caption?: string;
  shareToFeed?: boolean;
  storyMentions?: string[];
  location?: { id?: string; name?: string } | null;
  media?: MediaItem[];
  attempts?: number;
  progress?: InstagramPublicationProgress<Timestamp>;
};

class MetaGraphError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "MetaGraphError";
    this.status = status;
    this.code = code;
  }
}

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Falha inesperada na publicação.";
  return raw
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

async function graphRequest<T>(
  method: "GET" | "POST",
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<T> {
  const version = metaGraphApiVersion.value().replace(/^\/+|\/+$/g, "");
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`);
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  };

  if (method === "GET") {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  } else {
    init.headers = {
      ...init.headers,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    init.body = new URLSearchParams(params);
  }

  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string; code?: number };
  } & T;
  if (!response.ok || payload.error) {
    throw new MetaGraphError(
      payload.error?.message?.slice(0, 500) ?? `Meta Graph respondeu HTTP ${response.status}.`,
      response.status,
      payload.error?.code,
    );
  }
  return payload;
}

async function createContainer(
  instagramAccountId: string,
  token: string,
  params: Record<string, string>,
) {
  const result = await graphRequest<{ id?: string }>("POST", `${instagramAccountId}/media`, token, params);
  if (!result.id) throw new Error("A Meta não retornou o identificador do contêiner de mídia.");
  return result.id;
}

async function waitForContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await graphRequest<{ status_code?: string }>(
      "GET",
      containerId,
      token,
      { fields: "status_code,status" },
    );
    const status = result.status_code?.toUpperCase();
    if (!status || status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new MetaGraphError(`A Meta encerrou o processamento da mídia com status ${status}.`, 400);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("A mídia não ficou pronta na Meta dentro de dois minutos.");
}

function validateDocument(data: PublicationDocument) {
  if (!data.instagramAccountId) throw new Error("Conta do Instagram ausente no agendamento.");
  if (!data.format || !["feed_image", "carousel", "reel", "story"].includes(data.format)) {
    throw new Error("Formato de publicação inválido.");
  }
  if (!Array.isArray(data.media) || data.media.length === 0) throw new Error("Mídia ausente no agendamento.");
  for (const media of data.media) {
    if (!media.deliveryUrl || !["image", "video"].includes(media.kind)) {
      throw new Error("Mídia inválida no agendamento.");
    }
  }
  if (data.format === "feed_image" && (data.media.length !== 1 || data.media[0]?.kind !== "image")) {
    throw new Error("Uma publicação de feed exige exatamente uma imagem.");
  }
  if (data.format === "reel" && (data.media.length !== 1 || data.media[0]?.kind !== "video")) {
    throw new Error("Um Reel exige exatamente um vídeo.");
  }
  if (data.format === "carousel" && (data.media.length < 2 || data.media.length > 10)) {
    throw new Error("Um carrossel exige de duas a dez mídias.");
  }
  if (data.format === "story" && data.media.length > 10) {
    throw new Error("Uma sequência de Stories aceita no máximo dez mídias.");
  }
}

async function saveProgress(ref: DocumentReference, leaseId: string, progress: Record<string, unknown>) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() as PublicationDocument | undefined;
    if (!data || data.status !== "processing" || data.leaseId !== leaseId) {
      throw new Error("O agendamento perdeu a posse de processamento.");
    }
    const now = Timestamp.now();
    const leaseExpiresAt = Timestamp.fromMillis(now.toMillis() + LEASE_MILLISECONDS);
    transaction.update(ref, {
      progress,
      updatedAt: now,
      leaseExpiresAt,
      wakeAt: leaseExpiresAt,
    });
  });
}

async function prepareContainer(
  ref: DocumentReference,
  data: PublicationDocument,
  leaseId: string,
  token: string,
) {
  const instagramAccountId = data.instagramAccountId!;
  const media = data.media!;
  const caption = data.caption ?? "";
  const location: Record<string, string> = data.location?.id
    ? { location_id: data.location.id }
    : {};
  const progress = { ...(data.progress ?? {}) };

  if (progress.parentContainerId) return progress.parentContainerId;

  if (data.format === "feed_image") {
    progress.parentContainerId = await createContainer(instagramAccountId, token, {
      image_url: media[0]!.deliveryUrl,
      caption,
      ...location,
    });
    await saveProgress(ref, leaseId, progress);
    return progress.parentContainerId;
  }

  if (data.format === "reel") {
    progress.parentContainerId = await createContainer(instagramAccountId, token, {
      media_type: "REELS",
      video_url: media[0]!.deliveryUrl,
      caption,
      share_to_feed: data.shareToFeed === false ? "false" : "true",
      ...location,
    });
    await saveProgress(ref, leaseId, progress);
    return progress.parentContainerId;
  }

  if (data.format === "story") throw new Error("Sequências de Stories usam o publicador dedicado.");

  const childContainerIds = [...(progress.childContainerIds ?? [])];
  for (let index = childContainerIds.length; index < media.length; index += 1) {
    const item = media[index]!;
    const childId = await createContainer(instagramAccountId, token, {
      ...(item.kind === "video"
        ? { media_type: "VIDEO", video_url: item.deliveryUrl }
        : { image_url: item.deliveryUrl }),
      is_carousel_item: "true",
    });
    childContainerIds.push(childId);
    progress.childContainerIds = childContainerIds;
    await saveProgress(ref, leaseId, progress);
    if (item.kind === "video") await waitForContainer(childId, token);
  }

  progress.parentContainerId = await createContainer(instagramAccountId, token, {
    media_type: "CAROUSEL",
    children: childContainerIds.join(","),
    caption,
    ...location,
  });
  await saveProgress(ref, leaseId, progress);
  return progress.parentContainerId;
}

async function publishStorySequence(
  ref: DocumentReference,
  data: PublicationDocument,
  leaseId: string,
  token: string,
  publicationState: { requestStarted: boolean },
) {
  const progress = normalizeInstagramStoryProgress(data.media!.length, data.progress);
  const media = data.media!;
  const storyMentions = (data.storyMentions ?? [])
    .filter((username) => /^[A-Za-z0-9._]{1,30}$/.test(username))
    .slice(0, 20);

  for (let index = 0; index < media.length; index += 1) {
    const item = media[index]!;
    const itemProgress = progress.storyItems[index]!;
    if (itemProgress.publishedMediaId) continue;

    if (!itemProgress.containerId) {
      itemProgress.containerId = await createContainer(data.instagramAccountId!, token, {
        media_type: "STORIES",
        [item.kind === "video" ? "video_url" : "image_url"]: item.deliveryUrl,
        ...(storyMentions.length > 0
          ? { user_tags: JSON.stringify(storyMentions.map((username) => ({ username }))) }
          : {}),
      });
      await saveProgress(ref, leaseId, progress);
    }

    await waitForContainer(itemProgress.containerId, token);
    itemProgress.publishRequestStartedAt = Timestamp.now();
    await saveProgress(ref, leaseId, progress);
    publicationState.requestStarted = true;

    const result = await graphRequest<{ id?: string }>(
      "POST",
      `${data.instagramAccountId}/media_publish`,
      token,
      { creation_id: itemProgress.containerId },
    );
    if (!result.id) throw new Error("A Meta não retornou o identificador do Story publicado.");

    itemProgress.publishedMediaId = result.id;
    itemProgress.publishedAt = Timestamp.now();
    await saveProgress(ref, leaseId, progress);
    publicationState.requestStarted = false;
  }

  const publishedMediaIds = progress.storyItems
    .map((item) => item.publishedMediaId)
    .filter((id): id is string => Boolean(id));
  if (publishedMediaIds.length !== media.length) {
    throw new Error("A sequência de Stories terminou com itens sem confirmação.");
  }

  await ref.update({
    status: "published",
    publishedAt: Timestamp.now(),
    publishedMediaId: publishedMediaIds[publishedMediaIds.length - 1],
    publishedMediaIds,
    permalink: null,
    leaseId: null,
    leaseExpiresAt: null,
    wakeAt: null,
    safeError: null,
    errorEventId: null,
    updatedAt: Timestamp.now(),
  });
  logger.info("[instagramPublishingScheduler] story sequence completed", {
    scheduleId: ref.id,
    publishedMediaIds,
  });
}

async function claim(ref: DocumentReference) {
  const leaseId = randomUUID();
  const now = Timestamp.now();
  const leaseExpiresAt = Timestamp.fromMillis(now.toMillis() + LEASE_MILLISECONDS);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const data = snapshot.data() as PublicationDocument;
    const scheduledReady = data.status === "scheduled" && (data.nextAttemptAt?.toMillis() ?? 0) <= now.toMillis();
    const expiredLease = data.status === "processing" && (data.leaseExpiresAt?.toMillis() ?? 0) <= now.toMillis();
    if (!scheduledReady && !expiredLease) return null;

    if (expiredLease && hasAmbiguousInstagramPublish(data.progress)) {
      transaction.update(ref, {
        status: "manual_review",
        safeError: "A confirmação da publicação foi interrompida. Verifique o Instagram antes de tentar novamente.",
        updatedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
        wakeAt: null,
      });
      return null;
    }

    const attempts = (data.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) {
      transaction.update(ref, {
        status: "failed",
        safeError: "O limite de tentativas de publicação foi atingido.",
        updatedAt: now,
        leaseId: null,
        leaseExpiresAt: null,
        wakeAt: null,
      });
      return null;
    }

    transaction.update(ref, {
      status: "processing",
      attempts,
      leaseId,
      leaseExpiresAt,
      wakeAt: leaseExpiresAt,
      updatedAt: now,
      safeError: null,
      errorEventId: null,
    });
    return { data: { ...data, attempts }, leaseId };
  });
}

function retryDelay(attempts: number) {
  return [60_000, 5 * 60_000, 15 * 60_000][Math.min(Math.max(attempts - 1, 0), 2)]!;
}

function isRetryable(error: unknown) {
  if (!(error instanceof MetaGraphError)) return true;
  return error.status === 429 || error.status >= 500 || [1, 2, 4, 17, 32, 341, 368].includes(error.code ?? -1);
}

async function recordFailure(
  ref: DocumentReference,
  leaseId: string,
  data: PublicationDocument,
  error: unknown,
  ambiguousPublish: boolean,
) {
  const eventId = randomUUID();
  const attempts = data.attempts ?? 1;
  const canRetry = !ambiguousPublish && isRetryable(error) && attempts < MAX_ATTEMPTS;
  const now = Timestamp.now();
  const safeError = ambiguousPublish
    ? "A Meta pode ter recebido a publicação, mas a confirmação falhou. Verifique o Instagram antes de tentar novamente."
    : safeErrorMessage(error);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() as PublicationDocument | undefined;
    if (!current || current.leaseId !== leaseId) return;
    transaction.update(ref, {
      status: ambiguousPublish ? "manual_review" : canRetry ? "scheduled" : "failed",
      nextAttemptAt: canRetry ? Timestamp.fromMillis(now.toMillis() + retryDelay(attempts)) : null,
      wakeAt: canRetry ? Timestamp.fromMillis(now.toMillis() + retryDelay(attempts)) : null,
      leaseId: null,
      leaseExpiresAt: null,
      safeError,
      errorEventId: eventId,
      updatedAt: now,
    });
  });

  logger.error("[instagramPublishingScheduler] publication failed", {
    eventId,
    scheduleId: ref.id,
    attempts,
    retrying: canRetry,
    ambiguousPublish,
    error: safeErrorMessage(error),
  });
}

async function processPublication(ref: DocumentReference, token: string) {
  const claimed = await claim(ref);
  if (!claimed) return;
  const { data, leaseId } = claimed;
  const publicationState = { requestStarted: false };

  try {
    validateDocument(data);
    if (data.format === "story") {
      await publishStorySequence(ref, data, leaseId, token, publicationState);
      return;
    }
    const containerId = await prepareContainer(ref, data, leaseId, token);
    await waitForContainer(containerId, token);

    const progress = {
      ...(data.progress ?? {}),
      parentContainerId: containerId,
      publishRequestStartedAt: Timestamp.now(),
    };
    await saveProgress(ref, leaseId, progress);
    publicationState.requestStarted = true;

    const result = await graphRequest<{ id?: string }>(
      "POST",
      `${data.instagramAccountId}/media_publish`,
      token,
      { creation_id: containerId },
    );
    if (!result.id) throw new Error("A Meta não retornou o identificador da publicação.");

    progress.publishedMediaId = result.id;
    await saveProgress(ref, leaseId, progress);

    let permalink: string | null = null;
    try {
      const media = await graphRequest<{ permalink?: string }>("GET", result.id, token, { fields: "permalink" });
      permalink = media.permalink ?? null;
    } catch (permalinkError) {
      logger.warn("[instagramPublishingScheduler] permalink unavailable", {
        scheduleId: ref.id,
        error: safeErrorMessage(permalinkError),
      });
    }

    await ref.update({
      status: "published",
      publishedAt: Timestamp.now(),
      publishedMediaId: result.id,
      permalink,
      leaseId: null,
      leaseExpiresAt: null,
      wakeAt: null,
      safeError: null,
      errorEventId: null,
      updatedAt: Timestamp.now(),
    });
    logger.info("[instagramPublishingScheduler] publication completed", {
      scheduleId: ref.id,
      publishedMediaId: result.id,
    });
  } catch (error) {
    await recordFailure(ref, leaseId, data, error, publicationState.requestStarted);
  }
}

async function dueReferences() {
  const now = Timestamp.now();
  const snapshot = await db.collection(COLLECTION)
    .where("workspace_id", "==", WORKSPACE_ID)
    .where("status", "in", ["scheduled", "processing"])
    .where("wakeAt", "<=", now)
    .orderBy("wakeAt", "asc")
    .limit(BATCH_LIMIT)
    .get();
  return snapshot.docs.map((doc) => doc.ref);
}

export const instagramPublishingScheduler = onSchedule({
  schedule: "* * * * *",
  timeZone: "America/Belem",
  retryCount: 0,
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [metaSystemUserToken],
}, async () => {
  const token = metaSystemUserToken.value().trim();
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN não está configurado.");

  const references = await dueReferences();
  for (const ref of references) await processPublication(ref, token);
});
