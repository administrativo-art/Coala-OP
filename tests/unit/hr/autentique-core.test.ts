import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildCreateSignatureLinkMutation,
  buildCreateDocumentMutation,
  buildDeleteSignerMutation,
  buildResendSignaturesMutation,
  mergeAutentiqueParticipantStatus,
  mergeAutentiqueStatus,
  parseAutentiqueWebhook,
  participantPatchFromAutentiqueWebhook,
  statusFromAutentiqueEvent,
  verifyAutentiqueWebhookSignature,
} from "../../../src/lib/autentique-core";

test("cria a mutation em sandbox sem depender do ambiente", () => {
  const mutation = buildCreateDocumentMutation(true);
  assert.match(mutation, /sandbox: true/);
  assert.match(mutation, /createDocument/);
});

test("produção só aparece quando explicitamente solicitada", () => {
  assert.match(buildCreateDocumentMutation(false), /sandbox: false/);
});

test("usa o public_id do signatário nas ações individuais", () => {
  assert.match(buildResendSignaturesMutation(), /resendSignatures\(public_ids: \$public_ids\)/);
  assert.match(buildCreateSignatureLinkMutation(), /createLinkToSignature\(public_id: \$public_id\)/);
  assert.match(buildDeleteSignerMutation(), /deleteSigner\(public_id: \$public_id, document_id: \$document_id\)/);
});

test("valida a assinatura HMAC do corpo bruto", () => {
  const rawBody = JSON.stringify({ event: { id: "evt-1" } });
  const secret = "segredo-de-teste";
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  assert.equal(
    verifyAutentiqueWebhookSignature({ rawBody, signature, secret }),
    true
  );
  assert.equal(
    verifyAutentiqueWebhookSignature({ rawBody: `${rawBody} `, signature, secret }),
    false
  );
});

test("normaliza evento de assinatura e encontra o documento", () => {
  const event = parseAutentiqueWebhook({
    event: {
      id: "evt-2",
      type: "signature.accepted",
      created_at: "2026-07-18T18:00:00Z",
      data: {
        object: {
          public_id: "signature-1",
          document: "document-1",
        },
      },
    },
  });
  assert.deepEqual(event && {
    id: event.id,
    type: event.type,
    providerDocumentId: event.providerDocumentId,
    providerSignatureId: event.providerSignatureId,
  }, {
    id: "evt-2",
    type: "signature.accepted",
    providerDocumentId: "document-1",
    providerSignatureId: "signature-1",
  });
  assert.equal(statusFromAutentiqueEvent("document.finished"), "signed");
  assert.equal(statusFromAutentiqueEvent("document.expired"), "expired");
  assert.equal(statusFromAutentiqueEvent("document.cancelled"), "cancelled");
});

test("evento atrasado não regride um documento já assinado", () => {
  assert.equal(mergeAutentiqueStatus("signed", "signature.viewed"), "signed");
  assert.equal(mergeAutentiqueStatus("signed", "signature.accepted"), "signed");
  assert.equal(mergeAutentiqueStatus("sent", "signature.viewed"), "viewed");
});

test("normaliza o formato oficial sem data.object e extrai o evento do signatário", () => {
  const event = parseAutentiqueWebhook({
    event: {
      id: "evt-flat",
      type: "signature.viewed",
      created_at: "2026-08-31T12:00:00Z",
      data: {
        public_id: "signature-flat",
        document: "document-flat",
        email: "pessoa@example.com",
        name: "Pessoa Teste",
        viewed: { created_at: "2026-08-31T11:59:00Z", ip: "192.0.2.10", port: 443 },
      },
    },
  });
  assert.ok(event);
  assert.equal(event.providerDocumentId, "document-flat");
  assert.deepEqual(participantPatchFromAutentiqueWebhook(event), {
    providerSignatureId: "signature-flat",
    name: "Pessoa Teste",
    email: "pessoa@example.com",
    status: "viewed",
    emailSentAt: null,
    emailDeliveredAt: null,
    emailOpenedAt: null,
    viewedAt: "2026-08-31T11:59:00Z",
    signedAt: null,
    rejectedAt: null,
    lastIp: "192.0.2.10",
    lastPort: 443,
  });
});

test("evento atrasado também não regride o estado individual do signatário", () => {
  assert.equal(mergeAutentiqueParticipantStatus("signed", "signature.viewed"), "signed");
  assert.equal(mergeAutentiqueParticipantStatus("viewed", "signature.created"), "viewed");
  assert.equal(mergeAutentiqueParticipantStatus("delivery_failed", "signature.created"), "delivery_failed");
  assert.equal(mergeAutentiqueParticipantStatus("sent", "signature.accepted"), "signed");
});
