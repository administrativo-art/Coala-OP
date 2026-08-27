import { after, NextResponse } from "next/server";

import { archiveAutentiqueSignedDocument } from "@/features/hr/documents/signature-workflow.server";
import {
  mergeAutentiqueStatus,
  parseAutentiqueWebhook,
  verifyAutentiqueWebhookSignature,
} from "@/lib/autentique-core";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { markTerminationDocumentSigned, markTerminationIdentitySigned } from "@/features/hr/termination/server";

export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  const secret = process.env.AUTENTIQUE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[autentique-webhook] AUTENTIQUE_WEBHOOK_SECRET não configurado.");
    return NextResponse.json({ error: "Webhook indisponível." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (
    !verifyAutentiqueWebhookSignature({
      rawBody,
      signature: request.headers.get("x-autentique-signature"),
      secret,
    })
  ) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const event = parseAutentiqueWebhook(payload);
  if (!event) {
    return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  }

  const eventRef = hrDbAdmin.collection("hrAutentiqueWebhookEvents").doc(event.id);
  const alreadyProcessed = await eventRef.get();
  if (alreadyProcessed.exists) return NextResponse.json({ received: true, duplicate: true });

  let signatureRequestId: string | null = null;
  if (event.providerDocumentId) {
    const matches = await hrDbAdmin
      .collection("hrSignatureRequests")
      .where("providerDocumentId", "==", event.providerDocumentId)
      .limit(1)
      .get();
    const requestDoc = matches.docs[0];
    if (requestDoc) {
      signatureRequestId = requestDoc.id;
      const object = record(event.object);
      const files = record(object.files);
      const mail = record(object.mail);
      const status = mergeAutentiqueStatus(requestDoc.get("status"), event.type);
      const emailDeliveryStatus =
        event.type === "signature.delivery_failed" || typeof mail.refused === "string"
          ? "failed"
          : typeof mail.delivered === "string"
            ? "delivered"
            : typeof mail.sent === "string"
              ? "sent"
              : null;
      await requestDoc.ref.set(
        {
          status,
          providerLastEvent: event.type,
          providerLastEventId: event.id,
          providerEventAt: event.createdAt,
          providerSignatureId: event.providerSignatureId,
          ...(typeof files.signed === "string"
            ? { signedFileUrl: files.signed }
            : {}),
          ...(emailDeliveryStatus ? { emailDeliveryStatus } : {}),
          ...(typeof mail.sent === "string" ? { emailSentAt: mail.sent } : {}),
          ...(typeof mail.delivered === "string"
            ? { emailDeliveredAt: mail.delivered }
            : {}),
          ...(typeof mail.reason === "string"
            ? { emailDeliveryError: mail.reason }
            : {}),
          ...(event.type === "signature.viewed"
            ? { viewedAt: event.createdAt }
            : {}),
          ...(event.type === "document.finished"
            ? { signedAt: event.createdAt }
            : {}),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      const workflowDocumentId = requestDoc.get("workflowDocumentId");
      const workflowDocumentIds = Array.isArray(requestDoc.get("workflowDocumentIds"))
        ? requestDoc.get("workflowDocumentIds").filter((value: unknown): value is string => typeof value === "string" && !!value)
        : [];
      if (typeof workflowDocumentId === "string" && workflowDocumentId && !workflowDocumentIds.includes(workflowDocumentId)) {
        workflowDocumentIds.push(workflowDocumentId);
      }
      const terminationId = requestDoc.get("terminationId");
      const purpose = requestDoc.get("purpose");
      if (workflowDocumentIds.length) {
        const workflowStatus = event.type === "document.finished" ? "signed" : status;
        const batch = hrDbAdmin.batch();
        workflowDocumentIds.forEach((id: string) => batch.set(
          hrDbAdmin.collection("hrSignatureDocuments").doc(id),
          {
            status: workflowStatus,
            providerLastEvent: event.type,
            providerLastEventId: event.id,
            providerEventAt: event.createdAt,
            ...(emailDeliveryStatus ? { emailStatus: emailDeliveryStatus } : {}),
            ...(typeof mail.sent === "string" ? { emailSentAt: mail.sent } : {}),
            ...(typeof mail.delivered === "string" ? { emailDeliveredAt: mail.delivered } : {}),
            ...(typeof mail.reason === "string" ? { emailDeliveryError: mail.reason } : {}),
            ...(event.type === "signature.viewed" ? { viewedAt: event.createdAt } : {}),
            ...(event.type === "document.finished" ? { signedAt: event.createdAt } : {}),
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        ));
        await batch.commit();
      }
      if (
        event.type === "document.finished" &&
        typeof files.signed === "string" &&
        files.signed
      ) {
        after(async () => {
          try {
            if (typeof terminationId === "string" && purpose === "termination_request_identity") {
              await markTerminationIdentitySigned({ terminationId, signedUrl: files.signed as string, signedAt: event.createdAt ?? new Date().toISOString() });
            } else if (typeof terminationId === "string" && purpose === "termination_final_document" && typeof requestDoc.get("terminationDocumentId") === "string") {
              await markTerminationDocumentSigned({ terminationId, documentId: requestDoc.get("terminationDocumentId"), signedUrl: files.signed as string, signedAt: event.createdAt ?? new Date().toISOString() });
            } else {
              await archiveAutentiqueSignedDocument({
                signatureRequestId: requestDoc.id,
                signedUrl: files.signed as string,
                signedAt: event.createdAt,
                confirmedByEventId: event.id,
              });
            }
          } catch (error) {
            console.error("[autentique-webhook] Falha ao arquivar documento assinado.", error);
            await requestDoc.ref.set({
              archiveStatus: "failed",
              archiveError: error instanceof Error ? error.message : "Falha ao arquivar.",
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          }
        });
      }
    }
  }

  await eventRef.create({
    eventId: event.id,
    type: event.type,
    providerDocumentId: event.providerDocumentId,
    providerSignatureId: event.providerSignatureId,
    signatureRequestId,
    eventCreatedAt: event.createdAt,
    receivedAt: new Date().toISOString(),
  });
  return NextResponse.json({ received: true });
}
