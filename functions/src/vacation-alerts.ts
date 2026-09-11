import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { vacationWorkflowAlerts } from "./vacation-alert-policy.js";

const db = getFirestore("coala");
const hrDb = getFirestore("coala-rh");
const TIME_ZONE = "America/Belem";
const VACATION_SCAN_LIMIT = 251;
const PENDING_ALERT_LIMIT = 1001;

function dateInTimeZone(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function notificationId(vacationId: string, kind: string, dueDate: string) {
  return `vacation_alert_${vacationId}_${kind}_${dueDate}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export const vacationWorkflowDailyAlerts = onSchedule({
  schedule: "15 8 * * *",
  timeZone: TIME_ZONE,
  retryCount: 2,
  timeoutSeconds: 180,
  memory: "256MiB",
}, async () => {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = dateInTimeZone(now);
  const vacations = await db.collection("dp_vacations")
    .where("workflow.status", "==", "active")
    .where("startDate", ">=", shiftDate(today, -90))
    .where("startDate", "<=", shiftDate(today, 90))
    .orderBy("startDate", "asc")
    .limit(VACATION_SCAN_LIMIT)
    .get();
  if (vacations.size === VACATION_SCAN_LIMIT) {
    throw new Error("Limite operacional de férias ativas atingido.");
  }

  const pending = await hrDb.collection("hrNotifications")
    .where("type", "==", "vacation_workflow_alert")
    .where("status", "==", "pending")
    .limit(PENDING_ALERT_LIMIT)
    .get();
  if (pending.size === PENDING_ALERT_LIMIT) {
    throw new Error("Limite operacional de alertas de férias atingido.");
  }
  const pendingById = new Map(pending.docs.map((document) => [document.id, document]));
  const activeIds = new Set<string>();
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  vacations.docs.forEach((vacation) => {
    const data = vacation.data();
    vacationWorkflowAlerts(data.workflow, today).forEach((alert) => {
      const id = notificationId(vacation.id, alert.kind, alert.dueDate);
      activeIds.add(id);
      if (pendingById.has(id)) return;
      const ref = hrDb.collection("hrNotifications").doc(id);
      writes.push((batch) => batch.set(ref, {
        type: "vacation_workflow_alert",
        status: "pending",
        vacationId: vacation.id,
        employeeId: data.userId ?? null,
        alertKind: alert.kind,
        dueDate: alert.dueDate,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        channels: ["in_app"],
        recipient: { strategy: "hr_pool" },
        createdAt: nowIso,
        updatedAt: nowIso,
      }));
    });
  });

  pending.docs.forEach((notification) => {
    if (activeIds.has(notification.id)) return;
    writes.push((batch) => batch.set(notification.ref, {
      status: "completed",
      resolvedAt: nowIso,
      updatedAt: nowIso,
    }, { merge: true }));
  });

  for (let index = 0; index < writes.length; index += 400) {
    const batch = hrDb.batch();
    writes.slice(index, index + 400).forEach((write) => write(batch));
    await batch.commit();
  }
  console.log(`[vacationWorkflowDailyAlerts] ${vacations.size} férias; ${activeIds.size} alertas ativos; ${writes.length} atualizações.`);
});
