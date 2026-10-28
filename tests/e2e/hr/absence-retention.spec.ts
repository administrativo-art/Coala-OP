import { expect, test } from '@playwright/test';
import { E2E_STOCK_MIN, E2E_USER } from '../support/global-setup';

// Contrato visual interceptado; decisão, ACL, fence e Storage ficam nos testes de integração do servidor.
test('custodiante decide retenção e confirma a exclusão definitiva separadamente', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  let state: 'awaiting_authorization' | 'authorized' | 'removed' = 'awaiting_authorization';
  let version = 2;
  let posted = false;
  let executed = false;
  let retained = false;
  const item = { id: 'retention-e2e-case', requestId: 'absence-e2e-request', fileId: 'file-e2e',
    beneficiaryUid: 'employee-retention-e2e', unitId: E2E_STOCK_MIN.cdUnitId, custodianUid: E2E_USER.uid,
    version: 2, reviewAfter: '2026-10-14', updatedAt: '2026-10-15T12:00:00.000Z', decision: null };
  const second = { ...item, id: 'retention-e2e-second', fileId: 'file-e2e-second' };
  await page.route('**/api/collaborator/requests', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) }));
  await page.route(/\/api\/dp\/absence-retention(?:\?.*)?$/, (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('unitId')).toBe(E2E_STOCK_MIN.cdUnitId);
    expect(query.get('limit')).toBe('25');
    const cases = query.get('state') === 'awaiting_authorization'
      ? [...(state === 'awaiting_authorization' ? [{ ...item, state, version }] : []), ...(retained ? [] : [{ ...second, state: 'awaiting_authorization' }])]
      : query.get('state') === state ? [{ ...item, state, version }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      cases, nextCursor: null,
    }) });
  });
  await page.route('**/api/dp/absence-retention/retention-e2e-case/decision', (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ action: 'authorize_delete', expectedVersion: 2, reason: 'Conferência documental concluída.' });
    expect(payload.operationId).toMatch(/^[0-9a-f-]{36}$/);
    posted = true;
    state = 'authorized';
    version = 3;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, state, version, replayed: false }) });
  });
  await page.route('**/api/dp/absence-retention/retention-e2e-second/decision', (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ action: 'retain', expectedVersion: 2, reason: 'Conservação necessária para revisão futura.', nextReviewAfter: '2100-01-01' });
    expect(payload.operationId).toMatch(/^[0-9a-f-]{36}$/);
    retained = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...second, state: 'retained_until_review', version: 3, replayed: false }) });
  });
  await page.route('**/api/dp/absence-retention/retention-e2e-case/execute', (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ expectedVersion: 3 });
    expect(payload.operationId).toMatch(/^[0-9a-f-]{36}$/);
    executed = true;
    state = 'removed';
    version = 6;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...item, state, version, replayed: false }) });
  });

  await page.goto('/dashboard/dp/requests', { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'Pendências de documento' }).click();
  await expect(page.getByText('Selecione uma unidade para consultar a retenção.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Unidade da retenção' }).click();
  await page.getByRole('option', { name: 'CD E2E' }).click();
  await page.getByText('Referência do documento: file-e2e', { exact: true }).click();
  const panel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Documento de ausência' }) });
  await expect(panel.getByText('14/10/2026')).toBeVisible();
  await panel.getByRole('button', { name: 'Autorizar exclusão' }).click();
  await panel.getByLabel('Motivo (obrigatório, mínimo 10 caracteres)').fill('Conferência documental concluída.');
  await expect(panel.getByText(/o arquivo não será removido/)).toBeVisible();
  await panel.getByRole('button', { name: 'Confirmar autorização' }).click();
  await expect.poll(() => posted).toBe(true);
  await expect(page.getByText('Decisão registrada e fila atualizada.')).toBeVisible();
  await page.getByText('Referência do documento: file-e2e-second', { exact: true }).click();
  await panel.getByRole('button', { name: 'Manter documento' }).click();
  await panel.getByLabel('Motivo (obrigatório, mínimo 10 caracteres)').fill('Conservação necessária para revisão futura.');
  await panel.getByLabel('Próxima revisão (obrigatória, futura)').fill('2100-01-01');
  await panel.getByRole('button', { name: 'Confirmar manutenção' }).click();
  await expect.poll(() => retained).toBe(true);
  await page.getByRole('combobox', { name: 'Situação da retenção' }).click();
  await page.getByRole('option', { name: 'Exclusão autorizada' }).click();
  await page.getByText('Referência do documento: file-e2e', { exact: true }).click();
  await expect(panel.getByText(/bloqueará temporariamente alterações no vínculo/)).toBeVisible();
  await panel.getByRole('button', { name: 'Remover arquivo definitivamente' }).click();
  await expect(panel.getByText(/pedido, as aprovações e o histórico serão preservados/i)).toBeVisible();
  await panel.getByRole('button', { name: 'Confirmar remoção definitiva' }).click();
  await expect.poll(() => executed).toBe(true);
  await expect(page.getByText('Arquivo removido e recibo permanente registrado.')).toBeVisible();
});
