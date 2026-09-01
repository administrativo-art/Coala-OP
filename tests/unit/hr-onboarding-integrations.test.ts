import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  pendingPdvOnboardingAlert,
  pdvPendingPasswordMessage,
  replaceOnboardingIntegrationAlert,
  requiredOnboardingIntegrationsResolved,
  resolvedPdvOnboardingAlert,
} from '../../src/lib/hr/onboarding-integrations';

describe('requiredOnboardingIntegrationsResolved', () => {
  it('bloqueia estados vazios, incompletos ou pendentes', () => {
    assert.equal(requiredOnboardingIntegrationsResolved(undefined), false);
    assert.equal(requiredOnboardingIntegrationsResolved([]), false);
    assert.equal(requiredOnboardingIntegrationsResolved([
      { id: 'bizneo_id', status: 'resolved' },
    ]), false);
    assert.equal(requiredOnboardingIntegrationsResolved([
      { id: 'bizneo_id', status: 'resolved' },
      { id: 'pdv_id', status: 'pending' },
    ]), false);
  });

  it('libera somente quando Bizneo e PDV estão resolvidos', () => {
    assert.equal(requiredOnboardingIntegrationsResolved([
      { id: 'bizneo_id', status: 'resolved' },
      { id: 'pdv_id', status: 'resolved' },
      { id: 'other', status: 'pending' },
    ]), true);
  });
});

describe('estado do PDV durante o primeiro acesso', () => {
  it('informa que a senha ainda será definida e identifica a filial prevista', () => {
    assert.equal(
      pdvPendingPasswordMessage('Quiosque Tirirical'),
      'Aguardando a colaboradora definir a senha do PDV. O cadastro será criado na filial Quiosque Tirirical.',
    );
    assert.deepEqual(pendingPdvOnboardingAlert({
      pdvAccessStatus: 'pending_password',
      filialName: 'Quiosque Tirirical',
      checkedAt: '2026-09-01T12:00:00.000Z',
    }), {
      id: 'pdv_id',
      label: 'PDV Legal',
      status: 'pending',
      message: 'Aguardando a colaboradora definir a senha do PDV. O cadastro será criado na filial Quiosque Tirirical.',
      checkedAt: '2026-09-01T12:00:00.000Z',
      source: 'onboarding_first_access',
    });
  });

  it('substitui o alerta pendente quando o cadastro do PDV é criado', () => {
    const result = replaceOnboardingIntegrationAlert([
      { id: 'bizneo_id', status: 'resolved' },
      { id: 'pdv_id', status: 'pending' },
    ], resolvedPdvOnboardingAlert({
      externalId: '123',
      filialName: 'Quiosque Tirirical',
      checkedAt: '2026-09-01T12:00:00.000Z',
      source: 'onboarding_first_access',
      action: 'created',
    }));

    assert.deepEqual(result.map(alert => (alert as { id: string }).id), ['pdv_id', 'bizneo_id']);
    assert.equal(requiredOnboardingIntegrationsResolved(result), true);
  });
});
