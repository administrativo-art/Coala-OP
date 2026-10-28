import 'server-only';

import type { AutentiqueCreatedDocument } from '@/lib/autentique.server';
import type { DPVacationSignatureParticipant } from '@/types';

function participantStatus(
  signature: AutentiqueCreatedDocument['signatures'][number],
): DPVacationSignatureParticipant['status'] {
  if (signature.signed?.created_at) return 'signed';
  if (signature.rejected?.created_at) return 'rejected';
  if (signature.viewed?.created_at) return 'viewed';
  if (signature.email_events?.refused) return 'delivery_failed';
  return 'sent';
}

function deliveryFailureReason(value: unknown) {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason
    ? reason.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 300)
    : null;
}

export type VacationSigner = {
  party: DPVacationSignatureParticipant['party'];
  name: string;
  email: string;
  avatarUrl?: string | null;
};

// A Autentique devolve o criador do documento junto das assinaturas; só quem foi convidado a assinar vira participante.
export function vacationParticipantsFromProvider(input: {
  signatures: AutentiqueCreatedDocument['signatures'];
  signers: VacationSigner[];
  invitedAt: string;
}) {
  return input.signatures.flatMap((signature): DPVacationSignatureParticipant[] => {
    const providerSignatureId = String(signature.public_id ?? '').trim();
    const email = String(signature.email ?? signature.user?.email ?? '').trim().toLowerCase();
    const signer = input.signers.find((candidate) => candidate.email.toLowerCase() === email);
    if (!providerSignatureId || !signer || !signature.action) return [];
    const networkEvent = signature.signed ?? signature.rejected ?? signature.viewed;
    return [{
      party: signer.party,
      providerSignatureId,
      name: String(signature.name ?? signature.user?.name ?? signer.name).trim() || signer.name,
      email: email || signer.email,
      avatarUrl: signer.avatarUrl ?? null,
      status: participantStatus(signature),
      invitedAt: input.invitedAt,
      emailSentAt: signature.email_events?.sent ?? null,
      emailDeliveredAt: signature.email_events?.delivered ?? null,
      deliveryFailureReason: signature.email_events?.refused
        ? deliveryFailureReason(signature.email_events.reason)
        : null,
      emailOpenedAt: signature.email_events?.opened ?? null,
      viewedAt: signature.viewed?.created_at ?? null,
      signedAt: signature.signed?.created_at ?? null,
      rejectedAt: signature.rejected?.created_at ?? null,
      lastIp: networkEvent?.ip ?? null,
      lastPort: networkEvent?.port ?? null,
    }];
  });
}
