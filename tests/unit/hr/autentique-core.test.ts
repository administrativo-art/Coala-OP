import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildCreateDocumentMutation,
  mergeAutentiqueStatus,
  parseAutentiqueWebhook,
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
