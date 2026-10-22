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

const time = readFileSync(`${native}ui/TimeScreens.kt`, 'utf8');
const timeViewModel = readFileSync(`${native}ui/TimeViewModel.kt`, 'utf8');
const timeModels = readFileSync(`${native}data/TimeModels.kt`, 'utf8');
const timeOfflineStore = readFileSync(`${native}offline/TimeOfflineStore.kt`, 'utf8');
const timeOfflineWorker = readFileSync(`${native}offline/TimeOfflineWorker.kt`, 'utf8');
const timeDeviceIdentity = readFileSync(`${native}offline/TimeDeviceIdentity.kt`, 'utf8');
const profileRoute = readFileSync('src/app/api/mobile/profile/route.ts', 'utf8');
const filePaths = readFileSync('apps/coala-one-android/app/src/main/res/xml/file_paths.xml', 'utf8');

test('Ponto do Coala Go reaproveita as rotas web, bate como coletor móvel e não oferece "Todas as unidades"', () => {
  assert.match(timeModels, /data class MarkingRequest\([\s\S]*?val channel: String = "mobile"[\s\S]*?val offline: OfflineMarkingEvidence\? = null,[\s\S]*?val locationAttempt: LocationAttempt\? = null\)/);
  // The same attempt and work date are resent until the server answers, kept in saved state; 409 starts over.
  assert.match(timeViewModel, /saved\["attemptId"\] = value\?\.first; saved\["attemptDate"\] = value\?\.second/);
  assert.match(timeViewModel, /api\.mark\(MarkingRequest\(pending\.first, pending\.second,/);
  assert.match(timeViewModel, /cause\.code\(\) == 409\) \{ clearAttempt\(\)/);
  assert.match(timeViewModel, /TimeRules\.workDate\(officialNow\(state\), zone\)/);
  assert.match(time, /UnitPickerHeader\(units\.map \{ it\.id to it\.name \}, state\.unitId\.orEmpty\(\)/);
  assert.doesNotMatch(time, /Rules\.unitChoices/);
  assert.match(time, /capturePointLocation/);
  assert.match(time, /O ponto será registrado mesmo se a posição estiver indisponível, imprecisa ou fora da unidade/);
  assert.doesNotMatch(time, /ACCESS_BACKGROUND_LOCATION/);
  // Kind of punch is only suggested by order; the summary names who asks before sending an adjustment.
  assert.match(time, /sugerida pela ordem/);
  assert.match(time, /SummaryLine\("Quem pede"/);
  assert.match(time, /A batida original nunca é apagada/);
  // Receipts live in the app cache and leave only through the system viewer, share sheet or save dialog.
  assert.match(timeViewModel, /File\(directory, "receipts"\)/);
  assert.match(time, /ActivityResultContracts\.CreateDocument\("application\/pdf"\)/);
  // Banco e espelho são sob demanda; a pasta de documentos não existe no Go.
  assert.match(time, /"bank" ->[\s\S]*?vm\.loadBank\(\)/);
  assert.match(time, /"mirror" ->[\s\S]*?vm\.loadMirror\(\)/);
  assert.doesNotMatch(timeViewModel.split('fun load()')[1]?.split('fun month(')[0] ?? '', /timeBank|ownDocuments|mirror\(/);
  assert.match(time, /PillChoice\("Banco de horas"/);
  assert.match(time, /PillChoice\("Espelho"/);
  assert.match(time, /ActivityResultContracts\.CreateDocument\(mimeType\)/);
  for (const folder of ['time-documents']) {
    assert.match(filePaths, new RegExp(`path="${folder.replace('-', '\\-')}\\/"`));
    assert.match(time, new RegExp(`"${folder}"`));
    assert.match(activity, new RegExp(`"${folder}"`));
  }
  assert.doesNotMatch(timeViewModel, /ownDocuments|ownDocument\(/);
  assert.doesNotMatch(timeModels, /OwnDocument/);
  assert.doesNotMatch(filePaths, /employee-documents/);
  assert.match(time, /catch \(_: IllegalArgumentException\) \{ false \}/);
  assert.doesNotMatch(time, /setInterval|while \(true\) \{[^}]*api\./);
});

test('Ponto offline existe somente no Coala Go e não inventa NSR nem comprovante antes da sincronização', () => {
  assert.match(time, /Registrar ponto offline/);
  assert.match(time, /Ainda não há NSR nem comprovante oficial/);
  assert.match(timeViewModel, /offlineQueue\.capture/);
  assert.match(timeViewModel, /lastOffline/);
  assert.match(timeOfflineStore, /MAX_PENDING_MARKINGS = 20/);
  assert.match(timeOfflineStore, /12 \* 60 \* 60 \* 1000L/);
  assert.match(timeOfflineStore, /TimeOfflineRules\.markedAt/);
  assert.match(timeOfflineStore, /identity\.sign/);
  assert.match(timeDeviceIdentity, /AndroidKeyStore/);
  assert.match(timeDeviceIdentity, /ECGenParameterSpec\("secp256r1"\)/);
  assert.match(timeOfflineWorker, /ExistingWorkPolicy\.APPEND_OR_REPLACE/);
  assert.doesNotMatch(timeOfflineStore, /nsr|receiptId/);
});

test('Troca de turno permanece em Solicitações e consome o contrato central', () => {
  assert.match(time, /PillChoice\("Troca de turno"/);
  assert.match(time, /vm\.requestShiftSwap/);
  assert.match(time, /vm\.decideShiftSwap\(request, "accept"\)/);
  assert.match(timeViewModel, /api\.requestShiftSwap\(ShiftSwapCreate/);
  assert.match(timeViewModel, /api\.decideShiftSwap\(request\.id, ShiftSwapDecision/);
  assert.match(timeModels, /data class ShiftSwapViewerActions/);
});

test('Ponto e Solicitações aparecem só com a liberação do grupo app e a permissão de colaborador', () => {
  assert.match(profileRoute, /timeRecording: collaborator && app\?\.timeRecording\?\.mark === true/);
  assert.match(profileRoute, /requests: collaborator && app\?\.requests\?\.create === true/);
  assert.match(home, /Triple\(modules\.timeRecording, "Ponto", "time"\), Triple\(modules\.requests, "Solicitações", "requests"\)/);
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
