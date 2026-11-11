import { expect, test } from '@playwright/test';

import { E2E_USER } from '../support/global-setup';

test('guia interativo funciona no celular, tablet e desktop sem PDF exposto', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page.getByRole('button', { name: 'Entrar no sistema' })).toBeHidden();

  await page.goto('/dashboard/goals/guide');
  await expect(page.locator('.gm-pg')).toHaveCount(14);
  await expect(page.getByText('R$ 960').first()).toBeVisible();
  await expect(page.locator('.gm-root a[download], .gm-root iframe, .gm-root object')).toHaveCount(0);

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.gm-root')).toBeVisible();
    const overflow = await page.locator('.gm-root').evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, `overflow do guia em ${width}px`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/goal-guide-${width}.png` });
  }

  await page.getByRole('button', { name: 'Aumentar Dias da folguista' }).first().click();
  await expect(page.getByText('R$ 192').first()).toBeVisible();

  const shortcuts = page.locator('.gm-atalhos');
  await expect(shortcuts.getByRole('button', { name: 'Exemplo do guia' })).toHaveCount(0);
  const alvo = shortcuts.getByRole('button', { name: /Meta Alvo/ });
  const up = shortcuts.getByRole('button', { name: /Meta UP/ });
  const top = shortcuts.getByRole('button', { name: /Meta TOP/ });
  await up.click();
  await expect(alvo).toHaveClass(/\bon\b/);
  await expect(up).toHaveClass(/\bon\b/);
  await expect(top).not.toHaveClass(/\bon\b/);
  await top.click();
  await expect(alvo).toHaveClass(/\bon\b/);
  await expect(up).toHaveClass(/\bon\b/);
  await expect(top).toHaveClass(/\bon\b/);
});
