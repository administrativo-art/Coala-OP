import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settings = fs.readFileSync('src/app/dashboard/settings/page.tsx', 'utf8');
const component = fs.readFileSync('src/components/dp/dp-settings-absences.tsx', 'utf8');
const access = fs.readFileSync('src/features/dp/time-config/access.server.ts', 'utf8');

test('ausências integra a navegação de Pessoal → Tempo entre turnos e hora extra', () => {
  assert.match(settings, /pickPersonalTabs\(\["work-journeys", "shifts", "absences", "overtime", "calendars"\]\)/);
  assert.match(settings, /label: "Ausências"/);
});

test('etapa 1 explica seu limite e oferece simulação sem efetivar solicitação', () => {
  assert.match(component, /Ainda não recebe solicitações, bloqueia escalas, lança ponto ou gera folha/);
  assert.match(component, /Simular regra/);
  assert.match(component, /Não cria solicitação/);
});

test('a API exige permissão própria e acesso global', () => {
  assert.match(access, /manageAbsences/);
  assert.match(access, /DP_ABSENCE_GLOBAL_SCOPE_REQUIRED/);
});
