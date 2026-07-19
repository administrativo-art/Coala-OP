import { NextRequest, NextResponse } from "next/server";

import { completeProbationEvaluation, createProbationProcess, decideProbation, refreshProbationProcess, type ProbationProcessState } from "@/features/hr/integration/probation-process";
import { assertHrAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, "view").catch(() => null); if (!access) return error("Sem permissão.", 403);
  const { id } = await context.params; const reference = hrDbAdmin.collection("onboardingProcesses").doc(id); const document = await reference.get();
  if (!document.exists) return error("Integração não encontrada.", 404);
  const current = document.get("probationV2") as ProbationProcessState | undefined; if (!current) return error("Experiência não configurada.", 409);
  const next = refreshProbationProcess(current, new Date().toISOString().slice(0, 10));
  if (JSON.stringify(next) !== JSON.stringify(current)) await reference.update({ probationV2: next });
  return NextResponse.json({ probation: serializeHrValue(next) });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, "manage").catch(() => null); if (!access) return error("Sem permissão.", 403);
  const { id } = await context.params; const reference = hrDbAdmin.collection("onboardingProcesses").doc(id); const document = await reference.get();
  if (!document.exists) return error("Integração não encontrada.", 404);
  const body = await request.json().catch(() => ({})); const action = text(body.action); const now = new Date().toISOString();
  let current = document.get("probationV2") as ProbationProcessState | undefined;
  try {
    if (action === "set_admission_date") current = createProbationProcess(text(body.admissionDate), current?.config, now);
    else if (!current) return error("Experiência não configurada.", 409);
    else if (action === "evaluate") current = completeProbationEvaluation(current, { evaluationId: body.evaluationId === "second" ? "second" : "first", result: body.result === "rejected" ? "rejected" : body.result === "review" ? "review" : "approved", notes: text(body.notes) ?? undefined, actorId: access.decoded.uid, now });
    else if (action === "decide") current = decideProbation(current, { result: body.result === "terminated" ? "terminated" : "effective", notes: text(body.notes) ?? undefined, actorId: access.decoded.uid, now });
    else return error("Ação inválida.");
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Falha ao atualizar experiência."); }
  await reference.update({ probationV2: current, ...(action === "set_admission_date" ? { expectedAdmissionDate: current.admissionDate } : {}), updatedAt: now });
  return NextResponse.json({ probation: serializeHrValue(current) });
}
