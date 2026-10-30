import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const native = 'apps/coala-one-android/app/src/main/java/com/coalaone/go/';
const screens = readFileSync(`${native}ui/ModuleScreens.kt`, 'utf8');
const components = readFileSync(`${native}ui/Components.kt`, 'utf8');
const modulesViewModel = readFileSync(`${native}ui/ModulesViewModel.kt`, 'utf8');
const purchase = readFileSync(`${native}ui/PurchaseScreens.kt`, 'utf8');
const activity = readFileSync(`${native}MainActivity.kt`, 'utf8');
const homeViewModel = readFileSync(`${native}ui/HomeViewModel.kt`, 'utf8');
const sessionViewModel = readFileSync(`${native}ui/SessionViewModel.kt`, 'utf8');
const theme = readFileSync(`${native}ui/Theme.kt`, 'utf8');
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

test('Resumo do ponto na Home é expansível e o cronômetro só aparece durante o intervalo', () => {
  assert.match(activity, /var summaryExpanded by rememberSaveable/);
  assert.match(activity, /onClickLabel = if \(summaryExpanded\) "Recolher resumo da jornada" else "Expandir resumo da jornada"/);
  assert.match(activity, /if \(summaryExpanded\) \{/);
  assert.match(activity, /breakStatus\?\.takeIf \{ it\.inPause \}\?\.let \{ BreakTimerPill/);
  assert.match(components, /fun BreakTimerPill\(status: BreakStatus/);
  assert.match(components, /Intervalo · faltam/);
  assert.match(components, /Intervalo excedido · \+/);
  assert.match(time, /punch\.purpose == "break_start"/);
  assert.match(time, /end\?\.purpose == "break_end"/);
  assert.match(time, /CompletedBreakPill/);
  assert.doesNotMatch(time, /status\.level != BreakLevel\.OK -> BreakNoticeCard/);
  assert.match(time, /takeIf \{ it\.level != BreakLevel\.NEUTRAL \}\?\.let \{ BreakNoticeCard/);
});

test('Início relê relógio e turno por pessoa, e o tema visual segue a hora do dia', () => {
  assert.match(home, /val dataOwner = developerViewAs\.targetUserId \?: owner/);
  assert.match(home, /val state = profileState\.visibleFor\(dataOwner\)/);
  assert.match(home, /val visibleToday = today\.visibleFor\(dataOwner\)/);
  assert.match(home, /val visiblePendingCount = if \(developerViewAs\.targetUserId == null\) pending\.size else 0/);
  assert.match(home, /pending = if \(route == "purchase"\) visiblePendingCount else 0/);
  assert.match(home, /vm\.loadToday\(it, goalUnit, dataOwner, force = true\)/);
  assert.match(home, /Lifecycle\.Event\.ON_STOP\) paused = true/);
  assert.match(home, /Lifecycle\.Event\.ON_START && paused[\s\S]*?vm\.refresh\(currentDataOwner\)[\s\S]*?vm\.loadToday\(it, goalUnit, currentDataOwner, force = true\)/);
  assert.match(home, /visibleToday\.scheduleAvailable == false -> "Turno de hoje indisponível · atualizar"/);
  assert.match(home, /visibleToday\.shift != null -> "Hoje · \$\{visibleToday\.shift\}"/);
  assert.match(homeViewModel, /fun HomeToday\.visibleFor\(contextKey: String\)[\s\S]*?it\.contextKey == contextKey/);
  assert.match(homeViewModel, /fun HomeProfile\.visibleFor\(contextKey: String\)[\s\S]*?this\.contextKey == contextKey/);
  assert.match(homeViewModel, /refresh\(developerViewAsStore\.current\(\) \?: mode\.identity\(\)\.uid\)/);
  assert.match(homeViewModel, /profileContextKey == contextKey && profileGeneration == generation/);
  assert.match(homeViewModel, /if \(profileContextKey == contextKey\)[\s\S]*?Feedback\(notice = "Foto atualizada\."\)/);
  assert.match(homeViewModel, /todayContextKey != contextKey[\s\S]*?todayMutable\.value = HomeToday\(contextKey = contextKey\)/);
  assert.match(homeViewModel, /todayContextKey == contextKey && todayGeneration == generation/);
  assert.doesNotMatch(homeViewModel, /queue\.list\(uid\)[^\n]*feedbackMutable/);
  assert.match(homeViewModel, /scheduleAvailable = month != null/);
  assert.match(sessionViewModel, /DeveloperViewAsState\(targetUserId = developerViewAsStore\.current\(\)\)/);
  assert.match(sessionViewModel, /if \(developerIdentity\) loadDeveloperViewAs\(\)/);
  assert.match(sessionViewModel, /directory\.targetUserId\?\.let\(developerViewAsStore::select\) \?: developerViewAsStore\.clear\(\)/);
  assert.match(theme, /fun timeBasedDarkTheme\(hour: Int\) = hour !in 6\.\.17/);
  assert.doesNotMatch(theme, /isSystemInDarkTheme/);
});

const time = readFileSync(`${native}ui/TimeScreens.kt`, 'utf8');
const timeViewModel = readFileSync(`${native}ui/TimeViewModel.kt`, 'utf8');
const timeModels = readFileSync(`${native}data/TimeModels.kt`, 'utf8');
const timeOfflineStore = readFileSync(`${native}offline/TimeOfflineStore.kt`, 'utf8');
const timeOfflineWorker = readFileSync(`${native}offline/TimeOfflineWorker.kt`, 'utf8');
const timeDeviceIdentity = readFileSync(`${native}offline/TimeDeviceIdentity.kt`, 'utf8');
const journeyLocationService = readFileSync(`${native}location/JourneyLocationService.kt`, 'utf8');
const journeyLocationQueue = readFileSync(`${native}location/JourneyLocationQueue.kt`, 'utf8');
const profileRoute = readFileSync('src/app/api/mobile/profile/route.ts', 'utf8');
const filePaths = readFileSync('apps/coala-one-android/app/src/main/res/xml/file_paths.xml', 'utf8');

test('Ponto do Coala Go reaproveita as rotas web, bate como coletor móvel e não oferece "Todas as unidades"', () => {
  assert.match(timeModels, /data class MarkingRequest\([\s\S]*?val channel: String = "mobile"[\s\S]*?val offline: OfflineMarkingEvidence\? = null,[\s\S]*?val locationAttempt: LocationAttempt\? = null,[\s\S]*?val onlineScope: String\? = null\)/);
  // The same attempt and work date are resent until the server answers, kept in saved state; 409 starts over.
  assert.match(timeViewModel, /saved\["attemptId"\] = value\?\.first; saved\["attemptDate"\] = value\?\.second/);
  assert.match(timeViewModel, /val onlineRequest = MarkingRequest\(pending\.first, pending\.second,/);
  assert.match(timeViewModel, /offlineQueue\.beginOnline\(owner, onlineRequest[\s\S]*?api\.mark\(onlineRequest, owner\)/);
  assert.match(timeViewModel, /cause\.code\(\) == 409\) \{ clearAttempt\(\)/);
  assert.match(timeViewModel, /TimeRules\.workDate\(officialNow\(state\), zone\)/);
  // A unidade da batida vem da escala do dia: o Ponto não tem seletor (decisão de 29/10/2026).
  assert.doesNotMatch(time, /UnitPickerHeader/);
  assert.doesNotMatch(time, /Rules\.unitChoices/);
  assert.match(time, /capturePointLocation/);
  assert.doesNotMatch(time, /leitura pontual de localização|Aviso de privacidade|O ponto será registrado mesmo se a posição/);
  assert.doesNotMatch(time, /ACCESS_BACKGROUND_LOCATION/);
  // A finalidade é declarada na batida, a sugestão continua editável e também pode ser corrigida no detalhe.
  assert.match(timeModels, /val declaredPurpose: String\? = null/);
  assert.match(time, /mutableStateOf\(if \(suggestionReliable\) suggestedPurpose else null\)/);
  assert.match(time, /O que este registro representa\?/);
  assert.match(time, /Alterar classificação/);
  assert.match(timeViewModel, /api\.classifyMarking/);
  assert.match(time, /SummaryLine\("Quem pede"/);
  assert.match(time, /A batida original nunca é apagada/);
  // Receipts live in the app cache and leave only through the system viewer, share sheet or save dialog.
  assert.match(timeViewModel, /File\(directory, "receipts"\)/);
  assert.match(time, /ActivityResultContracts\.CreateDocument\("application\/pdf"\)/);
  // Banco e espelhos mensais são sob demanda; a pasta de documentos não existe no Go.
  assert.match(time, /"bank" ->[\s\S]*?vm\.loadBank\(\)/);
  assert.match(time, /"mirror" ->[\s\S]*?vm\.loadMirrorYear\(state\.month\.year\)/);
  assert.doesNotMatch(timeViewModel.split('fun load()')[1]?.split('fun loadDay(')[0] ?? '', /timeBank|ownDocuments|mirror\(/);
  assert.match(time, /Triple\("bank", "Banco de horas"/);
  assert.match(time, /Triple\("mirror", "Espelhos mensais"/);
  assert.match(time, /fun MirrorYearTab/);
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
  // A ação permanece familiar; a confirmação distingue gravação local de confirmação oficial.
  assert.match(time, /"Registrar ponto"/);
  assert.match(time, /salvo no aparelho/);
  assert.doesNotMatch(time, /Registrar ponto offline/);
  // "HORA LEGAL BRASILEIRA" só é o rótulo quando a fonte não é a autorização local.
  for (const source of [time, activity]) {
    assert.match(source, /Text\(if \(local\) "HORÁRIO DO REGISTRO" else "HORA LEGAL BRASILEIRA"/);
    assert.equal(source.match(/"HORA LEGAL BRASILEIRA"/g)?.length, 1);
  }
  assert.match(time, /Esta hora é apenas informativa: o comprovante terá a hora gravada pelo servidor\./);
  // O reenvio mantém a finalidade da tentativa original.
  assert.match(time, /Definida na tentativa original; não pode ser trocada no reenvio\./);
  assert.match(timeViewModel, /PendingAttempt\(attemptPurpose, attemptUnitId, attemptFirstTriedAt, attemptFirstTriedSource\)/);
  assert.match(time, /Ainda não há NSR nem comprovante oficial/);
  assert.match(timeViewModel, /offlineQueue\.capture/);
  assert.match(timeViewModel, /lastOffline/);
  assert.match(timeOfflineStore, /MAX_PENDING_MARKINGS = 20/);
  assert.match(timeOfflineStore, /TimeOfflineRules\.permitIssue/);
  assert.match(timeOfflineStore, /protocolVersion = 2/);
  assert.match(timeOfflineStore, /TimeOfflineRules\.markedAt/);
  assert.match(timeOfflineStore, /declaredPurpose = declaredPurpose/);
  assert.match(timeOfflineStore, /identity\.sign/);
  assert.match(timeDeviceIdentity, /AndroidKeyStore/);
  assert.match(timeDeviceIdentity, /ECGenParameterSpec\("secp256r1"\)/);
  assert.match(timeOfflineWorker, /ExistingWorkPolicy\.APPEND_OR_REPLACE/);
  assert.doesNotMatch(timeOfflineStore, /nsr/);
  // Server receipt identifiers may be cached for signed close; local capture never invents an NSR.
});

test('ensaio nominal e sua contingência segregada nunca se apresentam como registro oficial', () => {
  assert.match(timeModels, /data class TimeOptions\([\s\S]*?val mode: String = "official"/);
  assert.match(timeModels, /data class MarkingResponse\([\s\S]*?val pilot: Boolean = false/);
  assert.match(timeModels, /data class OwnMarking\([\s\S]*?val pilot: Boolean = false/);
  assert.match(time, /Sequência do ensaio/);
  assert.match(time, /Teste sem validade como REP-P e fora do fechamento oficial/);
  assert.match(time, /Aguardando sincronização do ensaio/);
  assert.match(time, /nada será enviado ao registro fiscal oficial/);
  assert.match(time, /Os comprovantes do ensaio ficam fora do pacote oficial/);
  assert.match(time, /Exportar comprovantes oficiais do mês/);
  assert.match(timeViewModel, /TimeRules\.canPreserve/);
  assert.match(timeViewModel, /val officialMarkings = state\.markings\.filterNot \{ it\.pilot \}/);
  assert.match(timeViewModel, /Não há comprovantes oficiais neste mês/);
  assert.match(timeOfflineStore, /current\.scope == scope/);
  assert.match(timeOfflineStore, /permit\.scope/);
});

test('Detalhe do dia é único e o acompanhamento entre unidades respeita início, intervalo e fim', () => {
  assert.match(time, /"day" -> "Detalhe do dia"/);
  assert.match(time, /RecordsTab[\s\S]*?onDay = \{ openDay\(it, "records"\) \}/);
  assert.match(time, /AdjustmentHistoryTab[\s\S]*?openDay\(it, "adjustments"\)/);
  assert.match(time, /BankTab[\s\S]*?openDay\(it, "bank"\)/);
  assert.match(time, /Text\("Memória de cálculo"/);
  assert.match(time, /Text\("Ajustes e ocorrências"/);
  assert.match(time, /Permitir localização/);
  assert.match(journeyLocationService, /300_000L, 100f/);
  assert.match(journeyLocationService, /ACTION_PAUSE/);
  assert.match(journeyLocationService, /ACTION_STOP/);
  assert.match(journeyLocationService, /ACTION_ABORT/);
  assert.match(journeyLocationService, /abortTracking\(\)/);
  assert.match(journeyLocationQueue, /vault\.seal/);
  assert.match(journeyLocationQueue, /response\.stopRequested/);
  assert.match(journeyLocationQueue, /controller\.stopFromServer\(\)/);
  assert.match(journeyLocationQueue, /NetworkType\.CONNECTED/);
  assert.match(journeyLocationQueue, /setInitialDelay\(15, TimeUnit\.MINUTES\)/);
  assert.doesNotMatch(time, /POST_NOTIFICATIONS/);
});

test('permissão pontual é preparada uma vez, mas turno sem configuração permanece sem coleta', () => {
  assert.match(timeModels, /locationTrackingPolicy: String = "disabled"/);
  assert.match(time, /getSharedPreferences\("point-location-permission"/);
  assert.match(time, /putBoolean\("requested", true\)/);
  assert.match(time, /section == "today" && !locationPermissionPrepared/);
  assert.match(time, /locationPolicy\.mode == "disabled"[\s\S]*?vm\.record/);
  assert.doesNotMatch(time, /ACCESS_BACKGROUND_LOCATION/);
});

test('Troca de turno permanece em Solicitações e consome o contrato central', () => {
  assert.match(time, /TimeSectionCard\("Trocas de turno"/);
  assert.match(time, /Text\("Resumo da proposta"/);
  assert.match(time, /ShiftOptionCard/);
  assert.match(time, /vm\.requestShiftSwap/);
  assert.match(time, /vm\.decideShiftSwap\(request, "accept"\)/);
  assert.match(timeViewModel, /api\.requestShiftSwap\(ShiftSwapCreate/);
  assert.match(timeViewModel, /api\.decideShiftSwap\(request\.id, ShiftSwapDecision/);
  assert.match(timeModels, /data class ShiftSwapViewerActions/);
});

test('Jornada fica direta no início e separa consultas, escala e benefícios', () => {
  assert.match(activity, /HomeTimeSummary\(visibleToday, \{ navigate\("time\/register"\) \}\)/);
  assert.match(activity, /navigate\("time\/day\/\$date"\)/);
  assert.match(home, /JORNADA DE TRABALHO/);
  assert.match(home, /Triple\(modules\.timeRecording, "Ponto", "time"\), Triple\(modules\.schedule, "Escala", "schedule"\)/);
  assert.match(time, /Triple\("records", "Registros"/);
  assert.match(time, /Triple\("adjustments", "Histórico de ajustes"/);
  assert.match(time, /Text\("BENEFÍCIOS"/);
  assert.match(time, /TimeSectionCard\("Vale-transporte"/);
  assert.match(time, /Ajustes de ponto ficam em Ponto/);
  assert.match(schedule, /Solicitações deste dia/);
  assert.match(schedule, /Vale-transporte permanece em Solicitações/);
});

test('Ponto e Solicitações aparecem só com a liberação do grupo app e a permissão de colaborador', () => {
  assert.match(profileRoute, /timeRecording: collaborator && app\?\.timeRecording\?\.mark === true/);
  assert.match(profileRoute, /requests: collaborator && app\?\.requests\?\.create === true/);
  assert.match(home, /Triple\(modules\.timeRecording, "Ponto", "time"\), Triple\(modules\.schedule, "Escala", "schedule"\)/);
  assert.match(home, /Triple\(modules\.requests, "Solicitações", "requests"\)/);
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
