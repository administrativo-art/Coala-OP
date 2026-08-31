import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTENTIQUE_GRAPHQL_URL = "https://api.autentique.com.br/v2/graphql";

export type AutentiqueSignerInput = {
  email?: string;
  name?: string;
  phone?: string;
  deliveryMethod?: "DELIVERY_METHOD_EMAIL" | "DELIVERY_METHOD_SMS" | "DELIVERY_METHOD_WHATSAPP" | "DELIVERY_METHOD_LINK";
  action?: "SIGN" | "SIGN_AS_A_WITNESS" | "APPROVE" | "RECOGNIZE";
  cpf?: string;
  requireSmsVerificationPhone?: string;
  positions?: Array<{
    x: string;
    y: string;
    z: number;
    element: "SIGNATURE" | "NAME" | "INITIALS" | "DATE" | "CPF";
  }>;
};

export type AutentiqueWebhookEvent = {
  id: string;
  type: string;
  createdAt: string | null;
  providerDocumentId: string | null;
  providerSignatureId: string | null;
  object: Record<string, unknown>;
};

export type AutentiqueParticipantStatus =
  | "sent"
  | "viewed"
  | "signed"
  | "rejected"
  | "delivery_failed";

export function buildCreateDocumentMutation(sandbox: boolean) {
  return `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
    createDocument(document: $document, signers: $signers, file: $file, sandbox: ${sandbox ? "true" : "false"}) {
      id
      name
      created_at
      signatures {
        public_id
        name
        email
        created_at
        action { name }
        link { short_link }
        user { id name email }
      }
    }
  }`;
}

export function buildResendSignaturesMutation() {
  return `mutation ResendSignatures($public_ids: [UUID!]!) {
    resendSignatures(public_ids: $public_ids)
  }`;
}

export function buildCreateSignatureLinkMutation() {
  return `mutation CreateSignatureLink($public_id: UUID!) {
    createLinkToSignature(public_id: $public_id) {
      short_link
    }
  }`;
}

export function buildDeleteSignerMutation() {
  return `mutation DeleteSigner($public_id: UUID!, $document_id: UUID!) {
    deleteSigner(public_id: $public_id, document_id: $document_id)
  }`;
}

export function verifyAutentiqueWebhookSignature(params: {
  rawBody: string;
  signature: string | null;
  secret: string;
}) {
  if (!params.signature || !/^[a-f0-9]{64}$/i.test(params.signature)) return false;
  const expected = createHmac("sha256", params.secret)
    .update(params.rawBody)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(params.signature, "hex")
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseAutentiqueWebhook(payload: unknown): AutentiqueWebhookEvent | null {
  const root = record(payload);
  const event = record(root.event);
  const data = record(event.data);
  const nestedObject = record(data.object);
  // O formato atual entrega o objeto em data.object; endpoints antigos podem
  // entregar os mesmos campos diretamente em data.
  const object = Object.keys(nestedObject).length ? nestedObject : data;
  const id = stringValue(event.id);
  const type = stringValue(event.type);
  if (!id || !type) return null;

  const isDocument = type.startsWith("document.");
  return {
    id,
    type,
    createdAt: stringValue(event.created_at),
    providerDocumentId: isDocument
      ? stringValue(object.id) ?? stringValue(data.id)
      : stringValue(object.document),
    providerSignatureId: type.startsWith("signature.")
      ? stringValue(object.public_id) ?? stringValue(data.public_id)
      : null,
    object,
  };
}

export function participantStatusFromAutentiqueEvent(
  type: string,
): AutentiqueParticipantStatus | null {
  if (type === "signature.accepted") return "signed";
  if (type === "signature.rejected") return "rejected";
  if (type === "signature.delivery_failed") return "delivery_failed";
  if (type === "signature.viewed") return "viewed";
  if (type === "signature.created" || type === "signature.updated") return "sent";
  return null;
}

export function mergeAutentiqueParticipantStatus(
  current: unknown,
  eventType: string,
): AutentiqueParticipantStatus {
  const currentStatus: AutentiqueParticipantStatus = [
    "sent", "viewed", "signed", "rejected", "delivery_failed",
  ].includes(String(current))
    ? current as AutentiqueParticipantStatus
    : "sent";
  if (["signed", "rejected"].includes(currentStatus)) return currentStatus;
  const next = participantStatusFromAutentiqueEvent(eventType);
  if (!next) return currentStatus;
  if (currentStatus === "viewed" && ["sent", "delivery_failed"].includes(next)) {
    return currentStatus;
  }
  if (currentStatus === "delivery_failed" && next === "sent") {
    return currentStatus;
  }
  return next;
}

function eventDetails(value: unknown) {
  if (typeof value === "string") return { createdAt: value, ip: null, port: null };
  const details = record(value);
  return {
    createdAt: stringValue(details.created_at),
    ip: stringValue(details.ip),
    port: typeof details.port === "number" && Number.isFinite(details.port)
      ? details.port
      : null,
  };
}

export function participantPatchFromAutentiqueWebhook(event: AutentiqueWebhookEvent) {
  const user = record(event.object.user);
  const mail = record(event.object.mail);
  const eventField = event.type === "signature.accepted"
    ? event.object.signed
    : event.type === "signature.rejected"
      ? event.object.rejected
      : event.type === "signature.viewed"
        ? event.object.viewed
        : null;
  const details = eventDetails(eventField);
  return {
    providerSignatureId: event.providerSignatureId,
    name: stringValue(event.object.name) ?? stringValue(user.name),
    email: stringValue(event.object.email) ?? stringValue(user.email),
    status: participantStatusFromAutentiqueEvent(event.type),
    emailSentAt: stringValue(mail.sent),
    emailDeliveredAt: stringValue(mail.delivered),
    emailOpenedAt: stringValue(mail.opened),
    viewedAt: event.type === "signature.viewed"
      ? details.createdAt ?? event.createdAt
      : null,
    signedAt: event.type === "signature.accepted"
      ? details.createdAt ?? event.createdAt
      : null,
    rejectedAt: event.type === "signature.rejected"
      ? details.createdAt ?? event.createdAt
      : null,
    lastIp: details.ip,
    lastPort: details.port,
  };
}

export function statusFromAutentiqueEvent(type: string) {
  if (type === "document.finished") return "signed";
  if (type === "signature.accepted") return "partially_signed";
  if (type === "signature.rejected") return "rejected";
  if (type === "signature.delivery_failed") return "delivery_failed";
  if (type === "signature.viewed") return "viewed";
  if (type === "document.expired") return "expired";
  if (type === "document.cancelled" || type === "document.deleted") return "cancelled";
  return null;
}

export function mergeAutentiqueStatus(current: unknown, eventType: string) {
  const currentStatus = typeof current === "string" ? current : "sent";
  if (["signed", "cancelled"].includes(currentStatus)) return currentStatus;
  if (["rejected", "expired"].includes(currentStatus) && !["document.cancelled", "document.deleted"].includes(eventType)) {
    return currentStatus;
  }
  return statusFromAutentiqueEvent(eventType) ?? currentStatus;
}
