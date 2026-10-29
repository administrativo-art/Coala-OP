import { expect, test } from '@playwright/test';

import { E2E_USER, E2E_VACATION } from '../support/global-setup';

test('aprova e cancela férias com justificativa e histórico auditável', async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  await page.goto('/dashboard/dp/ferias', { waitUntil: 'domcontentloaded' });
  const employeeCard = page.getByRole('button', { name: 'Abrir férias de Colaboradora Férias E2E' });
  await expect(employeeCard).toBeVisible({ timeout: 60_000 });
  // A lista reordena quando os períodos terminam de carregar; repete o clique até a navegação acontecer.
  await expect(async () => {
    await employeeCard.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/dp/ferias/${E2E_VACATION.employeeId}$`), { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Revisar e decidir' }).click();
  await expect(page.getByText('Decisão do período', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar agendamento' })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar agendamento' }).click();

  await expect(page.getByText('Agendamento aprovado.', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Aprovado por você', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.getByRole('button', { name: 'Ver etapas' }).click();
  await expect(page.getByRole('button', { name: 'Gerar aviso' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar formalmente' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancelar formalmente' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelar férias formalmente?' })).toBeVisible();
  await page.getByPlaceholder('Informe o motivo (mínimo de 10 caracteres)').fill('Cancelamento E2E autorizado pelo RH.');
  await page.getByRole('button', { name: 'Confirmar com justificativa' }).click();

  await expect(page.getByText('Férias canceladas formalmente.', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Trilha cancelada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.locator('summary', { hasText: 'Histórico auditável' }).click();
  await expect(page.getByText('Férias canceladas formalmente pelo RH.', { exact: true })).toBeVisible();
});

test('descarte exige motivo e preserva o arquivo no histórico interno', async ({ page }) => {
  test.setTimeout(600_000);
  const { assertFirestoreEmulatorSafety } = await import('../../helpers/firestore-emulator-safety.mjs');
  assertFirestoreEmulatorSafety({ projectId: 'demo-coala-e2e' });
  const { getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { createInitialVacationWorkflow } = await import('../../../src/lib/dp-vacation-workflow');
  const app = getApps().find((entry) => entry.name === 'vacation-documents-e2e')
    ?? initializeApp({ projectId: 'demo-coala-e2e' }, 'vacation-documents-e2e');
  const db = getFirestore(app, 'coala');
  const reference = db.collection('dp_vacations').doc(E2E_VACATION.vacationId);
  const original = (await reference.get()).data()!;
  const documentId = `receipt_${'b'.repeat(32)}`;
  const workflow = createInitialVacationWorkflow({ status: 'APPROVED', startDate: original.startDate,
    endDate: original.endDate, asOfDate: '2026-01-01', now: new Date().toISOString(), actorId: E2E_USER.uid });
  workflow.currentStage = 'receipt_review';
  workflow.notice.status = 'signed';
  workflow.accountant.status = 'receipt_received';
  workflow.receipt = { ...workflow.receipt, status: 'review_pending', documents: [{ id: documentId,
    fileName: 'Documento para conferencia.pdf', mimeType: 'application/pdf', storagePath: 'synthetic/immutable.pdf',
    hashSha256: 'b'.repeat(64), size: 100, uploadedAt: new Date().toISOString(), uploadedBy: 'external:accountant',
    correctionRound: 0, status: 'review_pending' }] };
  await reference.set({ ...original, status: 'APPROVED', workflow });
  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('E-mail').fill(E2E_USER.email);
    await page.getByLabel('Senha').fill(E2E_USER.password);
    await page.getByRole('button', { name: 'Entrar no sistema' }).click();
    await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });
    await page.goto(`/dashboard/dp/ferias/${E2E_VACATION.employeeId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Ver etapas' }).first().click();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Descartar arquivo de recibo?' });
    await expect(dialog.getByRole('button', { name: 'Descartar', exact: true })).toBeDisabled();
    await dialog.getByLabel('Motivo do descarte').fill('Documento pertence a outra pessoa.');
    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/dp/vacations/${E2E_VACATION.vacationId}`)
      && response.request().method() === 'PATCH', { timeout: 120_000 });
    await dialog.getByRole('button', { name: 'Descartar', exact: true }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.getByText('Arquivo de recibo descartado.', { exact: true })).toBeVisible();
    await page.getByText('Histórico interno dos documentos (1)', { exact: true }).click();
    await expect(page.getByText('Reprovado / descartado', { exact: true })).toBeVisible();
    await expect(page.getByText('Motivo: Documento pertence a outra pessoa.', { exact: true })).toBeVisible();
    const stored = (await reference.get()).get('workflow.receipt.documents')[0];
    expect(stored.storagePath).toBe('synthetic/immutable.pdf');
    expect(stored.discardedBy).toBe(E2E_USER.uid);
    expect(stored.discardReason).toBe('Documento pertence a outra pessoa.');
  } finally {
    await reference.set(original);
    await reference.collection('receiptVersions').doc(documentId).delete();
  }
});
