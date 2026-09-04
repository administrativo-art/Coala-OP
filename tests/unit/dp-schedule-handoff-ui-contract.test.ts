import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listSource = readFileSync('src/components/dp/dp-schedules-list.tsx', 'utf8');
const monthSource = readFileSync('src/components/dp/dp-schedule-month-view.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/dp/dp-schedules-sidebar.tsx', 'utf8');
const editorSource = readFileSync('src/components/dp/dp-schedule-editor.tsx', 'utf8');
const bulkSource = readFileSync('src/components/dp/dp-bulk-shift-edit-dialog.tsx', 'utf8');

test('lista mantém planejamento por ano, inclusão de mês e exportação global', () => {
  assert.match(listSource, /Meses de escala/);
  assert.match(listSource, /Adicionar mês/);
  assert.match(listSource, /Exportar para o Bizneo/);
  assert.match(listSource, /Array\.from\(\{ length: 12 \}/);
  assert.match(listSource, /alreadyStarted/);
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

test('editor expõe grade operacional, fila Bizneo e modais de apoio', () => {
  assert.match(editorSource, />Turnos</);
  assert.match(editorSource, /Folgas &amp; férias/);
  assert.match(editorSource, />Alertas</);
  assert.match(editorSource, /Fila do Bizneo/);
  assert.match(editorSource, /Vale-transporte da escala/);
  assert.match(editorSource, /Demanda do dia/);
  assert.match(editorSource, /aria-pressed=\{onlyAlerts\}/);
  assert.match(editorSource, /collapsedWeeks/);
  assert.match(editorSource, /aria-expanded=\{!weekCollapsed\}/);
  assert.match(editorSource, /Em outras unidades/);
});

test('painel em lote oferece seleção visível, por pessoa e bloqueios de ausência', () => {
  assert.match(bulkSource, /Selecionar visíveis/);
  assert.match(bulkSource, /Selecionar por colaboradora/);
  assert.match(bulkSource, /swapDayOffWarning/);
  assert.match(bulkSource, /swapVacationWarning/);
  assert.match(bulkSource, /onRemoveSelected/);
});
