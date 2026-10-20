import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const native = 'apps/coala-one-android/app/src/main/java/com/coalaone/go/';
const screens = readFileSync(`${native}ui/ModuleScreens.kt`, 'utf8');
const components = readFileSync(`${native}ui/Components.kt`, 'utf8');
const modulesViewModel = readFileSync(`${native}ui/ModulesViewModel.kt`, 'utf8');
const purchase = readFileSync(`${native}ui/PurchaseScreens.kt`, 'utf8');
const activity = readFileSync(`${native}MainActivity.kt`, 'utf8');
const schedule = screens.split('@Composable fun ScheduleScreen')[1]?.split('@Composable fun GoalsScreen')[0] ?? '';
const goals = screens.split('@Composable fun GoalsScreen')[1]?.split('@Composable fun SignageScreen')[0] ?? '';
const home = activity.split('@Composable private fun HomeScreen')[1]?.split('@Composable private fun ProfileScreen')[0] ?? '';

test('Escala e Metas usam o mesmo seletor de unidade acessível no cabeçalho', () => {
  assert.match(components, /fun UnitPickerHeader\([\s\S]*?label: String = "Unidade", action: String = "Trocar unidade"[\s\S]*?PickerSheet\(label, values, selected, onSelect\)/);
  assert.match(components, /clickable\(enabled = several && !busy, role = Role\.Button, onClickLabel = action\)/);
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

test('Compra local abre por unidade, retoma vínculo e nota no cartão da sangria e filtra só por organização e grupo', () => {
  const unitStep = purchase.split('// Step 2: the withdrawals of one unit')[1]?.split('val unitPurchases')[0] ?? '';
  const awaitingPurchases = purchase.split('unitPurchases.forEach')[1]?.split('/** A note kept on the phone')[0] ?? '';
  assert.match(unitStep, /Retomar vinculação/);
  assert.match(unitStep, /InlineConfirmation\("Vincular esta compra a esta sangria\?"/);
  assert.match(unitStep, /Cancelar vinculação/);
  assert.match(unitStep, /bringIntoViewRequester/);
  // A note in review sits on its withdrawal's card, with a way to give it up.
  assert.match(unitStep, /QueuedNote\(note,/);
  assert.match(purchase, /Action\("Cancelar nota", busy, secondary = true/);
  assert.doesNotMatch(awaitingPurchases, /InlineConfirmation/);
  // Step 1: unit cards only for units with withdrawals, organization in the header, groups as chips without counts.
  assert.match(purchase, /Rules\.purchaseUnitCards\(shownWithdrawals\)\.forEach[\s\S]*?vm\.openUnit\(unitId\)/);
  assert.match(purchase, /header = \{[\s\S]*?UnitPickerHeader\(organizations, state\.organizationFilter, !filtersEnabled, "Organização", "Trocar"\)/);
  assert.match(purchase, /groups\.forEach \{ \(id, name\) -> FilterChip\(state\.groupFilter == id/);
  assert.doesNotMatch(purchase, /Choices\("(Organização|Grupo)"/);
  assert.doesNotMatch(purchase, /unitFilter/);
});
