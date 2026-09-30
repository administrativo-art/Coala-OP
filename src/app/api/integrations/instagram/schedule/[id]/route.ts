import { randomUUID } from "node:crypto";

import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerAccess } from "@/features/instagram-scheduler/access.server";
import { instagramScheduleMutationSchema } from "@/features/instagram-scheduler/contracts";
import {
  hasPublishedInstagramStoryItem,
  isInstagramScheduleEditableStatus,
  isInstagramScheduleTimeAllowed,
  reorderInstagramStoryMedia,
} from "@/features/instagram-scheduler/schedule-mutation-policy";
import { requireUser } from "@/lib/auth-server";
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
      requireEditable(target);

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
