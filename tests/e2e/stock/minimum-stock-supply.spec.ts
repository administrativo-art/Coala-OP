import { expect, test, type Page } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { assertFirestoreEmulatorSafety } from '../../helpers/firestore-emulator-safety.mjs';
import { E2E_STOCK_MIN, E2E_USER } from '../support/global-setup';

function adminDb() {
  assertFirestoreEmulatorSafety({ projectId: 'demo-coala-e2e' });
  const app = getApps().find((entry) => entry.name === 'coala-e2e-stock-min')
    ?? initializeApp({ projectId: 'demo-coala-e2e' }, 'coala-e2e-stock-min');
  return getFirestore(app, 'coala');
}

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });
}

test('define o CD como unidade de abastecimento e o grupo que ele atende', async ({ page }) => {
  test.setTimeout(300_000);
  const db = adminDb();
  // Quiosque sem nome (legado/integração): a tela de unidades não pode quebrar por causa dele.
  // Criado só neste teste para não afetar outras telas que ordenam quiosques por nome.
  const nameless = db.collection('kiosks').doc('kiosk-sem-nome-e2e');
  await nameless.set({ pdvFilialId: 'e2e-sem-nome' });
  try {
    await runUnitsFlow(page, db);
  } finally {
    await nameless.delete();
  }
});

async function runUnitsFlow(page: Page, db: ReturnType<typeof adminDb>) {
  await login(page);

  await page.goto('/dashboard/settings?department=operacional&tab=units', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Ações do grupo Grupo CD E2E' }).click();
  await page.getByRole('menuitem', { name: 'Editar grupo' }).click();
  await expect(page.getByTestId('group-supplied-groups')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('checkbox', { name: 'Abastece Grupo Lojas E2E' }).click();
  await page.getByRole('button', { name: 'Salvar grupo' }).click();
  await expect(page.getByRole('button', { name: 'Salvar grupo' })).toBeHidden({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Ações da unidade CD E2E' }).click();
  await page.getByRole('menuitem', { name: 'Editar unidade' }).click();
  await expect(page.getByTestId('unit-stock-role')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('combobox', { name: 'Função no estoque' }).click();
  await page.getByRole('option', { name: 'Unidade de abastecimento' }).click();
  await page.getByRole('button', { name: /^Salvar unidade$|^Salvar$/ }).click();
  await expect(page.getByTestId('unit-stock-role')).toBeHidden({ timeout: 60_000 });

  await expect.poll(async () => (await db.collection('dp_unitGroups').doc(E2E_STOCK_MIN.cdGroupId).get()).get('suppliedGroupIds'))
    .toEqual([E2E_STOCK_MIN.storesGroupId]);
  await expect.poll(async () => (await db.collection('dp_units').doc(E2E_STOCK_MIN.cdUnitId).get()).get('stockRole'))
    .toBe('supply');
  // a unidade comercial continua sem função gravada (padrão)
  expect((await db.collection('dp_units').doc(E2E_STOCK_MIN.storeUnitId).get()).get('stockRole')).toBeUndefined();
}

test('estoque mínimo fica bloqueado enquanto a automação calcula e libera com "Manter valor manual"', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);

  await page.goto('/dashboard/settings?department=operacional&tab=cadastros', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /Insumo base/ }).click();
  await page.getByText('INSUMO E2E ESTOQUE', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText('INSUMO E2E ESTOQUE', { exact: true }).first().locator('xpath=ancestor::tr').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();

  await page.getByRole('button', { name: /Parâmetros por quiosque|Próximo|Avançar/ }).first().click();

  const cdMin = page.getByRole('spinbutton', { name: 'Estoque mínimo — CD E2E' });
  const cdManual = page.getByRole('switch', { name: 'Manter valor manual — CD E2E' });
  const storeMin = page.getByRole('spinbutton', { name: 'Estoque mínimo — Loja E2E' });

  await expect(page.getByText('Manter valor manual', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(cdMin).toBeDisabled();
  await expect(cdMin).toHaveValue('100');
  await expect(storeMin).toBeEnabled();
  await expect(storeMin).toHaveValue('20');

  await cdManual.click();
  await expect(cdMin).toBeEnabled();
  await cdMin.fill('150');
  await cdManual.click();
  await expect(cdMin).toBeDisabled();
});
