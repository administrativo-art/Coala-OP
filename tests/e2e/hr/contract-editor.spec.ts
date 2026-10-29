import { expect, test } from '@playwright/test';
import { E2E_USER } from '../support/global-setup';
import { operationalCivilDate } from '../../../src/lib/operational-unit-periods';

test('Dados contratuais informa e o drawer concentra edição com justificativa e data', async ({ page }) => {
  test.setTimeout(300_000);
  const bodies: Record<string, unknown>[] = [];
  await page.route(`**/api/rh/employee-profile/${E2E_USER.uid}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    employee: { bizneo_employee_id: E2E_USER.uid, auth_uid: E2E_USER.uid, name: 'Administrador E2E' },
    fieldValues: {}, fieldMap: { version: 'e2e-contracts', fields: {
      'employee.employer_cnpj': { label: 'CNPJ do empregador', section: 'Dados contratuais', type: 'text', visibility: 'restricted_partial', order: 10 },
      'employee.employer_name': { label: 'Razão social', section: 'Dados contratuais', type: 'text', visibility: 'restricted_partial', order: 20 },
    } }, cache: { rh_role: 'admin', bizneo_employee_id: E2E_USER.uid }, periodo_experiencia: null,
    changeRequests: [], consentimento_imagem_voz: null, ciencia_privacidade_onboarding: null,
  }) }));
  await page.route(`**/api/users/${E2E_USER.uid}/contract-changes`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changes: [] }) }));
  await page.route(`**/api/users/${E2E_USER.uid}`, (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route('**/api/audit/log', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.goto(`/login?next=${encodeURIComponent(`/dashboard/dp/collaborators/${E2E_USER.uid}`)}`);
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });
  await expect(page.getByRole('heading', { name: 'Dados contratuais', exact: true })).toBeVisible({ timeout: 90_000 });
  const section = page.locator('[data-profile-navigation-section]').filter({ has: page.getByRole('heading', { name: 'Dados contratuais', exact: true }) });
  await expect(section.getByText('Não informado').first()).toBeVisible();
  await expect(section.getByRole('button', { name: '+ Adicionar', exact: true })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vigências do vínculo', exact: true })).toHaveCount(0);
  await section.getByRole('button', { name: 'Ver alterações', exact: true }).click();
  await expect(section.getByText('Nenhuma alteração contratual registrada.')).toBeVisible();
  await section.getByRole('button', { name: 'Editar dados contratuais', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Identificação', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 90_000 });
  await expect(page.getByLabel('Principal financeira', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Unidade empregadora', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Cargo', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Unidades', exact: true }).click();
  await expect(page.getByLabel('Principal financeira', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Unidade empregadora', { exact: true })).toBeVisible();
  await expect(page.getByText('Como ler esta tela', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Entenda: Principal financeira', exact: true }).click();
  await expect(page.getByText(/Referência do financeiro: lotação e custos do colaborador/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Entenda: Escala e operação', exact: true }).click();
  await expect(page.getByText(/Unidades habituais de trabalho por período/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Definir primeira vigência', exact: true }).click();
  const start = page.getByLabel('Início da Vigência 1', { exact: true });
  await expect(start).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Salvar alterações', exact: true })).toBeDisabled();
  const units = page.getByRole('group', { name: 'Unidades habituais de trabalho', exact: true }).getByRole('checkbox');
  await units.nth(0).check();
  await units.nth(1).check();
  await start.fill(operationalCivilDate());
  await expect(page.getByRole('status').filter({ hasText: 'Nova vigência a partir de' })).toBeVisible();
  await page.getByLabel('Principal financeira', { exact: true }).click();
  await page.getByRole('option', { name: 'CD E2E', exact: true }).click();
  await expect(page.getByLabel('Justificativa da alteração', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('operational-period-inline.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Identificação', exact: true }).click();
  await page.getByLabel('Tipo de vínculo', { exact: true }).click();
  await page.getByRole('option', { name: 'Pessoa jurídica (PJ)', exact: true }).click();
  await page.getByLabel('Justificativa da alteração', { exact: true }).fill('Alteração sintética para validar o editor');
  await page.getByLabel('Válida a partir de', { exact: true }).fill(operationalCivilDate());
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ employmentRelationshipType: 'pj', contractChangeReason: 'Alteração sintética para validar o editor', contractEffectiveDate: operationalCivilDate() });
  const periods = bodies[0].operationalUnitPeriods as { validFrom: string; validTo?: string; unitIds: string[] }[];
  expect(periods).toHaveLength(1);
  expect(periods[0].validFrom).toBe(operationalCivilDate());
  expect(periods[0].validTo).toBeUndefined();
  expect(periods[0].unitIds).toHaveLength(2);
});
