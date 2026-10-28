import assert from 'node:assert/strict';
import test from 'node:test';

import { vacationParticipantsFromProvider } from '@/features/hr/vacations/autentique-participants.server';

const employee = { party: 'employee' as const, name: 'Maria Edna', email: 'edna@example.com' };

function signature(overrides: Record<string, unknown>) {
  return {
    public_id: 'sig',
    name: null,
    email: null,
    created_at: '2026-10-24T03:17:03.000000Z',
    action: { name: 'SIGN' },
    link: null,
    user: null,
    ...overrides,
  } as Parameters<typeof vacationParticipantsFromProvider>[0]['signatures'][number];
}

test('ignora o criador do documento devolvido pela Autentique sem ação de assinatura', () => {
  const participants = vacationParticipantsFromProvider({
    signers: [employee],
    invitedAt: '2026-10-24T03:17:03.893Z',
    signatures: [
      signature({ public_id: 'owner', action: null, user: { id: 'u1', name: 'Dono', email: 'dono@example.com' } }),
      signature({ public_id: 'edna', email: 'EDNA@example.com', signed: { ip: null, port: null, reason: null, created_at: '2026-10-24T10:53:00Z' } }),
    ],
  });
  assert.deepEqual(participants.map((participant) => participant.providerSignatureId), ['edna']);
  assert.equal(participants[0].status, 'signed');
  assert.equal(participants[0].signedAt, '2026-10-24T10:53:00Z');
});

test('ignora o criador sem ação mesmo quando ele também é convidado a assinar', () => {
  const participants = vacationParticipantsFromProvider({
    signers: [employee, { party: 'company', name: 'Dono', email: 'dono@example.com' }],
    invitedAt: '2026-10-24T03:17:03.893Z',
    signatures: [
      signature({ public_id: 'owner', action: null, user: { id: 'u1', name: 'Dono', email: 'dono@example.com' } }),
      signature({ public_id: 'company', email: 'dono@example.com' }),
      signature({ public_id: 'edna', email: 'edna@example.com' }),
    ],
  });
  assert.deepEqual(participants.map((participant) => participant.providerSignatureId), ['company', 'edna']);
});
