import { expect, test } from '@playwright/test';

import { E2E_USER } from '../support/global-setup';

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthsAgo = (count: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 15)).toISOString().slice(0, 7);
};
const cardName = (competence: string) => new RegExp(`^${MONTH_NAMES[Number(competence.slice(5, 7)) - 1]}`);

test('Fechamento do ponto: mês aberto abre no registro da pessoa; mês fechado mantém a visão da organização', async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  // Dois meses já terminados: um aberto (com alertas do servidor) e um fechado.
  const openMonth = monthsAgo(2);
  const closedMonth = monthsAgo(3);
  const date = (day: number) => `${openMonth}-${String(day).padStart(2, '0')}`;
  const shift = (day: number) => ({ date: date(day), type: 'work', startTime: '10:00', endTime: '16:15', overnight: false, unitId: 'unit-e2e', unitName: 'Unidade E2E',
    shiftName: 'Turno E2E', breakType: 'fixed', breakStart: '13:00', breakEnd: '13:15', breakDurationMinutes: 15, expectedPunches: 4 });
  const marking = (day: number, time: string, nsr: number) => ({ receiptId: `${nsr}`.padStart(64, 'a'), workDate: date(day), nsr, markedAt: `${date(day)}T${time}:00-0300`,
    executionUnitId: 'unit-e2e', receiptStatus: 'available' });
  const person = (uid: string, name: string, absences: unknown[] = []) => ({ uid, name, adjustments: [], absences, shiftSwaps: [] });
  const automatic = { id: 'automatic-e2e', typeName: 'Falta injustificada automática', startDate: date(6), endDate: date(6), startTime: null, endTime: null,
    quantity: 1, unit: 'day', status: 'approved', approval: 'automatic_timeout', decidedBy: null, decidedAt: null, attachmentCount: 0, automatic: true };
  const people = [person('closure-ana-e2e', 'Ana Fechamento E2E'), person('closure-bia-e2e', 'Bia Fechamento E2E', [automatic])];
  const counts = { adjustments: 0, absences: 0, shiftSwaps: 0 };
  const alertCalls: string[] = [];

  // A lista de meses volta sempre para o ano atual; o mês do ensaio pode estar no ano anterior.
  const openCard = async (competence: string) => {
    if (competence.slice(0, 4) !== String(new Date().getUTCFullYear())) await page.getByRole('button', { name: /encerrado/ }).click();
    await page.getByRole('button', { name: cardName(competence) }).click();
  };

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('E-mail').fill(E2E_USER.email);
  await page.getByLabel('Senha').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });

  await page.route('**/api/dp/time-recording/**', (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const competence = url.searchParams.get('competence') ?? '';
    if (url.pathname.endsWith('/closures')) {
      if (url.searchParams.get('alerts')) {
        alertCalls.push(competence);
        return json({ expectedVersion: 0, pendingOutsideScope: 0, alerts: [{ employeeUid: 'closure-bia-e2e', date: date(7), incidents: ['odd'], fingerprint: 'f', unitIds: [], canJustify: true, decision: null }] });
      }
      if (url.searchParams.get('payroll')) return json({ competence, version: 1, ready: false, total: 0, readyCount: 0, people: [] });
      const closure = competence === closedMonth ? { status: 'closed', version: 1, closedAt: `${closedMonth}-28T12:00:00.000Z`, closedBy: E2E_USER.uid, manifestHash: 'c'.repeat(64), changes: null, reopenings: [] } : null;
      return json({ competence, closure, people, pending: counts, counts, truncated: false, can: { close: true, reopen: true } });
    }
    if (url.pathname.includes('/employees/')) {
      const uid = url.pathname.split('/').pop()!;
      const bia = uid === 'closure-bia-e2e';
      return json({ employee: { uid, name: people.find((item) => item.uid === uid)?.name ?? uid },
        schedule: { month: openMonth, shifts: [shift(5), shift(6), shift(7)], truncated: false },
        history: { truncated: false, markings: bia
          ? [marking(5, '09:58', 1), marking(5, '13:00', 2), marking(5, '13:15', 3), marking(5, '16:15', 4), marking(7, '09:57', 5), marking(7, '13:02', 6), marking(7, '13:18', 7)]
          : [5, 6, 7].flatMap((day) => [marking(day, '10:00', day * 10 + 1), marking(day, '13:00', day * 10 + 2), marking(day, '13:15', day * 10 + 3), marking(day, '16:15', day * 10 + 4)]) },
        absences: [], adjustments: [], treatments: [], unitNames: { 'unit-e2e': 'Unidade E2E' } });
    }
    if (url.pathname.endsWith('/closing-progress')) return json({ counts: { total: 2, closed: 0, pending: 2, overdue: 0 }, people: [], overdue: [], finalization: null });
    if (url.pathname.endsWith('/time-bank')) return json({ policy: null, statement: null, closures: {}, previewCompetences: [] });
    if (url.pathname.endsWith('/day-corrections')) return json({ items: [] });
    // O botão de ponto do topo consulta as opções em qualquer página.
    if (url.pathname.endsWith('/options')) return json({ workDate: date(1), eligible: false, markingEnabled: false, executionUnits: [],
      officialClock: { available: true, instant: `${date(1)}T12:00:00.000Z`, timeZone: 'America/Belem' } });
    return route.fallback();
  });

  await page.goto('/dashboard/dp/fechamento', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Fechamento do ponto' })).toBeVisible({ timeout: 180_000 });
  // As pessoas fictícias não têm cadastro: o fechamento as agrupa em "Sem unidade financeira".
  await page.locator('aside').getByRole('button', { name: /Sem unidade financeira/ }).click();
  await openCard(openMonth);

  // Abre direto na primeira pessoa com algo a tratar (Bia, a segunda da lista).
  await expect(page.getByRole('heading', { name: 'Bia Fechamento E2E', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('1 trava o fechamento')).toBeVisible();
  await expect(page.getByLabel('1 dia com alerta que trava')).toBeVisible();
  await expect(page.getByLabel('1 falta automática')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Falta automática' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Dia sem batidas' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'trava o fechamento' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('registro-da-pessoa.png'), fullPage: true });
  await page.getByText('Mês em um olhar').click();
  await page.getByText('Horas do mês (prévia)').click();
  await page.screenshot({ path: testInfo.outputPath('cards-abertos.png'), fullPage: true });

  await expect(page.locator('aside').getByText('sem pedido nem alerta que trave').first()).toBeVisible();
  await expect(page.getByText('1 de 2 sem pedido nem alerta que trave')).toBeVisible();
  // A fila do modal é a mesma do botão.
  await page.getByRole('button', { name: 'Tratar 1 dia', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Dia 1 de 1 a tratar')).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('1 · Evidências do dia')).toBeVisible();
  await expect(dialog.getByText('2 · Decisão do DP')).toBeVisible();
  await expect(dialog.getByText('Trava o fechamento', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('navigation', { name: 'Dias a tratar' }).getByRole('button')).toHaveCount(1);
  await expect(dialog.getByRole('img', { name: 'Batidas às 09:57, 13:02, 13:18' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Devolver dia ao colaborador' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('modal-do-dia.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();

  // Abrir o dia e fechar sem decidir não relê os alertas da equipe.
  const before = alertCalls.length;
  await page.getByRole('button', { name: new RegExp(`^Abrir dia 07/${openMonth.slice(5, 7)}`) }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();
  expect(alertCalls.length).toBe(before);

  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(page.getByRole('heading', { name: 'Ana Fechamento E2E', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Visão da organização' }).click();
  await expect(page.getByRole('button', { name: 'Conferir e fechar competência' })).toBeVisible();
  await expect(page.getByText('1 dia com alerta que trava nesta organização')).toBeVisible();
  await expect(page.getByText('o sistema ainda confere dias devolvidos')).toBeVisible();
  await expect(page.getByText('Nenhuma pendência', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ana Fechamento E2E', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('visao-da-organizacao.png'), fullPage: true });

  await page.getByRole('button', { name: '← Todos os meses' }).click();
  await openCard(closedMonth);
  await expect(page.getByText('Fechada · versão 1').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Consultar justificativas do fechamento' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Fechamento E2E/ })).toHaveCount(0);
  expect(alertCalls).not.toContain(closedMonth);
});
