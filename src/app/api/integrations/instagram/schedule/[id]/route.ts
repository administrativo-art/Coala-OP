import { randomUUID } from "node:crypto";

import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramScheduleMutationSchema } from "@/features/instagram-scheduler/contracts";
import {
  canCancelInstagramSchedule,
  canDeleteInstagramSchedule,
  canHideInstagramScheduleFromGrid,
  canPauseInstagramSchedule,
  canResumeInstagramSchedule,
  hasPublishedInstagramStoryItem,
  isInstagramScheduleEditableStatus,
  isInstagramScheduleTimeAllowed,
  reorderInstagramStoryMedia,
} from "@/features/instagram-scheduler/schedule-mutation-policy";
import { requireUser } from "@/lib/auth-server";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import {
  legacyMarketingDbAdmin,
  marketingDbAdmin,
  shouldReadLegacyMarketingDatabase,
} from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function notFound(): never {
  throw new AppError({
    code: "INSTAGRAM_SCHEDULE_NOT_FOUND",
    kind: "NOT_FOUND",
    safeMessage: "Agendamento não encontrado.",
    reportable: false,
  });
}

function requireEditable(data: DocumentData | undefined) {
  if (!data || !isInstagramScheduleEditableStatus(data.status)) {
    throw new AppError({
      code: "INSTAGRAM_SCHEDULE_NOT_EDITABLE",
      kind: "CONFLICT",
      safeMessage: "Somente uma publicação ainda programada pode ser alterada.",
      reportable: false,
    });
  }
  if (hasPublishedInstagramStoryItem(data.progress)) {
    throw new AppError({
      code: "INSTAGRAM_STORY_SEQUENCE_ALREADY_STARTED",
      kind: "CONFLICT",
      safeMessage: "A sequência de Stories já começou a ser publicada e não pode mais ser alterada.",
      reportable: false,
    });
  }
}

function stateConflict(message: string): never {
  throw new AppError({
    code: "INSTAGRAM_SCHEDULE_STATE_CONFLICT",
    kind: "CONFLICT",
    safeMessage: message,
    reportable: false,
  });
}

function requireFuture(value: Date) {
  if (!isInstagramScheduleTimeAllowed(value)) {
    throw new AppError({
      code: "INSTAGRAM_SCHEDULE_TIME_TOO_SOON",
      kind: "VALIDATION",
      safeMessage: "Escolha um horário com pelo menos dois minutos de antecedência.",
      reportable: false,
    });
  }
}

