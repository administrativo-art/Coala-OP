import assert from "node:assert/strict";
import test from "node:test";

import { admissionSignatureParticipantActionSchema } from "../../../src/features/hr/documents/admission-signature-actions";

const actionRequestId = "7afcc676-ab47-46af-a5ba-c224763f8bd8";
const providerSignatureId = "434fcd4c6d0c11eea3c542010a2b60c6";

test("valida uma ação destinada a um único signatário", () => {
  const parsed = admissionSignatureParticipantActionSchema.parse({
    action: "resend_participant",
    actionRequestId,
    providerSignatureId,
  });
  assert.equal(parsed.providerSignatureId, providerSignatureId);
});

test("normaliza o novo e-mail na substituição", () => {
  const parsed = admissionSignatureParticipantActionSchema.parse({
    action: "replace_participant_email",
    actionRequestId,
    providerSignatureId,
    email: "  NOVO@EXAMPLE.COM  ",
  });
  assert.equal(parsed.action, "replace_participant_email");
  assert.equal(parsed.email, "novo@example.com");
});

test("rejeita identificadores, e-mail e campos incompatíveis com a ação", () => {
  assert.equal(admissionSignatureParticipantActionSchema.safeParse({
    action: "create_signature_link",
    actionRequestId: "repetir",
    providerSignatureId: "todos",
  }).success, false);
  assert.equal(admissionSignatureParticipantActionSchema.safeParse({
    action: "replace_participant_email",
    actionRequestId,
    providerSignatureId,
    email: "invalido",
  }).success, false);
});
