import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requiredOnboardingIntegrationsResolved } from '../../src/lib/hr/onboarding-integrations';

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
