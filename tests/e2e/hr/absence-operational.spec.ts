import { expect, test } from '@playwright/test';
import { E2E_USER } from '../support/global-setup';

// Contrato visual com DTO/API interceptados: o gate operacional demo não fica ativo no E2E padrão.
test('separa decisão de aplicação e reconcilia preparação/ativação com detalhe atualizado', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  let phase: 'preparing' | 'aborted' | 'activation_pending' | 'active' = 'preparing';
  let detailReads = 0;
  const base = {
    id: 'absence-operational-e2e', status: 'in_review', version: 2, revision: 0,
    input: { absenceTypeId: 'e2e-absence', startDate: '2026-11-10', endDate: '2026-11-12', unit: 'day' },
    quantity: 3, unit: 'day', typeId: 'e2e-absence', typeVersion: 2, stage: 'dp', typeName: 'Ausência operacional E2E',
    attachmentCount: 0, attachments: [], createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z',
    beneficiaryUid: 'beneficiary-operational-e2e', beneficiaryName: 'Titular operacional E2E',
    requesterUid: 'requester-operational-e2e', assignedReviewerIds: [E2E_USER.uid],
    canSubmit: false, canReview: false, canCancel: false, canConfirmProfile: false, profileReviewRequired: false,
    history: [{ action: 'submit', actorUid: 'requester-operational-e2e', at: '2026-10-15T12:00:00.000Z', version: 2 }],
  };
  const dto = () => phase === 'preparing' ? { ...base, operational: { state: 'preparing', operationallyApplied: false, canReconcile: false, canAbortPreparation: true } }
    : phase === 'aborted' ? { ...base, version: 3, canReview: true, history: [...base.history, { action: 'operational_abort', actorUid: E2E_USER.uid, at: '2026-10-15T13:00:00.000Z', version: 3 }] }
      : phase === 'activation_pending' ? { ...base, version: 4, status: 'approved', stage: null, operational: { state: 'activation_pending', operationallyApplied: false, canReconcile: true, canAbortPreparation: false } }
        : { ...base, version: 4, status: 'approved', stage: null, operational: { state: 'active', operationallyApplied: true, canReconcile: false, canAbortPreparation: false } };

  await page.route('**/api/collaborator/requests', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) }));
  await page.route(/\/api\/collaborator\/absence-requests(?:\?.*)?$/, (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    const visible = status === (phase === 'preparing' || phase === 'aborted' ? 'in_review' : 'approved');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: visible ? [dto()] : [], nextCursor: null }) });
  });
  await page.route('**/api/collaborator/absence-requests/absence-operational-e2e', (route) => {
    detailReads++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: dto() }) });
  });
  await page.route('**/api/dp/absence-operational/absence-operational-e2e/reconcile', (route) => {
    const payload = route.request().postDataJSON();
    if (phase === 'preparing') {
      expect(payload).toEqual({ expectedVersion: 2, action: 'abort_preparation' });
      phase = 'aborted';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'operational', state: 'aborted', operationallyApplied: false }) });
    }
    expect(payload).toEqual({ expectedVersion: 4, action: 'activate' });
    phase = 'active';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'operational', state: 'active', operationallyApplied: true }) });
  });

  await page.goto('/dashboard/dp/requests', { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'Acompanhamento' }).click();
  await page.getByRole('button', { name: /Titular operacional E2E.*Ausência operacional E2E/ }).click();
  const panel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Ausência operacional E2E' }) });
  await expect(panel.getByText('Preparação em andamento')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Aprovar solicitação' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Abortar preparação' }).click();
  await expect(panel.getByText(/não cancela nem rejeita automaticamente/)).toBeVisible();
  await panel.locator('[data-ui="inline-confirm"]').getByRole('button', { name: 'Abortar preparação' }).click();
  await expect(panel.getByText('Preparação operacional abortada')).toBeVisible();
  expect(detailReads).toBeGreaterThanOrEqual(2);
  await panel.getByRole('button', { name: 'Fechar' }).click();

  phase = 'activation_pending';
  await page.getByLabel('Filtrar por situação').selectOption('approved');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await page.getByRole('button', { name: /Titular operacional E2E.*Ausência operacional E2E/ }).click();
  await expect(panel.getByText('Ativação pendente')).toBeVisible();
  await expect(panel.getByText('Aprovada', { exact: true })).toBeVisible();
  await expect(panel.getByText('Bloqueio operacional ativo')).toHaveCount(0);
  await expect(panel.getByText('O pedido foi aprovado, mas o bloqueio operacional ainda não foi confirmado.')).toBeVisible();
  await panel.getByRole('button', { name: 'Tentar aplicação novamente' }).click();
  await expect(panel.getByText('Bloqueio operacional ativo')).toBeVisible();
  expect(detailReads).toBeGreaterThanOrEqual(4);
});
