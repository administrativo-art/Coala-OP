import { expect, test } from '@playwright/test';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { untrackedStockLotId } from '../../../src/lib/stock-lot-identity';
import { assertFirestoreEmulatorSafety } from '../../helpers/firestore-emulator-safety.mjs';
import { E2E_USER } from '../support/global-setup';

test('saldo sem lote exige escolher a origem e movimenta somente o documento selecionado', async ({ page }) => {
  test.setTimeout(300_000);
  const projectId = 'demo-coala-e2e';
  assertFirestoreEmulatorSafety({ projectId });
  const app = getApps().find(entry => entry.name === 'coala-e2e-stock-untracked')
    ?? initializeApp({ projectId }, 'coala-e2e-stock-untracked');
  const db = getFirestore(app, 'coala');

  const productId = 'e2e-stock-untracked-product';
  const productName = 'Copo sem lote E2E';
  const originId = 'kiosk-e2e';
  const destinationId = 'e2e-stock-untracked-destination';
  const destinationName = 'Destino do copo E2E';
  const targetId = untrackedStockLotId({ productId, kioskId: destinationId, lotNumber: '-' })!;
  const product = db.collection('products').doc(productId);
  const destination = db.collection('kiosks').doc(destinationId);
  const blankLot = db.collection('lots').doc('e2e-stock-untracked-blank');
  const hyphenLot = db.collection('lots').doc('e2e-stock-untracked-hyphen');
  const target = db.collection('lots').doc(targetId);
  const lotIdentity = { productId, productName, kioskId: originId };
  const movements = db.collection('movementHistory').where('productId', '==', productId);

  const seed = db.batch();
  seed.set(product, { baseName: productName, packageSize: 1, unit: 'un', packageType: 'unidade', category: 'unit', workspaceId: 'coala' });
  seed.set(destination, { name: destinationName, active: true });
  seed.set(blankLot, { ...lotIdentity, lotNumber: '', expiryDate: '', quantity: 11 });
  seed.set(hyphenLot, { ...lotIdentity, lotNumber: '-', expiryDate: null, quantity: 20, workspaceId: 'coala' });
  seed.set(target, { ...lotIdentity, kioskId: destinationId, lotNumber: 'L123', expiryDate: '2029-01-01', quantity: 50 });
  await seed.commit();

  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('E-mail').fill(E2E_USER.email);
    await page.getByLabel('Senha').fill(E2E_USER.password);
    await page.getByRole('button', { name: 'Entrar no sistema' }).click();
    await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

    const search = new URLSearchParams({ search: productName, kioskId: originId });
    await page.goto(`/dashboard/stock/inventory-control?${search}`, { waitUntil: 'domcontentloaded' });
    const group = page.locator('[id^="lot-instance-"]').filter({ hasText: 'Sem lote' });
    await expect(group).toHaveCount(1, { timeout: 60_000 });
    await expect(group).toContainText('31');
    await group.click();

    const move = page.getByRole('button', { name: 'Mover para outro quiosque' });
    await expect(move).toHaveCount(0);
    await page.getByRole('button', { name: /Entrada \d+ · 20/ }).click();
    await move.click();
    await page.getByRole('button', { name: new RegExp(destinationName) }).click();

    const confirm = page.getByRole('button', { name: 'Confirmar movimentação' });
    await confirm.click();
    await expect(page.getByText('O registro reservado para estoque sem lote tem outra identificação.', { exact: false })).toBeVisible();
    expect((await target.get()).get('quantity')).toBe(50);
    expect((await hyphenLot.get()).get('quantity')).toBe(20);

    await target.delete();
    await confirm.click();
    await expect(confirm).toBeHidden();
    await expect.poll(async () => (await target.get()).get('quantity')).toBe(1);
    expect((await target.get()).get('lotNumber')).toBe('-');
    expect((await hyphenLot.get()).get('quantity')).toBe(19);
    expect((await blankLot.get()).get('quantity')).toBe(11);
    const history = (await movements.get()).docs.map(document => document.data());
    expect(history).toHaveLength(2);
    expect(history.find(row => row.type === 'TRANSFERENCIA_SAIDA')?.lotId).toBe(hyphenLot.id);
    expect(history.find(row => row.type === 'TRANSFERENCIA_ENTRADA')?.lotId).toBe(target.id);
  } finally {
    const cleanup = db.batch();
    for (const ref of [product, destination, blankLot, hyphenLot, target, ...(await movements.get()).docs.map(document => document.ref)]) cleanup.delete(ref);
    await cleanup.commit();
  }
});