export const PATCH = withApiErrorHandling<RouteContext>(
  {
    source: "api",
    operation: "rescheduleInstagramPost",
    routeOrJob: "/api/integrations/instagram/schedule/[id]",
  },
  async (request: NextRequest, { params }) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
    const payload = instagramScheduleMutationSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      throw new AppError({
        code: "INSTAGRAM_SCHEDULE_INVALID_CHANGE",
        kind: "VALIDATION",
        safeMessage: "Alteração do agendamento inválida.",
        reportable: false,
      });
    }

    let scheduleDb = marketingDbAdmin;
    let targetRef = scheduleDb.collection("instagramScheduledPosts").doc(id);
    const currentSnapshot = await targetRef.get();
    if (!currentSnapshot.exists && shouldReadLegacyMarketingDatabase()) {
      scheduleDb = legacyMarketingDbAdmin;
      targetRef = scheduleDb.collection("instagramScheduledPosts").doc(id);
    }
    const actor = {
      uid: context.decoded.uid,
      email: context.decoded.email ?? context.userDoc.email ?? null,
    };

    await scheduleDb.runTransaction(async (transaction) => {
      const targetSnapshot = await transaction.get(targetRef);
      const target = targetSnapshot.data();
      if (!targetSnapshot.exists || target?.workspace_id !== context.workspace_id) notFound();
      if ("hide" in payload.data) {
        if (!canHideInstagramScheduleFromGrid(target.status)) {
          stateConflict("Somente uma publicação já concluída, cancelada ou com falha pode ser removida da grade.");
        }
        const now = Timestamp.now();
        transaction.update(targetRef, {
          hiddenFromGrid: true,
          hiddenAt: now,
          hiddenBy: actor,
          updatedAt: now,
          updatedBy: actor,
        });
        transaction.set(targetRef.collection("events").doc(randomUUID()), {
          type: "hidden_from_grid",
          status: target.status,
          actor,
          createdAt: now,
        });
        return;
      }

      requireEditable(target);

      if ("pause" in payload.data) {
        if (!canPauseInstagramSchedule(target.status)) stateConflict("Somente uma publicação programada pode ser pausada.");
        const now = Timestamp.now();
        transaction.update(targetRef, {
          status: "paused",
          pausedAt: now,
          pausedBy: actor,
          wakeAt: FieldValue.delete(),
          updatedAt: now,
          updatedBy: actor,
        });
        transaction.set(targetRef.collection("events").doc(randomUUID()), {
          type: "paused",
          scheduledAt: target.scheduledAt?.toDate?.().toISOString?.() ?? null,
          actor,
          createdAt: now,
        });
        return;
      }

      if ("resume" in payload.data) {
        if (!canResumeInstagramSchedule(target.status)) stateConflict("Somente uma publicação pausada pode ser retomada.");
        const nextDate = payload.data.scheduledAt !== undefined
          ? new Date(payload.data.scheduledAt)
          : target.scheduledAt?.toDate?.();
        if (!(nextDate instanceof Date)) notFound();
        requireFuture(nextDate);
        const nextTimestamp = Timestamp.fromDate(nextDate);
        const now = Timestamp.now();
        transaction.update(targetRef, {
          status: "scheduled",
          scheduledAt: nextTimestamp,
          nextAttemptAt: nextTimestamp,
          wakeAt: nextTimestamp,
          pausedAt: FieldValue.delete(),
          pausedBy: FieldValue.delete(),
          updatedAt: now,
          updatedBy: actor,
        });
        transaction.set(targetRef.collection("events").doc(randomUUID()), {
          type: "resumed",
          scheduledAt: nextDate.toISOString(),
          actor,
          createdAt: now,
        });
        return;
      }

      if ("cancel" in payload.data) {
        if (!canCancelInstagramSchedule(target.status)) stateConflict("Somente uma publicação programada ou pausada pode ser cancelada.");
        const now = Timestamp.now();
        transaction.update(targetRef, {
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: actor,
          wakeAt: FieldValue.delete(),
          updatedAt: now,
          updatedBy: actor,
        });
        transaction.set(targetRef.collection("events").doc(randomUUID()), {
          type: "cancelled",
          previousStatus: target.status,
          scheduledAt: target.scheduledAt?.toDate?.().toISOString?.() ?? null,
          actor,
          createdAt: now,
        });
        return;
      }

      if (!("swapWithId" in payload.data)) {
        const now = Timestamp.now();
        const updates: Record<string, unknown> = {
          updatedAt: now,
          updatedBy: actor,
        };

        if (payload.data.scheduledAt !== undefined) {
          const nextDate = new Date(payload.data.scheduledAt);
          requireFuture(nextDate);
          const nextTimestamp = Timestamp.fromDate(nextDate);
          const previousIso = target.scheduledAt?.toDate?.().toISOString?.() ?? null;
          updates.scheduledAt = nextTimestamp;
          updates.nextAttemptAt = nextTimestamp;
          updates.wakeAt = nextTimestamp;
          transaction.set(targetRef.collection("events").doc(randomUUID()), {
            type: "rescheduled",
            previousScheduledAt: previousIso,
            scheduledAt: nextDate.toISOString(),
            actor,
            createdAt: now,
          });
        }

        if (payload.data.mediaOrder !== undefined) {
          if (target.format !== "story" || !Array.isArray(target.media)) {
            throw new AppError({
              code: "INSTAGRAM_STORY_ORDER_UNAVAILABLE",
              kind: "VALIDATION",
              safeMessage: "A ordem de mídias só pode ser alterada em uma sequência de Stories.",
              reportable: false,
            });
          }
          const reordered = reorderInstagramStoryMedia(target.media, payload.data.mediaOrder);
          if (!reordered) {
            throw new AppError({
              code: "INSTAGRAM_STORY_ORDER_INVALID",
              kind: "VALIDATION",
              safeMessage: "A ordem precisa incluir cada mídia do Story exatamente uma vez.",
              reportable: false,
            });
          }
          updates.media = reordered;
          updates.progress = FieldValue.delete();
          updates.attempts = 0;
          updates.safeError = null;
          updates.errorEventId = null;
          transaction.set(targetRef.collection("events").doc(randomUUID()), {
            type: "story_media_reordered",
            mediaOrder: payload.data.mediaOrder,
            actor,
            createdAt: now,
          });
        }

        transaction.update(targetRef, updates);
        return;
      }

      if (payload.data.swapWithId === id) return;
      const otherRef = scheduleDb.collection("instagramScheduledPosts").doc(payload.data.swapWithId);
      const otherSnapshot = await transaction.get(otherRef);
      const other = otherSnapshot.data();
      if (!otherSnapshot.exists || other?.workspace_id !== context.workspace_id) notFound();
      requireEditable(other);

      const targetDate = target.scheduledAt?.toDate?.();
      const otherDate = other.scheduledAt?.toDate?.();
      if (!(targetDate instanceof Date) || !(otherDate instanceof Date)) notFound();
      requireFuture(targetDate);
      requireFuture(otherDate);

      const now = Timestamp.now();
      const targetTimestamp = Timestamp.fromDate(targetDate);
      const otherTimestamp = Timestamp.fromDate(otherDate);
      transaction.update(targetRef, {
        scheduledAt: otherTimestamp,
        nextAttemptAt: otherTimestamp,
        wakeAt: otherTimestamp,
        updatedAt: now,
        updatedBy: actor,
      });
      transaction.update(otherRef, {
        scheduledAt: targetTimestamp,
        nextAttemptAt: targetTimestamp,
        wakeAt: targetTimestamp,
        updatedAt: now,
        updatedBy: actor,
      });
      transaction.set(targetRef.collection("events").doc(randomUUID()), {
        type: "schedule_swapped",
        otherScheduleId: otherRef.id,
        previousScheduledAt: targetDate.toISOString(),
        scheduledAt: otherDate.toISOString(),
        actor,
        createdAt: now,
      });
      transaction.set(otherRef.collection("events").doc(randomUUID()), {
        type: "schedule_swapped",
        otherScheduleId: targetRef.id,
        previousScheduledAt: otherDate.toISOString(),
        scheduledAt: targetDate.toISOString(),
        actor,
        createdAt: now,
      });
    });

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);

