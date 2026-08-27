import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { probationIsReleasedAfterFormalization, refreshProbationProcess, type ProbationProcessState } from "@/features/hr/integration/probation-process";
import { assertHrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const cronAllowed = !!process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronAllowed) { const access = await assertHrAccess(request, "manage").catch(() => null); if (!access) return NextResponse.json({ error: "Sem permissão." }, { status: 403 }); }
  const today = new Date().toISOString().slice(0, 10);
  const snapshot = await hrDbAdmin.collection("onboardingProcesses")
    .where("status", "==", "completed")
    .where("probationV2.status", "in", ["active", "decision_pending"])
    .limit(200)
    .get();
  let sent = 0;
  for (const document of snapshot.docs) {
    if (!probationIsReleasedAfterFormalization(document.data())) continue;
    const current = document.get("probationV2") as ProbationProcessState | undefined; if (!current || ["effective", "terminated", "awaiting_admission"].includes(current.status)) continue;
    let next = refreshProbationProcess(current, today); const due = next.alerts.filter((alert) => alert.status === "due"); if (!due.length) { if (JSON.stringify(next) !== JSON.stringify(current)) await document.ref.update({ probationV2: next }); continue; }
    const batch = hrDbAdmin.batch(); const now = Timestamp.now();
    due.forEach((alert) => { const evaluation = next.evaluations.find((item) => item.id === alert.evaluationId); const notification = hrDbAdmin.collection("hrNotifications").doc(); batch.set(notification, { type: "probation_evaluation", onboardingId: document.id, employeeId: document.get("employeeId") ?? null, candidateName: document.get("candidateName") ?? null, evaluator: next.config.evaluator, evaluationId: alert.evaluationId, label: evaluation?.label ?? "Avaliação de experiência", dueDate: evaluation?.windowEndDate ?? alert.dueDate, status: "pending", createdAt: now }); sent += 1; });
    next = { ...next, alerts: next.alerts.map((alert) => due.some((item) => item.id === alert.id) ? { ...alert, status: "sent", sentAt: new Date().toISOString() } : alert) };
    batch.update(document.ref, { probationV2: next, updatedAt: new Date().toISOString() }); await batch.commit();
  }
  return NextResponse.json({ ok: true, sent, processedAt: new Date().toISOString() });
}
