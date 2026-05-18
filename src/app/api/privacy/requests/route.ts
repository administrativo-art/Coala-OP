import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";
import { cleanText, pickEnum, requirePrivacyUser, serializeDate, ttlFrom } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestTypes = ["access", "correction", "deletion", "information", "consent_revocation", "opposition", "other"] as const;
const subjectTypes = ["candidate", "employee", "former_employee", "internal_user", "supplier", "other"] as const;
const origins = ["email", "whatsapp", "in_person", "phone", "system", "other"] as const;

function serializeRequest(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    workspace_id: data.workspace_id ?? "",
    subjectName: data.subjectName ?? "",
    subjectEmail: data.subjectEmail ?? "",
    subjectType: data.subjectType ?? "other",
    requestType: data.requestType ?? "other",
    origin: data.origin ?? "other",
    description: data.description ?? "",
    status: data.status ?? "open",
    owner: data.owner ?? null,
    response: data.response ?? null,
    dueAt: serializeDate(data.dueAt),
    completedAt: serializeDate(data.completedAt),
    createdAt: serializeDate(data.createdAt) ?? "",
    updatedAt: serializeDate(data.updatedAt) ?? "",
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = await requirePrivacyUser(request);
    const snapshot = await dbAdmin
      .collection("privacyRequests")
      .where("workspace_id", "==", context.workspace_id)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    return NextResponse.json({ requests: snapshot.docs.map(serializeRequest) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao listar pedidos." }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requirePrivacyUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Payload invalido." }, { status: 400 });

    const subjectName = cleanText(body.subjectName, 160);
    const subjectEmail = cleanText(body.subjectEmail, 180).toLowerCase();
    const description = cleanText(body.description, 3000);
    if (!subjectName || !description) {
      return NextResponse.json({ error: "Nome do titular e descricao sao obrigatorios." }, { status: 400 });
    }

    const now = new Date();
    const dueAtRaw = cleanText(body.dueAt, 40);
    const dueAt = dueAtRaw ? new Date(`${dueAtRaw}T12:00:00`) : null;
    const ref = dbAdmin.collection("privacyRequests").doc();
    const payload = {
      workspace_id: context.workspace_id,
      subjectName,
      subjectEmail,
      subjectType: pickEnum(body.subjectType, subjectTypes, "other"),
      requestType: pickEnum(body.requestType, requestTypes, "other"),
      origin: pickEnum(body.origin, origins, "other"),
      description,
      status: "open",
      owner: cleanText(body.owner, 120) || null,
      response: null,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? Timestamp.fromDate(dueAt) : null,
      completedAt: null,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      ttl: ttlFrom(now, 365 * 3),
      createdBy: { user_id: context.userDoc.id, username: context.userDoc.username },
    };
    await ref.set(payload);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "privacy.requests",
      action: "privacy_request_created",
      metadata: {
        target_type: "privacy_request",
        target_id: ref.id,
        target_name: subjectName,
        request_type: payload.requestType,
        subject_type: payload.subjectType,
      },
      ttl_days: 365,
    });

    const doc = await ref.get();
    return NextResponse.json({ request: serializeRequest(doc) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar pedido." }, { status: 400 });
  }
}

