import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canVerifyOnboardingIntegrations } from '../../../src/lib/hr/onboarding-integrations';

test('reverificação aceita processos concluídos e bloqueia etapas anteriores ou canceladas', async () => {
  assert.equal(canVerifyOnboardingIntegrations({ currentStage: 'integration', status: 'active' }), true);
  assert.equal(canVerifyOnboardingIntegrations({ currentStage: 'done', status: 'completed' }), true);
  for (const process of [
    { currentStage: 'integration', status: 'cancelled' },
    { currentStage: 'done', status: 'cancelled' },
    { currentStage: 'done', status: 'active' },
    { currentStage: 'accountant', status: 'completed' },
    { currentStage: 'document_review', status: 'active' },
    {},
  ]) assert.equal(canVerifyOnboardingIntegrations(process), false);
  const source = await readFile(new URL('../../../src/app/api/hr/onboarding/[id]/route.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf("action === 'verify_integrations'"), source.indexOf("action === 'set_access_operational_check'"));
  assert.match(block, /canVerifyOnboardingIntegrations\(process\)/);
  assert.doesNotMatch(block, /update\.(status|currentStage)\s*=/);
});

test('validação avança para acessos e criação do usuário pertence à etapa 5', async () => {
  const source = await readFile(
    new URL('../../../src/app/api/hr/onboarding/[id]/route.ts', import.meta.url),
    'utf8',
  );
  const validationBlock = source.slice(
    source.indexOf("action === 'save_finalization'"),
    source.indexOf("action === 'extend_public_link'"),
  );
  const accessBlock = source.slice(
    source.indexOf("action === 'create_collaborator'"),
    source.indexOf("action === 'create_first_access_link'"),
  );

  assert.match(validationBlock, /update\.currentStage = 'integration'/);
  assert.match(validationBlock, /update\.formalizationCompletedAt = now/);
  assert.match(accessBlock, /process\.currentStage !== 'integration'/);
});

test('conclusão exige entrega do e-mail, primeiro acesso e integrações resolvidas', async () => {
  const source = await readFile(
    new URL('../../../src/app/api/hr/onboarding/[id]/route.ts', import.meta.url),
    'utf8',
  );
  const completionBlock = source.slice(
    source.indexOf("action === 'complete'"),
    source.indexOf("action === 'cancel'"),
  );

  assert.match(completionBlock, /accessEmail\.status !== 'delivered'/);
  assert.match(completionBlock, /firstAccess\.status !== 'used'/);
  assert.match(completionBlock, /requiredOnboardingIntegrationsResolved/);
});
