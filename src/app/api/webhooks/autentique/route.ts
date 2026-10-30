import { after, NextRequest, NextResponse } from "next/server";

import { archiveAutentiqueSignedDocument } from "@/features/hr/documents/signature-workflow.server";
import {
  mergeAutentiqueStatus,
  mergeAutentiqueParticipantStatus,
  parseAutentiqueWebhook,
  participantPatchFromAutentiqueWebhook,
  verifyAutentiqueWebhookSignature,
} from "@/lib/autentique-core";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { markTerminationDocumentSigned, markTerminationIdentitySigned } from "@/features/hr/termination/server";
import { syncVacationNoticeSignatureRequest } from "@/features/hr/vacations/server";
import { syncVacationReceiptSignatureRequest } from "@/features/hr/vacations/payment-completion.server";
import { reportSystemError } from "@/lib/observability";
import { archiveAndProjectAssetCustodyTerm, projectAssetCustodyTermSignature } from "@/features/assets/custody-term.server";
import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function handlePost(request: Request) {
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
      const participantEvent = participantPatchFromAutentiqueWebhook(event);
      const participants = record(requestDoc.get("participants"));
      const currentParticipant = event.providerSignatureId
        ? record(participants[event.providerSignatureId])
        : {};
      const participantPatch = event.providerSignatureId
        ? {
            participants: {
              [event.providerSignatureId]: {
                ...currentParticipant,
                ...(participantEvent.name ? { name: participantEvent.name } : {}),
                ...(participantEvent.email ? { email: participantEvent.email } : {}),
                status: mergeAutentiqueParticipantStatus(
                  currentParticipant.status,
                  event.type,
                ),
                ...(participantEvent.emailSentAt ? { emailSentAt: participantEvent.emailSentAt } : {}),
                ...(participantEvent.emailDeliveredAt ? { emailDeliveredAt: participantEvent.emailDeliveredAt } : {}),
                ...(participantEvent.emailOpenedAt ? { emailOpenedAt: participantEvent.emailOpenedAt } : {}),
                ...(participantEvent.viewedAt ? { viewedAt: participantEvent.viewedAt } : {}),
                ...(participantEvent.signedAt ? { signedAt: participantEvent.signedAt } : {}),
                ...(participantEvent.rejectedAt ? { rejectedAt: participantEvent.rejectedAt } : {}),
                ...(typeof mail.reason === "string"
                  ? { deliveryFailureReason: mail.reason.slice(0, 500) }
                  : {}),
                ...(participantEvent.lastIp ? { lastIp: participantEvent.lastIp } : {}),
                ...(participantEvent.lastPort ? { lastPort: participantEvent.lastPort } : {}),
                updatedAt: event.createdAt ?? new Date().toISOString(),
              },
            },
          }
        : {};
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
          ...participantPatch,
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
      const vacationId = requestDoc.get("vacationId");
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
            } else if (typeof vacationId === "string" && purpose === "vacation_notice") {
              await syncVacationNoticeSignatureRequest({ vacationId, signatureRequestId: requestDoc.id });
            } else if (typeof vacationId === "string" && purpose === "vacation_receipt") {
              await syncVacationReceiptSignatureRequest({ vacationId, signatureRequestId: requestDoc.id });
            } else if (purpose === "asset_custody_term") {
              await archiveAndProjectAssetCustodyTerm({ signatureRequestId: requestDoc.id, signedUrl: files.signed as string, signedAt: event.createdAt, eventId: event.id });
            } else {
              await archiveAutentiqueSignedDocument({
                signatureRequestId: requestDoc.id,
                signedUrl: files.signed as string,
                signedAt: event.createdAt,
                confirmedByEventId: event.id,
              });
            }
          } catch (error) {
            const reference = reportSystemError({
              error,
              source: "api",
              operation: "archive-autentique-signed-document",
              routeOrJob: "/api/webhooks/autentique",
              metadata: { vacationId, signatureRequestId: requestDoc.id, purpose },
            });
            await requestDoc.ref.set({
              archiveStatus: "failed",
              archiveError: "Não foi possível arquivar o documento assinado.",
              archiveEventId: reference.eventId,
              updatedAt: new Date().toISOString(),
            }, { merge: true });
            if (purpose === "asset_custody_term") await projectAssetCustodyTermSignature(requestDoc.id).catch(() => undefined);
          }
        });
      } else if (purpose === "asset_custody_term") {
        after(async () => { await projectAssetCustodyTermSignature(requestDoc.id).catch(() => undefined); });
      } else if (typeof vacationId === "string" && (purpose === "vacation_notice" || purpose === "vacation_receipt")) {
        after(async () => {
          try {
            if (purpose === "vacation_notice") {
              await syncVacationNoticeSignatureRequest({ vacationId, signatureRequestId: requestDoc.id });
            } else {
              await syncVacationReceiptSignatureRequest({ vacationId, signatureRequestId: requestDoc.id });
            }
          } catch (error) {
            const reference = reportSystemError({
              error,
              source: "api",
              operation: purpose === "vacation_notice"
                ? "project-vacation-notice-signature"
                : "project-vacation-receipt-signature",
              routeOrJob: "/api/webhooks/autentique",
              metadata: { vacationId, signatureRequestId: requestDoc.id },
            });
            await requestDoc.ref.set({
              vacationProjectionStatus: "failed",
              vacationProjectionEventId: reference.eventId,
              updatedAt: new Date().toISOString(),
            }, { merge: true }).catch(() => undefined);
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

type StaticRouteContext = { params: Promise<Record<string, never>> };
const contract = defineSecurityContract({ schemaVersion: 1, id: "webhooks.autentique.receive", version: 1, surface: { method: "POST", path: "/api/webhooks/autentique" }, exposure: "internal-service", identity: { kind: "signed-webhook", provider: "autentique" }, authorization: { kind: "none" }, resourceScope: { kind: "none" }, input: { kind: "schema", schema: "autentique.webhook", unknownFields: "strip" }, effects: { mode: "external", audit: "server-authoritative" }, errorExposure: "sanitized" });
const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, true, Record<string, unknown>, undefined>(contract, {
  async authenticate({ request }) {
    const secret = process.env.AUTENTIQUE_WEBHOOK_SECRET?.trim();
    if (!secret) throw new AppError({ code: "AUTENTIQUE_WEBHOOK_UNAVAILABLE", kind: "TRANSIENT_EXTERNAL", httpStatus: 503, safeMessage: "Webhook indisponível." });
    const rawBody = await request.clone().text();
    if (!verifyAutentiqueWebhookSignature({ rawBody, signature: request.headers.get("x-autentique-signature"), secret })) throw new AppError({ code: "AUTENTIQUE_WEBHOOK_SIGNATURE_INVALID", kind: "AUTHENTICATION", safeMessage: "Assinatura inválida." });
    return true as const;
  },
  async parseInput({ request }) {
    const value = await request.clone().json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError({ code: "AUTENTIQUE_WEBHOOK_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Evento inválido." });
    return value as Record<string, unknown>;
  },
});

export const POST = secureRoute({ contract, enforcer }, ({ request }) => handlePost(request));
