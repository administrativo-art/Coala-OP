import { expect, test } from '@playwright/test';

import { E2E_USER } from '../support/global-setup';

function civilDateInBelem() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

test('Registro de ponto separa a consulta pessoal da conferência administrativa sem batida por terceiro', async ({ page }) => {
  test.setTimeout(300_000);
  const today = civilDateInBelem();
  const month = today.slice(0, 7);
  const receiptId = `${'a'.repeat(64)}_000000003`;
  const shift = { date: today, type: 'work', startTime: '08:00', endTime: '16:00', overnight: false,
    unitId: 'unit-e2e', unitName: 'Unidade E2E', shiftName: 'Turno E2E', breakType: 'fixed',
    breakStart: '12:00', breakEnd: '13:00', breakDurationMinutes: 60, expectedPunches: 4 };
  const marking = { receiptId, workDate: today, nsr: 3, markedAt: `${today}T08:00:00-0300`,
    executionUnitId: 'unit-e2e', collectorId: '02', hash: 'b'.repeat(64), receiptStatus: 'available', receiptIssue: null };

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  await page.route('**/api/dp/time-recording/options?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    workDate: today, eligible: true, markingEnabled: false,
    executionUnits: [{ id: 'unit-e2e', name: 'Unidade E2E', employer: true, timeZone: 'America/Belem', locationPolicy: { mode: 'disabled', revision: 0 } }],
    officialClock: { available: true, instant: `${today}T12:00:00.000Z`, timeZone: 'America/Belem' },
  }) }));
  await page.route('**/api/dp/time-recording/month?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ month, shifts: [shift], truncated: false }) }));
  await page.route('**/api/dp/time-recording/markings?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ startDate: `${month}-01`, endDate: today, markings: [marking], truncated: false }) }));
  await page.route('**/api/dp/time-recording/adjustments?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adjustments: [], treatments: [] }) }));
  await page.route(/\/api\/collaborator\/absence-requests(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [], nextCursor: null }) }));
  await page.route('**/api/dp/time-recording/time-bank?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ policy: null, statement: null, previewCompetences: [] }) }));
  await page.route('**/api/dp/time-recording/mirrors?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ competence: month, closure: null, mirror: null, package: null }) }));
  await page.route('**/api/dp/time-recording/employees/employee-e2e', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    employee: { uid: 'employee-e2e', name: 'Heucilene E2E' }, schedule: { month, shifts: [shift], truncated: false },
    history: { markings: [marking], truncated: false }, absences: [], adjustments: [], treatments: [], unitNames: { 'unit-e2e': 'Unidade E2E' },
  }) }));
  const locationBodies: Record<string, unknown>[] = [];
  await page.route('**/api/dp/time-recording/location-access', (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    locationBodies.push(input);
    return route.fulfill({ status: locationBodies.length === 3 ? 403 : 200, contentType: 'application/json', body: JSON.stringify(
      locationBodies.length === 1 ? { entries: [{ id: 'synthetic-location', capturedAt: `${today}T12:00:00Z`,
        position: { latitude: -1.45583, longitude: -48.50444, accuracyMeters: 15 } }], nextCursor: 'synthetic-location', auditId: 'synthetic-audit' }
        : { entries: [], nextCursor: null, auditId: 'synthetic-audit-2' }) });
  });

  await page.goto('/dashboard/collaborator/time-recording', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Registro de ponto' })).toBeVisible();
  await expect(page.getByText('Registro pelo sistema ainda não liberado')).toBeVisible();
  await expect(page.getByRole('button', { name: /Registrar 2ª de 4/ })).toBeDisabled();
  await expect(page.getByText('Turno E2E').first()).toBeVisible();
  await expect(page.getByText('08:00').first()).toBeVisible();
  const location = page.getByRole('region', { name: 'Consulta de localização' });
  await expect(location).toBeVisible();
  expect(locationBodies).toHaveLength(0);
  await location.getByRole('button', { name: 'Consultar localização' }).click();
  await expect(location.getByText(/-1.45583, -48.50444/)).toBeVisible();
  await location.screenshot({ path: '.ai-work/development-technology/rep-p-availability-location/location-panel.png' });
  expect(locationBodies[0]).toMatchObject({ employeeUid: E2E_USER.uid, reason: 'own_data', source: 'marking', unitId: 'unit-e2e', workDate: today });
  await location.getByRole('button', { name: 'Próxima página' }).click();
  await expect(location.getByText('Nenhuma localização disponível nesta página.')).toBeVisible();
  await expect(location.getByText(/-1.45583, -48.50444/)).toHaveCount(0);
  expect(locationBodies[1].cursor).toBe('synthetic-location');
  await location.getByLabel('Captura').selectOption('journey');
  await location.getByRole('button', { name: 'Consultar localização' }).click();
  await expect(location.getByRole('alert')).toBeVisible();
  await expect(location.getByText('Nenhuma localização disponível nesta página.')).toHaveCount(0);

  await page.goto('/dashboard/dp/collaborators/employee-e2e/time-recording', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Heucilene E2E')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('region', { name: 'Consulta de localização' })).toHaveCount(0);
  await expect(page.getByText('Modo de conferência.')).toBeVisible();
  await expect(page.getByText('Ela não registra ponto em nome do colaborador.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Registrar .*batida/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Solicitar ausência' })).toHaveCount(0);
});
