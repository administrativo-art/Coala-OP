import { z } from "zod";

const providerSignatureIdSchema = z.string()
  .trim()
  .regex(/^[a-f0-9-]{32,36}$/i, "Assinatura inválida.");

const participantActionBase = z.object({
  providerSignatureId: providerSignatureIdSchema,
  actionRequestId: z.string().uuid(),
});

export const admissionSignatureParticipantActionSchema = z.discriminatedUnion("action", [
  participantActionBase.extend({ action: z.literal("resend_participant") }),
  participantActionBase.extend({ action: z.literal("create_signature_link") }),
  participantActionBase.extend({
    action: z.literal("replace_participant_email"),
    email: z.string().trim().toLowerCase().email().max(254),
  }),
]);

export type AdmissionSignatureParticipantAction = z.infer<
  typeof admissionSignatureParticipantActionSchema
>;
