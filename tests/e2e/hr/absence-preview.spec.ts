import { expect, test } from '@playwright/test';

import { E2E_USER } from '../support/global-setup';

test('colaborador calcula prévia sem criar solicitação e edição limpa o resultado', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  let previewCalls = 0;
  // Ausência não depende de aguardar o histórico independente de vale-transporte.
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  await page.route('**/api/collaborator/requests', async (route) => {
    await historyGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) });
  });
  await page.route('**/api/collaborator/absence-requests/options', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ absenceTypes: [{ id: 'e2e-absence', name: 'Ausência E2E', units: ['day'], calculation: 'calendar_days', validFrom: '1900-01-01', validTo: null, color: 'blue' }] }) });
  });
  await page.route('**/api/collaborator/absence-requests/preview', async (route) => {
    previewCalls++;
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ absenceTypeId: 'e2e-absence', startDate: '2026-11-10', endDate: '2026-11-12', unit: 'day' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: {
      previewOnly: true, canSubmit: false, source: 'coala',
      absenceType: { id: 'e2e-absence', name: 'Ausência E2E', lineageId: 'e2e-absence', version: 2, validFrom: '1900-01-01', validTo: null },
      rule: { id: 'rule-e2e', name: 'Regra E2E', snapshot: {} },
      period: { startDate: input.startDate, endDate: input.endDate, startTime: null, endTime: null },
      quantity: { value: 3, unit: 'day', calculation: 'calendar_days' }, approvalFlow: 'dp', attachmentRequired: true,
      instructions: 'Entregar até 2026-11-09.',
      limits: { maxUnitsPerRequest: 5, maxUnitsPerPeriod: 10, limitPeriod: 'month', remaining: null, minimumNoticeDays: 0, maximumRetroactiveDays: 0 },
      pending: ['document_required', 'accumulated_balance_unverified', 'approval_and_submission_unavailable'],
    } }) });
  });

  await page.goto('/dashboard/collaborator/requests?new=absence_preview', { waitUntil: 'domcontentloaded' });
  const panel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Prévia de ausência' }) });
  try { await expect(panel).toBeVisible(); }
  finally { releaseHistory(); }
  await panel.getByRole('combobox', { name: 'Tipo de ausência' }).click();
  await page.getByRole('option', { name: 'Ausência E2E' }).click();
  await panel.getByLabel('Data de início').fill('2026-11-10');
  await panel.getByLabel('Data de término').fill('2026-11-12');
  await panel.getByRole('button', { name: 'Calcular prévia' }).click();

  await expect(panel.getByText('3 dias')).toBeVisible();
  await expect(panel.getByText('10/11/2026')).toBeVisible();
  await expect(panel.getByText('12/11/2026')).toBeVisible();
  await expect(panel.getByText('Entregar até 09/11/2026.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Enviar|Salvar/ })).toHaveCount(0);
  expect(previewCalls).toBe(1);

  await panel.getByLabel('Data de término').fill('2026-11-13');
  await expect(panel.getByText('3 dias')).toHaveCount(0);
});
