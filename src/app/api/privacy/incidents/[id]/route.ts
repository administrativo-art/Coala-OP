import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";
import { cleanText, pickEnum, requirePrivacyUser, serializeDate } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = ["open", "contained", "resolved", "dismissed"] as const;

function serializeIncident(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    workspace_id: data.workspace_id ?? "",
    title: data.title ?? "",
    incidentType: data.incidentType ?? "other",
    severity: data.severity ?? "low",
    status: data.status ?? "open",
    occurredAt: serializeDate(data.occurredAt),
    detectedAt: serializeDate(data.detectedAt) ?? "",
    affectedData: data.affectedData ?? "",
    affectedSubjects: data.affectedSubjects ?? "",
    estimatedSubjectsCount: typeof data.estimatedSubjectsCount === "number" ? data.estimatedSubjectsCount : null,
    containmentActions: data.containmentActions ?? "",
    resolutionNotes: data.resolutionNotes ?? null,
    owner: data.owner ?? null,
    createdAt: serializeDate(data.createdAt) ?? "",
    updatedAt: serializeDate(data.updatedAt) ?? "",
  };
}

export async function PATCH(request: NextRequest, contextArg: { params: Promise<{ id: string }> }) {
  try {
    const context = await requirePrivacyUser(request);
    const { id } = await contextArg.params;
    const ref = dbAdmin.collection("securityIncidents").doc(id);
    const beforeDoc = await ref.get();
    if (!beforeDoc.exists || beforeDoc.data()?.workspace_id !== context.workspace_id) {
      return NextResponse.json({ error: "Incidente nao encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Payload invalido." }, { status: 400 });

    const status = pickEnum(body.status, statuses, beforeDoc.data()?.status ?? "open");
    const update = {
      status,
      owner: cleanText(body.owner, 120) || null,
      resolutionNotes: cleanText(body.resolutionNotes, 3000) || null,
      updatedAt: Timestamp.fromDate(new Date()),
      updatedBy: { user_id: context.userDoc.id, username: context.userDoc.username },
    };
    await ref.update(update);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "privacy.incidents",
      action: "security_incident_updated",
      metadata: {
        target_type: "security_incident",
        target_id: id,
        target_name: beforeDoc.data()?.title ?? id,
        before_status: beforeDoc.data()?.status ?? null,
        after_status: status,
      },
      ttl_days: 365,
    });

    return NextResponse.json({ incident: serializeIncident(await ref.get()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar incidente." }, { status: 400 });
  }
}

