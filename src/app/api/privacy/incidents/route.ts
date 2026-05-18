import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";
import { cleanText, pickEnum, requirePrivacyUser, serializeDate, ttlFrom } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const incidentTypes = ["unauthorized_access", "wrong_recipient", "account_compromise", "public_exposure", "data_loss", "other"] as const;
const severities = ["low", "medium", "high", "critical"] as const;

function serializeIncident(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
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

export async function GET(request: NextRequest) {
  try {
    const context = await requirePrivacyUser(request);
    const snapshot = await dbAdmin
      .collection("securityIncidents")
      .where("workspace_id", "==", context.workspace_id)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    return NextResponse.json({ incidents: snapshot.docs.map(serializeIncident) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao listar incidentes." }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requirePrivacyUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Payload invalido." }, { status: 400 });

    const title = cleanText(body.title, 180);
    const affectedData = cleanText(body.affectedData, 1500);
    const containmentActions = cleanText(body.containmentActions, 3000);
    if (!title || !affectedData || !containmentActions) {
      return NextResponse.json({ error: "Titulo, dados afetados e medidas tomadas sao obrigatorios." }, { status: 400 });
    }

    const now = new Date();
    const occurredAtRaw = cleanText(body.occurredAt, 40);
    const occurredAt = occurredAtRaw ? new Date(`${occurredAtRaw}T12:00:00`) : null;
    const ref = dbAdmin.collection("securityIncidents").doc();
    const estimated = Number(body.estimatedSubjectsCount);
    const payload = {
      workspace_id: context.workspace_id,
      title,
      incidentType: pickEnum(body.incidentType, incidentTypes, "other"),
      severity: pickEnum(body.severity, severities, "low"),
      status: "open",
      occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? Timestamp.fromDate(occurredAt) : null,
      detectedAt: Timestamp.fromDate(now),
      affectedData,
      affectedSubjects: cleanText(body.affectedSubjects, 1000),
      estimatedSubjectsCount: Number.isFinite(estimated) ? estimated : null,
      containmentActions,
      resolutionNotes: null,
      owner: cleanText(body.owner, 120) || null,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      ttl: ttlFrom(now, 365 * 5),
      createdBy: { user_id: context.userDoc.id, username: context.userDoc.username },
    };
    await ref.set(payload);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "privacy.incidents",
      action: "security_incident_created",
      metadata: {
        target_type: "security_incident",
        target_id: ref.id,
        target_name: title,
        incident_type: payload.incidentType,
        severity: payload.severity,
      },
      ttl_days: 365,
    });

    return NextResponse.json({ incident: serializeIncident(await ref.get()) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar incidente." }, { status: 400 });
  }
}

