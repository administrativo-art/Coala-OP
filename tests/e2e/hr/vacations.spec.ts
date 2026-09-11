import { expect, test } from '@playwright/test';

import { E2E_USER, E2E_VACATION } from '../support/global-setup';

test('aprova e cancela férias com justificativa e histórico auditável', async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  await page.goto(`/dashboard/dp/ferias/${E2E_VACATION.employeeId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Colaboradora Férias E2E' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Aprovar agendamento' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar agendamento' }).click();

  await expect(page.getByText('Aprovado.', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Gerar aviso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar formalmente' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancelar formalmente' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelar férias formalmente?' })).toBeVisible();
  await page.getByPlaceholder('Informe o motivo (mínimo de 10 caracteres)').fill('Cancelamento E2E autorizado pelo RH.');
  await page.getByRole('button', { name: 'Confirmar com justificativa' }).click();

  await expect(page.getByText('Férias canceladas formalmente.', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Trilha cancelada', { exact: true })).toBeVisible();
  await expect(page.getByText('Férias canceladas formalmente pelo RH.', { exact: true })).toBeVisible();
});
