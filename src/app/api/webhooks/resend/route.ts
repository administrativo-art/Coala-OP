import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";

import { deliveryStatusFromResendEvent, engagementStatusFromResendEvent, isDeliveryFailure } from "@/lib/email/resend-events";
import { extractAppointmentProposal, hashAsoToken } from "@/features/hr/aso/workflow";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { maybeAdvanceAfterFirstAccess } from "@/lib/hr/onboarding-access-provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendWebhookEvent = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    to?: string[];
    subject?: string;
    from?: string;
    bounce?: { message?: string };
  };
};

function eventErrorMessage(event: ResendWebhookEvent, status: string) {
  const bounceMessage = event.data?.bounce?.message?.trim();
  if (bounceMessage) return bounceMessage;
  if (status === "bounced") return "O servidor do destinatário recusou permanentemente o e-mail.";
  if (status === "complained") return "O destinatário marcou a mensagem como spam.";
  if (status === "failed") return "O Resend informou uma falha definitiva no envio.";
  return null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET não configurado.");
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  const rawBody = await request.text();
  let event: ResendWebhookEvent;
  try {
    event = new Webhook(secret).verify(rawBody, {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    }) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  const eventId = request.headers.get("svix-id")?.trim() ?? "";
  const eventType = event.type ?? "";
  const deliveryStatus = deliveryStatusFromResendEvent(eventType);
  const engagementStatus = engagementStatusFromResendEvent(eventType);
  const emailId = event.data?.email_id?.trim() ?? "";
  const eventAt = event.created_at ?? event.data?.created_at ?? new Date().toISOString();
  if (!eventId || !emailId) {
    return NextResponse.json({ received: true, ignored: true });
  }

  if (eventType === "email.received") {
    const recipients = Array.isArray(event.data?.to) ? event.data.to : [];
    const token = recipients.map(value => value.match(/aso\+([^@]+)@/i)?.[1] ?? "").find(Boolean);
    if (!token) return NextResponse.json({ received: true, ignored: true });
    const matches = await hrDbAdmin.collection("onboardingProcesses").where("asoClinicTokenHash", "==", hashAsoToken(token)).limit(1).get();
    if (matches.empty) return NextResponse.json({ received: true, ignored: true });
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ error: "RESEND_API_KEY não configurada." }, { status: 503 });
    const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    const received = await response.json().catch(() => ({})) as { text?: string | null; html?: string | null; subject?: string; from?: string };
    if (!response.ok) return NextResponse.json({ error: "Falha ao obter o conteúdo do e-mail recebido." }, { status: 502 });
    const sourceText = received.text?.trim() || received.html?.trim() || "";
    const proposal = extractAppointmentProposal(sourceText);
    const processDoc = matches.docs[0]; const processData = processDoc.data();
    const workflow = processData.asoWorkflow && typeof processData.asoWorkflow === "object" ? processData.asoWorkflow as Record<string, unknown> : {};
    const clinic = workflow.clinic && typeof workflow.clinic === "object" ? workflow.clinic as Record<string, unknown> : {};
    await Promise.all([
      processDoc.ref.set({ asoWorkflow: { ...workflow, status: "appointment_pending_review", clinic: { ...clinic, repliedAt: eventAt }, appointment: { ...proposal, instructions: null, source: "inbound_email", proposedAt: eventAt }, updatedAt: eventAt }, updatedAt: eventAt }, { merge: true }),
      processDoc.ref.collection("asoEvents").doc(eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)).set({ type: "CLINIC_EMAIL_REPLY_RECEIVED", at: eventAt, actorId: null, actorEmail: received.from ?? event.data?.from ?? null, providerEmailId: emailId, subject: received.subject ?? event.data?.subject ?? null, proposal }),
    ]);
    return NextResponse.json({ received: true, matched: true });
  }

  if (!deliveryStatus && !engagementStatus) return NextResponse.json({ received: true, ignored: true });

  const receiptRef = hrDbAdmin.collection("resendWebhookEvents").doc(eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180));
  const priorReceipt = await receiptRef.get();
  if (priorReceipt.get("processedAt")) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  await receiptRef.set({
    eventId,
    eventType,
    emailId,
    receivedAt: new Date().toISOString(),
    processedAt: null,
  }, { merge: true });

  const communications = await hrDbAdmin.collection("emailCommunications")
    .where("providerId", "==", emailId)
    .limit(5)
    .get();
  const affectedOnboardingIds = new Set<string>();

  for (const communication of communications.docs) {
    const data = communication.data();
    const previousWebhookAt = typeof data.webhookEventAt === "string" ? data.webhookEventAt : null;
    if (previousWebhookAt && new Date(previousWebhookAt).getTime() > new Date(eventAt).getTime()) continue;

    const onboardingId = typeof data.onboardingId === "string" ? data.onboardingId : "";
    const lastError = deliveryStatus ? eventErrorMessage(event, deliveryStatus) : null;
    await communication.ref.set({
      ...(deliveryStatus ? { status: deliveryStatus } : {}),
      webhookEventId: eventId,
      webhookEventAt: eventAt,
      updatedAt: new Date().toISOString(),
      ...(deliveryStatus === "delivered" ? { deliveredAt: eventAt } : {}),
      ...(engagementStatus === "opened" ? { openedAt: eventAt } : {}),
      ...(engagementStatus === "clicked" ? { clickedAt: eventAt } : {}),
      ...(deliveryStatus && isDeliveryFailure(deliveryStatus) ? { failedAt: eventAt, lastError } : {}),
    }, { merge: true });

    if (onboardingId && (data.category === "aso_clinic_request" || data.category === "aso_candidate_notice")) {
      const processRef = hrDbAdmin.collection("onboardingProcesses").doc(onboardingId);
      const processSnapshot = await processRef.get(); const process = processSnapshot.data() ?? {};
      const workflow = process.asoWorkflow && typeof process.asoWorkflow === "object" ? process.asoWorkflow as Record<string, unknown> : {};
      const key = data.category === "aso_clinic_request" ? "clinic" : "candidateNotification";
      const current = workflow[key] && typeof workflow[key] === "object" ? workflow[key] as Record<string, unknown> : {};
      await processRef.set({ asoWorkflow: { ...workflow, [key]: { ...current, ...(deliveryStatus ? { emailStatus: deliveryStatus } : {}), ...(deliveryStatus === "delivered" ? { deliveredAt: eventAt } : {}), ...(engagementStatus === "opened" ? { openedAt: eventAt } : {}), ...(deliveryStatus && isDeliveryFailure(deliveryStatus) ? { lastError } : {}) }, updatedAt: eventAt }, updatedAt: eventAt }, { merge: true });
    }

    if (onboardingId && data.category === "accountant_admission_request") {
      const processRef = hrDbAdmin.collection("onboardingProcesses").doc(onboardingId);
      const processSnapshot = await processRef.get(); const process = processSnapshot.data() ?? {};
      const workflow = process.accountantWorkflow && typeof process.accountantWorkflow === "object" ? process.accountantWorkflow as Record<string, unknown> : {};
      const currentEmail = workflow.email && typeof workflow.email === "object" ? workflow.email as Record<string, unknown> : {};
      await processRef.set({ accountantWorkflow: { ...workflow, email: { ...currentEmail, ...(deliveryStatus ? { status: deliveryStatus } : {}), ...(deliveryStatus === "delivered" ? { deliveredAt: eventAt } : {}), ...(engagementStatus === "opened" ? { openedAt: eventAt } : {}), ...(engagementStatus === "clicked" ? { clickedAt: eventAt } : {}), ...(deliveryStatus && isDeliveryFailure(deliveryStatus) ? { lastError } : {}) }, updatedAt: eventAt }, updatedAt: eventAt }, { merge: true });
    }

    if (!deliveryStatus || !onboardingId || data.event !== "first_access") continue;
    affectedOnboardingIds.add(onboardingId);
    await hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).set({
      accessProvisioning: {
        status: isDeliveryFailure(deliveryStatus)
          ? "failed"
          : deliveryStatus === "delivered"
            ? "awaiting_password"
            : "awaiting_delivery",
        email: {
          status: deliveryStatus,
          providerId: emailId,
          recipient: Array.isArray(event.data?.to) ? event.data?.to[0] ?? null : null,
          lastEventAt: eventAt,
          lastError,
          ...(deliveryStatus === "delivered" ? { deliveredAt: eventAt } : {}),
          ...(isDeliveryFailure(deliveryStatus) ? { failedAt: eventAt } : {}),
        },
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    if (isDeliveryFailure(deliveryStatus)) {
      await hrDbAdmin.collection("hrNotifications").doc(`email_delivery_${onboardingId}_first_access`).set({
        type: "email_delivery_failure",
        status: "pending",
        onboardingId,
        title: "O e-mail de primeiro acesso não foi entregue",
        message: lastError,
        channels: ["in_app"],
        recipient: { strategy: "hr_pool" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  }

  for (const onboardingId of affectedOnboardingIds) {
    await maybeAdvanceAfterFirstAccess(onboardingId);
  }

  await receiptRef.set({
    processedAt: new Date().toISOString(),
    matchedCommunications: communications.size,
  }, { merge: true });
  return NextResponse.json({ received: true });
}
