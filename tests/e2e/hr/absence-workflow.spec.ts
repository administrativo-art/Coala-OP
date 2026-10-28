import { expect, test } from '@playwright/test';

import { E2E_ABSENCE_BENEFICIARY, E2E_USER } from '../support/global-setup';

const input = { absenceTypeId: 'e2e-absence', startDate: '2026-11-10', endDate: '2026-11-12', unit: 'day' };
const preparationId = '11111111-1111-4111-8111-111111111111';
const base = {
  id: 'absence-e2e-request', status: 'draft', version: 1, revision: 0, input, quantity: 3, unit: 'day',
  typeId: 'e2e-absence', typeVersion: 2, stage: null, typeName: 'Ausência E2E', attachmentCount: 1,
  createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z',
  beneficiaryUid: E2E_USER.uid, beneficiaryName: 'Administrador E2E', requesterUid: E2E_USER.uid, assignedReviewerIds: [],
  canSubmit: true, canReview: false, canCancel: true, canConfirmProfile: false, profileReviewRequired: false,
  attachments: [{ id: preparationId, mime: 'application/pdf', size: 20, canRead: true }],
  history: [{ action: 'created', actorUid: E2E_USER.uid, at: '2026-10-15T12:00:00.000Z', version: 1 }],
};

test('cria rascunho com comprovante, envia e analisa pedido atribuído', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  let mine: typeof base | null = null;
  let thirdParty: typeof base | null = null;
  const review = { ...base, id: 'absence-e2e-review', status: 'in_review', version: 2, stage: 'dp',
    beneficiaryUid: 'another-collaborator', beneficiaryName: 'Pessoa em análise E2E', requesterUid: 'another-collaborator', assignedReviewerIds: [E2E_USER.uid],
    canSubmit: false, canReview: true, canCancel: false,
    history: [{ action: 'submit', actorUid: 'another-collaborator', at: '2026-10-15T12:00:00.000Z', version: 2 }],
  };
  let reviewed = false;
  let created = 0;
  let submitted = 0;
  let edited = 0;
  let thirdPartyCreated = false;
  let thirdPartyPrepared = false;
  let thirdPartyPreviewed = false;
  let noticeMarked = false;

  await page.route('**/api/collaborator/requests', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) }));
  await page.route(/\/api\/collaborator\/absence-requests\/options(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    absenceTypes: [{ id: 'e2e-absence', name: 'Ausência E2E', units: ['day'], calculation: 'calendar_days', attachmentRequired: true, validFrom: '1900-01-01', validTo: null, color: 'blue' }],
    capabilities: { canCreate: true, catalogDatabase: 'coala-rh' },
  }) }));
  await page.route('**/api/collaborator/absence-requests/preview', (route) => {
    if (route.request().postDataJSON().beneficiaryUid === E2E_ABSENCE_BENEFICIARY.uid) thirdPartyPreviewed = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: {
    previewOnly: true, canSubmit: false, source: 'coala-rh',
    absenceType: { id: 'e2e-absence', name: 'Ausência E2E', lineageId: 'e2e-absence', version: 2, validFrom: '1900-01-01', validTo: null },
    rule: { id: 'rule-e2e', name: 'Regra E2E', snapshot: {} },
    period: { startDate: input.startDate, endDate: input.endDate, startTime: null, endTime: null },
    quantity: { value: 3, unit: 'day', calculation: 'calendar_days' }, approvalFlow: 'dp', attachmentRequired: true,
    instructions: null, limits: { maxUnitsPerRequest: 5, maxUnitsPerPeriod: null, limitPeriod: null, remaining: null, minimumNoticeDays: 0, maximumRetroactiveDays: 0 },
    pending: ['historical_profile_unverified', 'document_required', 'approval_and_submission_unavailable'],
  } }) });
  });
  await page.route('**/api/collaborator/absence-requests/preparations', (route) => {
    const proposedRequestId = route.request().postData()?.match(/name="proposedRequestId"\r\n\r\n([0-9a-f-]{36})/i)?.[1];
    expect(proposedRequestId).toMatch(/^[0-9a-f-]{36}$/);
    if (route.request().postData()?.includes(E2E_ABSENCE_BENEFICIARY.uid)) thirdPartyPrepared = true;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ proposedRequestId, preparationIds: [preparationId], expiresAt: '2026-11-01T00:00:00Z' }) });
  });
  await page.route(/\/api\/collaborator\/absence-requests(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      expect(data.request).toEqual(input);
      expect(data.preparationIds).toEqual([preparationId]);
      expect(data.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      created++;
      if (data.beneficiaryUid) {
        expect(data.beneficiaryUid).toBe(E2E_ABSENCE_BENEFICIARY.uid);
        thirdPartyCreated = true;
        thirdParty = { ...base, id: 'absence-e2e-third-party', beneficiaryUid: data.beneficiaryUid, beneficiaryName: E2E_ABSENCE_BENEFICIARY.name };
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ request: thirdParty }) });
      } else {
        mine = { ...base };
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ request: mine }) });
      }
      return;
    }
    const team = url.searchParams.get('scope') === 'team';
    if (team && thirdPartyCreated) {
      expect(url.searchParams.get('status')).toBe('draft');
      expect(url.searchParams.get('beneficiaryUid')).toBe(E2E_ABSENCE_BENEFICIARY.uid);
    }
    const rows = url.searchParams.get('scope') === 'review' ? (reviewed ? [] : [review]) : team ? (thirdParty ? [thirdParty] : []) : mine ? [mine] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: rows, nextCursor: null }) });
  });
  await page.route('**/api/collaborator/absence-requests/absence-e2e-third-party', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ request: thirdParty }),
  }));
  await page.route(/\/api\/collaborator\/absence-requests\/(absence-e2e-request|absence-e2e-review)$/, async (route) => {
    const own = route.request().url().endsWith('absence-e2e-request');
    if (route.request().method() === 'PATCH') {
      const data = route.request().postDataJSON();
      expect(data.operationId).toMatch(/^[0-9a-f-]{36}$/);
      if (own) {
        if (data.action === 'update_draft') {
          expect(data).toMatchObject({ action: 'update_draft', expectedVersion: 1, request: input, preparationIds: [] });
          edited++;
          mine = { ...base, version: 2, revision: 1, history: [...base.history, { action: 'update_draft', actorUid: E2E_USER.uid, at: '2026-10-15T12:00:00.000Z', version: 2 }] };
        } else {
          expect(data).toMatchObject({ action: 'submit', expectedVersion: 2 });
          submitted++;
          mine = { ...base, status: 'in_review', version: 3, canSubmit: false, canCancel: true };
        }
      } else {
        expect(data).toMatchObject({ action: 'approve', expectedVersion: 2 });
        reviewed = true;
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: own ? mine : reviewed ? { ...review, status: 'approved', version: 3, canReview: false } : review }) });
  });
  const noticeId = 'a'.repeat(64);
  await page.route(/\/api\/user-notifications(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ ids: [noticeId] });
      noticeMarked = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ marked: 1 }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [{ id: noticeId, title: 'Aviso de ausência', body: 'Pedido em análise', path: '/dashboard/dp/requests', eventId: 'e2e-event', createdAt: '2026-10-15T12:00:00.000Z', readAt: null }], nextCursor: null }) });
  });

  await page.goto('/dashboard/collaborator/requests?new=absence_preview', { waitUntil: 'domcontentloaded' });
  const previewPanel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Solicitar ausência' }) });
  await previewPanel.getByRole('combobox', { name: 'Tipo de ausência' }).click();
  await page.getByRole('option', { name: 'Ausência E2E' }).click();
  await previewPanel.getByLabel('Data de início').fill(input.startDate);
  await previewPanel.getByLabel('Data de término').fill(input.endDate);
  await previewPanel.locator('input[type="file"]').setInputFiles({ name: 'comprovante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await previewPanel.getByRole('button', { name: 'Concluir' }).click();
  await previewPanel.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('heading', { name: 'Meus pedidos de ausência' })).toBeVisible();
  await page.getByRole('button', { name: /Ausência E2E.*10\/11\/2026/ }).click();
  const detail = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Ausência E2E' }) });
  await detail.getByRole('button', { name: 'Editar rascunho' }).click();
  const editPanel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Editar rascunho de ausência' }) });
  await editPanel.getByRole('button', { name: 'Concluir' }).click();
  await editPanel.getByRole('button', { name: 'Salvar revisão' }).click();
  await expect(editPanel).toBeHidden();
  expect(edited).toBe(1);
  await page.getByRole('button', { name: /Ausência E2E.*10\/11\/2026/ }).click();
  await detail.getByRole('button', { name: 'Enviar solicitação' }).click();
  await expect(detail.getByText('Em análise')).toBeVisible();
  expect(created).toBe(1);
  expect(submitted).toBe(1);

  await page.goto('/dashboard/dp/requests', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Ausência E2E.*10\/11\/2026/ }).click();
  const reviewPanel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Ausência E2E' }) });
  await expect(reviewPanel.getByText('Pessoa em análise E2E', { exact: true })).toBeVisible();
  await reviewPanel.getByRole('button', { name: 'Aprovar solicitação' }).click();
  await expect(reviewPanel.getByText('Aprovada')).toBeVisible();
  expect(reviewed).toBe(true);
  await reviewPanel.getByRole('button', { name: 'Fechar' }).click();

  await page.getByRole('button', { name: 'Notificações' }).click();
  await expect(page.getByText('Aviso de ausência')).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como lido' }).click();
  await expect.poll(() => noticeMarked).toBe(true);

  await page.getByRole('button', { name: 'Nova ausência' }).click();
  await page.getByRole('combobox', { name: 'Colaborador' }).click();
  await page.getByRole('option', { name: E2E_ABSENCE_BENEFICIARY.name }).click();
  await page.getByRole('button', { name: 'Preencher ausência' }).click();
  const thirdPanel = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Solicitar ausência' }) });
  await expect(thirdPanel.getByText(`Solicitação para ${E2E_ABSENCE_BENEFICIARY.name}`)).toBeVisible();
  await thirdPanel.getByRole('combobox', { name: 'Tipo de ausência' }).click();
  await page.getByRole('option', { name: 'Ausência E2E' }).click();
  await thirdPanel.getByLabel('Data de início').fill(input.startDate);
  await thirdPanel.getByLabel('Data de término').fill(input.endDate);
  await thirdPanel.locator('input[type="file"]').setInputFiles({ name: 'comprovante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await thirdPanel.getByRole('button', { name: 'Concluir' }).click();
  await thirdPanel.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect.poll(() => thirdPartyCreated).toBe(true);
  expect(thirdPartyPreviewed).toBe(true);
  expect(thirdPartyPrepared).toBe(true);
  await expect(thirdPanel).toBeHidden();
  const thirdRow = page.getByRole('button', { name: new RegExp(`${E2E_ABSENCE_BENEFICIARY.name}.*Ausência E2E.*Rascunho`) });
  await expect(thirdRow).toBeVisible();
  await thirdRow.click();
  const thirdDetail = page.locator('[data-ui="side-panel"]').filter({ has: page.getByRole('heading', { name: 'Ausência E2E' }) });
  await expect(thirdDetail.getByText(E2E_ABSENCE_BENEFICIARY.name, { exact: true })).toBeVisible();
  await expect(thirdDetail.getByRole('button', { name: 'Enviar solicitação' })).toBeVisible();
});
