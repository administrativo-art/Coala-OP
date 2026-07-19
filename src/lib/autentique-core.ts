import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTENTIQUE_GRAPHQL_URL = "https://api.autentique.com.br/v2/graphql";

export type AutentiqueSignerInput = {
  email: string;
  action?: "SIGN" | "SIGN_AS_A_WITNESS" | "APPROVE" | "RECOGNIZE";
};

export type AutentiqueWebhookEvent = {
  id: string;
  type: string;
  createdAt: string | null;
  providerDocumentId: string | null;
  providerSignatureId: string | null;
  object: Record<string, unknown>;
};

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
  const object = record(data.object);
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

export function statusFromAutentiqueEvent(type: string) {
  if (type === "document.finished") return "signed";
  if (type === "signature.accepted") return "partially_signed";
  if (type === "signature.rejected") return "rejected";
  if (type === "signature.delivery_failed") return "delivery_failed";
  if (type === "signature.viewed") return "viewed";
  if (type === "document.deleted") return "deleted";
  return null;
}

export function mergeAutentiqueStatus(current: unknown, eventType: string) {
  const currentStatus = typeof current === "string" ? current : "sent";
  if (["signed", "deleted"].includes(currentStatus)) return currentStatus;
  if (currentStatus === "rejected" && eventType !== "document.deleted") {
    return currentStatus;
  }
  return statusFromAutentiqueEvent(eventType) ?? currentStatus;
}
