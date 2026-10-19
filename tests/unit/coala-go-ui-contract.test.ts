import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const native = 'apps/coala-one-android/app/src/main/java/com/coalaone/go/';
const screens = readFileSync(`${native}ui/ModuleScreens.kt`, 'utf8');
const components = readFileSync(`${native}ui/Components.kt`, 'utf8');
const modulesViewModel = readFileSync(`${native}ui/ModulesViewModel.kt`, 'utf8');
const activity = readFileSync(`${native}MainActivity.kt`, 'utf8');
const schedule = screens.split('@Composable fun ScheduleScreen')[1]?.split('@Composable fun GoalsScreen')[0] ?? '';
const goals = screens.split('@Composable fun GoalsScreen')[1]?.split('@Composable fun SignageScreen')[0] ?? '';
const home = activity.split('@Composable private fun HomeScreen')[1]?.split('@Composable private fun ProfileScreen')[0] ?? '';

test('Escala e Metas usam o mesmo seletor de unidade acessível no cabeçalho', () => {
  assert.match(components, /fun UnitPickerHeader\([\s\S]*?PickerSheet\("Unidade", values, selected, onSelect\)/);
  assert.match(components, /clickable\(enabled = several && !busy, role = Role\.Button, onClickLabel = "Trocar unidade"\)/);
  // Every dropdown or unfolding arrow is the one drawn chevron, never a font glyph (docs/design/app.md).
  assert.match(components, /fun DropdownChevron\(open: Boolean, color: Color/);
  assert.match(components, /DropdownChevron\(choosingUnit, Tokens\.pink\)/);
  for (const file of readdirSync(`${native}ui`)) assert.doesNotMatch(readFileSync(`${native}ui/${file}`, 'utf8'), /"[^"\n]*[⌄⌃▾▼▴▲][^"\n]*"/, file);
  // Both offer "Todas as unidades" through the shared rule, never a hand-made entry.
  assert.match(schedule, /header = \{[\s\S]*?UnitPickerHeader\(Rules\.unitChoices\(units\.map \{ it\.id to it\.name \}\), choice, feedback\.busy\) \{ vm\.scheduleFilter\(it, state\.onlyMine\) \}/);
  assert.match(goals, /header = \{[\s\S]*?UnitPickerHeader\(Rules\.unitChoices\(state\.goalUnits\.map/);
  // Escala opens on "Todas as unidades": the state default and the reset on each visit.
  assert.match(schedule, /if \(!opened\) \{ opened = true; vm\.scheduleFilter\(Rules\.ALL_UNITS, state\.onlyMine\) \}/);
  assert.match(modulesViewModel, /selectedScheduleUnit: String = Rules\.ALL_UNITS/);
  assert.doesNotMatch(schedule, /Choices\("Unidade"/);
});

test('Subtítulo inicial usa a função ou cargo do perfil sem mostrar e-mail', () => {
  assert.match(home, /Text\(homeRoleSubtitle\(state\?\.profile\?\.role\)/);
  assert.doesNotMatch(home, /profile\?\.email|profile\.email/);
});

test('Barra do início não tem resumo deslizante: só os dados da própria barra', () => {
  assert.doesNotMatch(activity, /TodayHeader|draggable|Deslize para/);
});

const time = readFileSync(`${native}ui/TimeScreens.kt`, 'utf8');
const timeViewModel = readFileSync(`${native}ui/TimeViewModel.kt`, 'utf8');
const timeModels = readFileSync(`${native}data/TimeModels.kt`, 'utf8');
const profileRoute = readFileSync('src/app/api/mobile/profile/route.ts', 'utf8');

test('Ponto do Coala Go reaproveita as rotas web, bate como coletor móvel e não oferece "Todas as unidades"', () => {
  assert.match(timeModels, /data class MarkingRequest\([^)]*val channel: String = "mobile"\)/);
  // The same attempt and work date are resent until the server answers, kept in saved state; 409 starts over.
  assert.match(timeViewModel, /saved\["attemptId"\] = value\?\.first; saved\["attemptDate"\] = value\?\.second/);
  assert.match(timeViewModel, /api\.mark\(MarkingRequest\(pending\.first, pending\.second,/);
  assert.match(timeViewModel, /cause\.code\(\) == 409\) \{ attempt = null/);
  assert.match(timeViewModel, /TimeRules\.workDate\(officialNow\(state\), zone\)/);
  assert.match(time, /UnitPickerHeader\(units\.map \{ it\.id to it\.name \}, state\.unitId\.orEmpty\(\)/);
  assert.doesNotMatch(time, /Rules\.unitChoices/);
  // Kind of punch is only suggested by order; the summary names who asks before sending an adjustment.
  assert.match(time, /sugerida pela ordem/);
  assert.match(time, /SummaryLine\("Quem pede"/);
  assert.match(time, /A batida original nunca é apagada/);
  // Receipts live in the app cache and leave only through the system viewer, share sheet or save dialog.
  assert.match(timeViewModel, /File\(directory, "receipts"\)/);
  assert.match(time, /ActivityResultContracts\.CreateDocument\("application\/pdf"\)/);
  assert.doesNotMatch(time, /setInterval|while \(true\) \{[^}]*api\./);
});

test('Ponto e Solicitações aparecem só com a liberação do grupo app e a permissão de colaborador', () => {
  assert.match(profileRoute, /timeRecording: collaborator && app\?\.timeRecording\?\.mark === true/);
  assert.match(profileRoute, /requests: collaborator && app\?\.requests\?\.create === true/);
  assert.match(home, /Triple\(modules\.timeRecording, "Ponto", "time"\), Triple\(modules\.requests, "Solicitações", "requests"\)/);
});