export const DELETE = withApiErrorHandling<RouteContext>(
  {
    source: "api",
    operation: "deleteInstagramPost",
    routeOrJob: "/api/integrations/instagram/schedule/[id]",
  },
  async (request: NextRequest, { params }) => {
    const context = await requireUser(request);
    requireInstagramSchedulerAccess(context);

    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();

    let scheduleDb = marketingDbAdmin;
    let targetRef = scheduleDb.collection("instagramScheduledPosts").doc(id);
    if (!(await targetRef.get()).exists && shouldReadLegacyMarketingDatabase()) {
      scheduleDb = legacyMarketingDbAdmin;
      targetRef = scheduleDb.collection("instagramScheduledPosts").doc(id);
    }

    // A transação confere estado e workspace e remove o documento; a partir daí o publicador
    // não encontra mais o item. Eventos e arquivos são limpos em seguida.
    await scheduleDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(targetRef);
      const target = snapshot.data();
      if (!snapshot.exists || target?.workspace_id !== context.workspace_id) notFound();
      if (!canDeleteInstagramSchedule(target.status)) {
        stateConflict("Esta publicação está sendo enviada agora e não pode ser excluída. Tente novamente em instantes.");
      }
      transaction.delete(targetRef);
    });

    let cleanup: "complete" | "partial" = "complete";
    try {
      await scheduleDb.recursiveDelete(targetRef);
      await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .deleteFiles({ prefix: `instagram/scheduled/${id}/`, force: true });
    } catch {
      cleanup = "partial";
    }

    return NextResponse.json(
      { ok: true, cleanup },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
);
