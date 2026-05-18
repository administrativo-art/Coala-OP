import { Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { logAction } from "@/lib/log-action";
import { cleanText, pickEnum, requirePrivacyUser, serializeDate } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = ["open", "in_review", "completed", "rejected"] as const;

function serializeRequest(doc: FirebaseFirestore.DocumentSnapshot) {
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

export async function PATCH(request: NextRequest, contextArg: { params: Promise<{ id: string }> }) {
  try {
    const context = await requirePrivacyUser(request);
    const { id } = await contextArg.params;
    const ref = dbAdmin.collection("privacyRequests").doc(id);
    const beforeDoc = await ref.get();
    if (!beforeDoc.exists || beforeDoc.data()?.workspace_id !== context.workspace_id) {
      return NextResponse.json({ error: "Pedido nao encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Payload invalido." }, { status: 400 });

    const status = pickEnum(body.status, statuses, beforeDoc.data()?.status ?? "open");
    const now = new Date();
    const update = {
      status,
      owner: cleanText(body.owner, 120) || null,
      response: cleanText(body.response, 3000) || null,
      completedAt: status === "completed" || status === "rejected" ? Timestamp.fromDate(now) : null,
      updatedAt: Timestamp.fromDate(now),
      updatedBy: { user_id: context.userDoc.id, username: context.userDoc.username },
    };
    await ref.update(update);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "privacy.requests",
      action: "privacy_request_updated",
      metadata: {
        target_type: "privacy_request",
        target_id: id,
        target_name: beforeDoc.data()?.subjectName ?? id,
        before_status: beforeDoc.data()?.status ?? null,
        after_status: status,
      },
      ttl_days: 365,
    });

    return NextResponse.json({ request: serializeRequest(await ref.get()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar pedido." }, { status: 400 });
  }
}

