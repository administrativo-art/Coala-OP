import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listSource = readFileSync('src/components/dp/dp-schedules-list.tsx', 'utf8');
const monthSource = readFileSync('src/components/dp/dp-schedule-month-view.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/dp/dp-schedules-sidebar.tsx', 'utf8');
const editorSource = readFileSync('src/components/dp/dp-schedule-editor.tsx', 'utf8');
const bulkSource = readFileSync('src/components/dp/dp-bulk-shift-edit-dialog.tsx', 'utf8');
const bulkCreateSource = readFileSync('src/components/dp/dp-bulk-shift-create-dialog.tsx', 'utf8');
const schedulePageSource = readFileSync('src/app/dashboard/dp/schedules/[id]/page.tsx', 'utf8');
const publicationSource = readFileSync('src/features/dp/schedules/publication-service.server.ts', 'utf8');
const publishRouteSource = readFileSync('src/app/api/dp/schedules/[scheduleId]/publish/route.ts', 'utf8');
const schedulesShiftsHookSource = readFileSync('src/hooks/use-dp-schedules-shifts.ts', 'utf8');

test('lista mantém planejamento por ano, inclusão de mês e exportação global', () => {
  assert.match(listSource, /Meses de escala/);
  assert.match(listSource, /Adicionar mês/);
  assert.match(listSource, /Exportar para o Bizneo/);
  assert.match(listSource, /Array\.from\(\{ length: 12 \}/);
  assert.match(listSource, /alreadyStarted/);
  assert.match(listSource, /buildMonthlyTransportVoucherSummaries/);
  assert.match(listSource, /Vale-transporte/);
  assert.match(listSource, /PopoverContent/);
  assert.match(schedulesShiftsHookSource, /Promise\.allSettled/);
  assert.match(schedulesShiftsHookSource, /failedScheduleIds/);
});

test('visão mensal agrupa unidades por estado e cidade sem ação criar por linha', () => {
  assert.match(monthSource, /groupedByState/);
  assert.match(monthSource, /BRAZILIAN_STATE_NAMES/);
  assert.match(monthSource, /DPSchedulesSidebar/);
  assert.match(sidebarSource, /Todos os meses/);
  assert.match(sidebarSource, /dias preenchidos/);
  assert.doesNotMatch(monthSource, />\s*Criar\s*</);
  assert.doesNotMatch(monthSource, /Adicionar unidade/);
});

test('editor expõe grade operacional e modais de apoio sem fila Bizneo no cabeçalho', () => {
  assert.match(editorSource, />Turnos</);
  assert.match(editorSource, /Folgas &amp; férias/);
  assert.match(editorSource, />Alertas</);
  assert.doesNotMatch(editorSource, /Fila do Bizneo|Bizneo ·/);
  assert.match(editorSource, /Vale-transporte da escala/);
  assert.match(editorSource, /Demanda do dia/);
  assert.match(editorSource, /aria-pressed=\{onlyAlerts\}/);
  assert.match(editorSource, /collapsedWeeks/);
  assert.match(editorSource, /aria-expanded=\{!weekCollapsed\}/);
  assert.match(editorSource, /Em outras unidades/);
});

test('horários do editor ficam somente leitura quando um turno é selecionado', () => {
  assert.match(editorSource, /const selectedShiftDefinitionId = form\.watch\('shiftDefinitionId'\)/);
  assert.match(editorSource, /const hasSelectedShiftDefinition = Boolean\(selectedShiftDefinitionId\)/);
  assert.strictEqual((editorSource.match(/readOnly=\{hasSelectedShiftDefinition\}/g) ?? []).length, 2);
  assert.strictEqual((editorSource.match(/aria-readonly=\{hasSelectedShiftDefinition\}/g) ?? []).length, 2);
});

test('edição em lote oferece seleção visível, por pessoa e bloqueios de ausência', () => {
  assert.match(bulkSource, /Selecionar visíveis/);
  assert.match(bulkSource, /Selecionar por colaboradora/);
  assert.match(bulkSource, /swapDayOffWarning/);
  assert.match(bulkSource, /swapVacationWarning/);
  assert.match(bulkSource, /onRemoveSelected/);
});

test('preenchimento em lote separa pessoas, dias e turno sem sobrescrever ocorrências', () => {
  assert.match(editorSource, /Preencher em lote/);
  assert.match(bulkCreateSource, /Cria turnos somente nos dias vazios/);
  assert.match(bulkCreateSource, /existingKeys/);
  assert.match(bulkCreateSource, /Dias úteis/);
  assert.match(bulkCreateSource, /Horário definido pelo cadastro do turno/);
});

test('editor busca uma escala histórica sem cancelar a própria requisição', () => {
  const lookupEffect = schedulePageSource.slice(
    schedulePageSource.indexOf('useEffect(() => {'),
    schedulePageSource.indexOf("if (!permissions.dp?.schedules?.view)"),
  );
  assert.match(lookupEffect, /fetchSchedule\(id\)/);
  assert.doesNotMatch(lookupEffect, /\|\| lookupLoading/);
  assert.doesNotMatch(lookupEffect, /lookupError, lookupLoading,/);
});

test('publicação usa validação autoritativa de jornada e rejeita resultado obsoleto', () => {
  assert.match(editorSource, /useDPScheduleJourneyValidation\(schedule\.id\)/);
  assert.match(editorSource, /Publicar novamente/);
  assert.match(editorSource, /Situação:/);
  assert.match(publishRouteSource, /dp\.schedules\.publish/);
  assert.match(publicationSource, /validateScheduleJourneys/);
  assert.match(publicationSource, /DP_SCHEDULE_JOURNEY_BLOCKED/);
  assert.match(publicationSource, /journeyValidationVersion/);
});
