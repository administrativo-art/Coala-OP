import { NextResponse, type NextRequest } from "next/server";

import {
  reconcileGeneratedDocumentStandaloneSignature,
  sendGeneratedDocumentForStandaloneSignature,
} from "@/features/hr/documents/signature-workflow.server";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  "signature.created": "Solicitação criada no provedor",
  "signature.sent": "Convite de assinatura enviado",
  "signature.viewed": "Documento visualizado pelo signatário",
  "signature.accepted": "Assinatura realizada",
  "signature.rejected": "Assinatura recusada",
  "signature.delivery_failed": "Falha na entrega do convite",
  "document.finished": "Assinaturas concluídas",
  "document.expired": "Solicitação expirada",
  "document.cancelled": "Solicitação cancelada",
};

function timestamp(value: unknown) {
  const serialized = serializeHrValue(value);
  return typeof serialized === "string" ? serialized : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await assertFormalizationAccess(request, "signatures.view");
    const { id } = await context.params;
    const generated = await dbAdmin.collection("generatedDocuments").doc(id).get();
    if (!generated.exists) {
      return NextResponse.json({ error: "Documento gerado não encontrado." }, { status: 404 });
    }
    const signatureRequestId = generated.get("signatureRequestId");
    const providerDocumentId = generated.get("providerDocumentId");
    if (typeof signatureRequestId !== "string" || !signatureRequestId) {
      return NextResponse.json({
        signature: null,
        timeline: [{
          id: "generated",
          label: "Documento gerado",
          occurredAt: timestamp(generated.get("generatedAt")),
          source: "Coala One",
        }],
      });
    }

    const [signatureRequest, eventSnapshot] = await Promise.all([
      hrDbAdmin.collection("hrSignatureRequests").doc(signatureRequestId).get(),
      hrDbAdmin.collection("hrAutentiqueWebhookEvents")
        .where("signatureRequestId", "==", signatureRequestId)
        .limit(200)
        .get(),
    ]);
    const timeline = [
      {
        id: "generated",
        label: "Documento gerado",
        occurredAt: timestamp(generated.get("generatedAt")),
        source: "Coala One",
      },
      ...(generated.get("reviewedAt") ? [{
        id: "reviewed",
        label: "Documento aprovado",
        occurredAt: timestamp(generated.get("reviewedAt")),
        description: String(generated.get("reviewedByName") ?? ""),
        source: "Coala One",
      }] : []),
      ...(generated.get("finalizedAt") ? [{
        id: "finalized",
        label: "Documento finalizado",
        occurredAt: timestamp(generated.get("finalizedAt")),
        description: String(generated.get("finalizedByName") ?? ""),
        source: "Coala One",
      }] : []),
      {
        id: "signature-requested",
        label: "Enviado para assinatura",
        occurredAt: timestamp(
          generated.get("signatureSentAt")
          ?? signatureRequest.get("requestedAt"),
        ),
        description: String(signatureRequest.get("documentName") ?? ""),
        source: "Coala One / Autentique",
      },
      ...eventSnapshot.docs.map((event) => ({
        id: event.id,
        label: EVENT_LABELS[String(event.get("type"))]
          ?? `Evento de assinatura: ${String(event.get("type") ?? "desconhecido")}`,
        occurredAt: timestamp(event.get("eventCreatedAt") ?? event.get("receivedAt")),
        description: String(event.get("type") ?? ""),
        source: "Autentique",
      })),
      ...(generated.get("signatureReconciledAt") ? [{
        id: "reconciled",
        label: "Estado reconciliado",
        occurredAt: timestamp(generated.get("signatureReconciledAt")),
        source: "Coala One",
      }] : []),
      ...(generated.get("archivedAt") ? [{
        id: "archived",
        label: "Documento assinado arquivado",
        occurredAt: timestamp(generated.get("archivedAt")),
        source: "Coala One",
      }] : []),
    ].filter((event) => event.occurredAt)
      .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));

    return NextResponse.json(serializeHrValue({
      signature: {
        requestId: signatureRequestId,
        provider: signatureRequest.get("provider") ?? "autentique",
        providerDocumentId,
        status: generated.get("signatureStatus") ?? signatureRequest.get("status") ?? null,
        protocol: generated.get("protocol") ?? signatureRequest.get("protocol") ?? null,
        emailStatus: signatureRequest.get("emailDeliveryStatus")
          ?? signatureRequest.get("emailStatus")
          ?? null,
      },
      timeline,
    }));
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao carregar a trilha." },
      { status: 403 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const actor = await assertFormalizationAccess(
      request,
      body.action === "reconcile" ? "signatures.view" : "signatures.send",
    );
    const { id } = await context.params;
    const result = body.action === "reconcile"
      ? await reconcileGeneratedDocumentStandaloneSignature(id)
      : await sendGeneratedDocumentForStandaloneSignature({
        generatedDocumentId: id,
        actorId: actor.decoded.uid,
        actorName: actor.actorName,
        recipient: typeof body.recipient === "string" ? body.recipient : null,
      });
    return NextResponse.json(serializeHrValue(result));
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Falha ao enviar para assinatura." },
      { status: 400 },
    );
  }
}
