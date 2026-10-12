import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = 'apps/coala-one-android/app/src/main/java/com/coalaone/go/';
const screens = readFileSync(`${native}ui/ModuleScreens.kt`, 'utf8');
const components = readFileSync(`${native}ui/Components.kt`, 'utf8');
const activity = readFileSync(`${native}MainActivity.kt`, 'utf8');
const schedule = screens.split('@Composable fun ScheduleScreen')[1]?.split('@Composable fun GoalsScreen')[0] ?? '';
const goals = screens.split('@Composable fun GoalsScreen')[1]?.split('@Composable fun SignageScreen')[0] ?? '';
const home = activity.split('@Composable private fun HomeScreen')[1]?.split(/@Composable (?:private|internal) fun ColumnScope\.TodayHeader/)[0] ?? '';

test('Escala e Metas usam o mesmo seletor de unidade acessível no cabeçalho', () => {
  assert.match(components, /fun UnitPickerHeader\([\s\S]*?PickerSheet\("Unidade", values, selected, onSelect\)/);
  assert.match(components, /clickable\(enabled = several && !busy, role = Role\.Button, onClickLabel = "Trocar unidade"\)/);
  assert.match(schedule, /header = \{[\s\S]*?UnitPickerHeader\(units\.map \{ it\.id to it\.name \}, selected\?\.id\.orEmpty\(\), feedback\.busy\) \{ vm\.scheduleFilter\(it, state\.onlyMine\) \}/);
  assert.match(goals, /header = \{[\s\S]*?UnitPickerHeader\(state\.goalUnits\.map/);
  assert.doesNotMatch(schedule, /Choices\("Unidade"/);
});

test('Subtítulo inicial usa a função ou cargo do perfil sem mostrar e-mail', () => {
  assert.match(home, /Text\(homeRoleSubtitle\(state\?\.profile\?\.role\)/);
  assert.doesNotMatch(home, /profile\?\.email|profile\.email/);
});
