package com.coalaone.go.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.coalaone.go.data.*
import com.coalaone.go.domain.BreakLevel
import com.coalaone.go.domain.BreakStatus
import com.coalaone.go.domain.ClockSource
import com.coalaone.go.domain.DayPunch
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.offline.CapturedOfflineMarking
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val ptBR = java.util.Locale.forLanguageTag("pt-BR")
private fun dayTitle(date: LocalDate) = date.format(DateTimeFormatter.ofPattern("EEE, d 'de' MMM", ptBR)).replaceFirstChar { it.titlecase(ptBR) }
private fun deviceLocationEnabled(context: Context): Boolean {
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as? android.location.LocationManager ?: return false
    return runCatching { manager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
        || manager.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)
}

/** Multi-line note with the counter the server limit implies. */
@Composable private fun NoteInput(label: String, value: String, max: Int, placeholder: String, enabled: Boolean = true, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold))
        OutlinedTextField(value, onValueChange = { if (it.length <= max) onChange(it) }, enabled = enabled, minLines = 3, shape = RoundedCornerShape(12.dp), placeholder = { Text(placeholder, color = Tokens.faint) },
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Tokens.soft, focusedContainerColor = Tokens.soft, disabledContainerColor = Tokens.soft, unfocusedBorderColor = Tokens.fieldBorder, focusedBorderColor = Tokens.accent),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label })
        Text("${value.trim().length}/$max", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp), modifier = Modifier.align(Alignment.End))
    }
}
/** Label and value pair of the summaries, read top to bottom before sending. */
@Composable private fun SummaryLine(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

/** Opens, shares or saves a receipt the view model downloaded into the app cache. */
private fun pdfUri(context: Context, file: File) = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
private fun openPdf(context: Context, file: File): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(pdfUri(context, file), "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); true
} catch (_: ActivityNotFoundException) { false }
private fun sharePdf(context: Context, file: File) {
    val send = Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM, pdfUri(context, file)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, "Compartilhar comprovante"))
}
private fun openFile(context: Context, file: File, mimeType: String): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(pdfUri(context, file), mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); true
} catch (_: ActivityNotFoundException) { false } catch (_: IllegalArgumentException) { false }
private fun shareFile(context: Context, file: File, mimeType: String, title: String): Boolean = try {
    val send = Intent(Intent.ACTION_SEND).setType(mimeType).putExtra(Intent.EXTRA_STREAM, pdfUri(context, file)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, title)); true
} catch (_: ActivityNotFoundException) { false } catch (_: IllegalArgumentException) { false }

/** Native open/share/save contract for the point mirror. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun FileSheet(title: String, subtitle: String, fileName: String, mimeType: String,
    load: (String, (File) -> Unit) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var problem by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<File?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mimeType)) { uri ->
        val file = pending ?: return@rememberLauncherForActivityResult
        if (uri != null) runCatching { context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } }
            .onFailure { problem = "Não foi possível salvar o arquivo." }
    }
    // Personal files never outlive the sheet. Logout and leaving Ponto repeat the cleanup defensively.
    DisposableEffect(Unit) { onDispose { File(context.cacheDir, "time-documents").deleteRecursively() } }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tokens.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(subtitle, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            Action("Abrir documento") { load("view") { if (!openFile(context, it, mimeType)) problem = "Nenhum aplicativo compatível neste aparelho. Use Compartilhar ou Salvar." } }
            Action("Compartilhar", secondary = true) { load("download") { if (!shareFile(context, it, mimeType, "Compartilhar documento")) problem = "Não foi possível abrir o compartilhamento neste aparelho." } }
            Action("Salvar no aparelho", secondary = true) { load("download") { pending = it; save.launch(fileName) } }
            problem?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ReceiptSheet(punch: DayPunch, markedAt: String, vm: TimeViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var problem by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<File?>(null) }
    var purpose by rememberSaveable(punch.receiptId) { mutableStateOf(punch.purpose ?: "journey_start") }
    var editingPurpose by rememberSaveable(punch.receiptId) { mutableStateOf(false) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val file = pending ?: return@rememberLauncherForActivityResult
        if (uri != null) runCatching { context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } }.onFailure { problem = "Não foi possível salvar o arquivo." }
    }
    fun fetch(then: (File) -> Unit) { val id = punch.receiptId ?: return; vm.receipt(id, markedAt, punch.nsr ?: 0, punch.pilot, context.cacheDir, then) }
    // The copy lives only while the sheet is open; sign-out also clears the folder.
    DisposableEffect(Unit) { onDispose { File(context.cacheDir, "receipts").deleteRecursively() } }
    // One touch from the list reaches the receipt: the PDF opens as soon as the sheet does.
    var autoOpened by rememberSaveable(punch.receiptId) { mutableStateOf(false) }
    LaunchedEffect(punch.receiptId) {
        if (autoOpened || punch.receiptStatus != "available") return@LaunchedEffect
        autoOpened = true
        fetch { file -> if (!openPdf(context, file)) problem = "Nenhum leitor de PDF neste aparelho. Use Compartilhar ou Salvar." }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tokens.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Batida · ${punch.time}", style = MaterialTheme.typography.titleLarge)
            Text(if (punch.pilot) "Sequência do ensaio ${punch.nsr ?: "—"} · comprovante sem validade como REP-P."
                else "Registro oficial ${punch.nsr ?: "—"} · PDF assinado pelo sistema de ponto.",
                color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            CardBlock(selected = editingPurpose) {
                Text("Classificação", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                Text(TimeRules.purposeLabel(purpose), style = MaterialTheme.typography.titleMedium)
                Text(if (punch.classificationSource == "declared") "Confirmada por você" else "Sugerida pelo sistema", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
                if (editingPurpose) {
                    TimeRules.PUNCH_PURPOSES.forEach { (id, label) ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.RadioButton) { purpose = id }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(purpose == id, null); Text(label)
                        }
                    }
                    FooterPair("Cancelar", true, { editingPurpose = false }, "Salvar classificação", true) {
                        punch.receiptId?.let { vm.classify(it, purpose) }; editingPurpose = false
                    }
                } else Action("Alterar classificação", secondary = true) { editingPurpose = true }
            }
            if (punch.receiptStatus != "available") Text("Comprovante ainda indisponível. Ele é emitido assim que o serviço de assinatura responder; a batida já está gravada.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
            else {
                Action("Abrir comprovante") { fetch { file -> if (!openPdf(context, file)) problem = "Nenhum leitor de PDF neste aparelho. Use Compartilhar ou Salvar." } }
                Action("Compartilhar", secondary = true) { fetch { sharePdf(context, it) } }
                Action("Salvar no aparelho", secondary = true) { fetch { file -> pending = file; save.launch(file.name) } }
            }
            problem?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

/** Numbered sequence of a day: the order suggests the kind; struck lines were discarded by the DP, tagged ones included. */
@Composable private fun PunchList(punches: List<DayPunch>, enabled: Boolean, units: List<ExecutionUnit> = emptyList(),
    onReceipt: (DayPunch) -> Unit, showLocation: Boolean = false) {
    var position = 0
    punches.forEachIndexed { punchIndex, punch ->
        val index = if (punch.discarded) null else position++
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).then(if (punch.receiptId != null) Modifier.clickable(enabled = enabled, role = Role.Button, onClickLabel = "Ver comprovante") { onReceipt(punch) } else Modifier).padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(34.dp).background(if (punch.discarded) Tokens.soft else Tokens.accentSoft, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                Text(index?.let { "${it + 1}ª" } ?: "—", color = if (punch.discarded) Tokens.faint else Tokens.accent, style = MaterialTheme.typography.labelLarge.copy(fontSize = 12.sp))
            }
            Column(Modifier.weight(1f)) {
                Text(punch.time, style = MaterialTheme.typography.titleMedium.copy(textDecoration = if (punch.discarded) TextDecoration.LineThrough else null), color = if (punch.discarded) Tokens.faint else Tokens.ink)
                val unitName = units.firstOrNull { it.id == punch.unitId }?.name
                Text(listOfNotNull(when { punch.discarded -> "Desconsiderada pelo DP"; punch.included -> "Incluída por ajuste aprovado pelo DP"; else -> TimeRules.purposeLabel(punch.purpose) }, unitName).joinToString(" · "), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                if (showLocation) punch.location?.let { location -> Text(location.physicalUnitName ?: when (location.evaluation) {
                    "inside" -> "Na unidade"
                    "outside" -> "Fora da área" + (location.distanceMeters?.let { " · ~${it.toInt()} m" } ?: "")
                    else -> "Localização não confirmada"
                }, color = if (location.evaluation == "inside") Tokens.info else Tokens.muted, style = MaterialTheme.typography.bodySmall) }
            }
            when {
                punch.receiptId == null -> Unit
                punch.receiptStatus == "available" -> StatusChip("Comprovante", Tokens.info, Tokens.infoBg)
                else -> StatusChip("Pendente", Tokens.warning, Tokens.warningBg)
            }
        }
        if (!punch.discarded && punch.purpose == "break_start") {
            val end = punches.drop(punchIndex + 1).firstOrNull { !it.discarded }
            if (end?.purpose == "break_end") TimeRules.intervalSeconds(punch, end)?.let { seconds ->
                CompletedBreakPill(seconds, Modifier.padding(start = 46.dp, top = 2.dp, bottom = 2.dp))
            }
        }
    }
}

@Composable internal fun TimeDayOverview(state: TimeState, shift: OwnShift?, punches: List<DayPunch>, enabled: Boolean,
    onReceipt: (DayPunch) -> Unit) {
    CardBlock {
        Text(dayTitle(state.today), style = MaterialTheme.typography.titleMedium)
        Text(if (state.monthDataAvailable) TimeRules.shiftText(shift) ?: "Sem turno na escala de hoje"
            else "Escala ainda não consultada.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        if (state.monthDataAvailable) TimeRules.breakText(shift)?.let {
            Text(it, color = Tokens.info, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold))
        }
        HorizontalDivider(color = Tokens.border)
        if (!state.monthDataAvailable) Text("Batidas não consultadas. Os registros já feitos continuam no servidor.", color = Tokens.muted)
        else if (punches.isEmpty()) Text("Nenhuma batida hoje.", color = Tokens.muted)
        if (state.monthDataAvailable) PunchList(punches, enabled, state.options?.executionUnits.orEmpty(), onReceipt)
    }
}

/** Digital clock with seconds (Portaria 671, Anexo IX), from the official reading plus the phone's elapsed time. */
@Composable private fun OfficialClockCard(state: TimeState, online: Boolean) {
    val zone = TimeRules.unitZone(state.options, state.unitId)
    // Monotonic clock plus the official offset: changing the phone's hour does not move the time shown.
    var official by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)) }
    LaunchedEffect(state.clockOffset) { while (true) { official = android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0); delay(1000 - official % 1000) } }
    // The permit anchor is shown under its own name; only a confirmed reading is "Hora Legal Brasileira".
    val visibleSource = when {
        online -> state.clockSource
        state.offlineReady && state.clockOffset != null -> ClockSource.LOCAL_PERMIT
        else -> ClockSource.NONE
    }
    val local = visibleSource == ClockSource.LOCAL_PERMIT
    val showTime = visibleSource != ClockSource.NONE && state.clockOffset != null
    Column(Modifier.fillMaxWidth().background(Tokens.dark, RoundedCornerShape(20.dp)).padding(horizontal = 18.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (local) "HORÁRIO DO REGISTRO" else "HORA LEGAL BRASILEIRA", color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.weight(1f))
            if (state.options?.mode == "pilot") Text("ENSAIO · SEM VALIDADE REP-P", color = Tokens.accentSoft, style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, letterSpacing = .5.sp))
            if (showTime) Text(TimeRules.utcOffsetLabel(zone, official), color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
        }
        if (showTime) {
            Text(TimeRules.clockText(official, zone), color = Tokens.onDark, style = MaterialTheme.typography.displaySmall.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
            val unitName = state.options?.executionUnits?.firstOrNull { it.id == state.unitId }?.name
            unitName?.let { Text(it, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall) }
        } else Text(if (state.options == null) "Carregando…" else "Indisponível", color = Tokens.onDark2, style = MaterialTheme.typography.titleLarge)
    }
}

private fun breakColors(level: BreakLevel) = when (level) {
    BreakLevel.DANGER -> Tokens.danger to Tokens.dangerBg
    BreakLevel.WARN -> Tokens.warning to Tokens.warningBg
    BreakLevel.INFO -> Tokens.info to Tokens.infoBg
    BreakLevel.OK -> Tokens.okInk to Tokens.okBg
    BreakLevel.NEUTRAL -> Tokens.muted to Tokens.soft
}

@Composable private fun BreakNoticeCard(status: BreakStatus) {
    val (ink, background) = breakColors(status.level)
    Column(Modifier.fillMaxWidth().background(background, RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("INTERVALO", color = ink, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.1.sp, fontWeight = FontWeight.Bold))
        Text(status.headline, color = ink, style = MaterialTheme.typography.titleMedium)
        status.detail?.let { Text(it, color = ink, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable fun TimeScreen(vm: TimeViewModel, onBack: () -> Unit, startConfirming: Boolean = false, startDayDetail: String? = null,
    onInformAbsence: (String) -> Unit = {}) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val context = LocalContext.current
    val online = rememberOnline()
    DisposableEffect(Unit) {
        onDispose {
            listOf("receipts", "time-documents").forEach { File(context.cacheDir, it).deleteRecursively() }
            // The confirmation cards have no button to dismiss them: they go away when the screen is left.
            vm.dismissLast(); vm.dismissOffline()
        }
    }
    LaunchedEffect(startDayDetail) { if (startDayDetail == null) vm.load(online) else vm.loadDay(startDayDetail) }
    LaunchedEffect(online) { if (online && startDayDetail == null) vm.load() else vm.refreshClock(online) }
    // Back from the background the official reading is taken again (one read), never on a timer.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        var paused = false
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_STOP) paused = true
            if (event == androidx.lifecycle.Lifecycle.Event.ON_START && paused) { paused = false; vm.refreshClock() }
        }
        lifecycle.addObserver(observer); onDispose { lifecycle.removeObserver(observer) }
    }
    var section by rememberSaveable { mutableStateOf(if (startDayDetail == null) "today" else "day") }
    var confirming by rememberSaveable { mutableStateOf(false) }
    var pendingDirectRecord by rememberSaveable { mutableStateOf(startConfirming) }
    val submitter = rememberPunchSubmitter(vm)
    var asking by rememberSaveable { mutableStateOf<String?>(null) }
    var receipt by remember { mutableStateOf<Pair<DayPunch, String>?>(null) }
    var selectedMirror by remember { mutableStateOf(false) }
    var selectedReceiptArchive by remember { mutableStateOf(false) }
    var detailDate by rememberSaveable { mutableStateOf(startDayDetail) }
    var detailSource by rememberSaveable { mutableStateOf(if (startDayDetail == null) "records" else "home") }
    asking?.let { date -> AdjustmentScreen(vm, date) { asking = null; vm.clearAdjustment() }; return }
    val units = state.options?.executionUnits.orEmpty()
    val pilotMode = state.options?.mode == "pilot"
    val today = state.today.toString()
    val todayShift = state.shifts.firstOrNull { it.date == today }
    val todayMarkings = state.markings.filter { it.workDate == today }
    val (suggestedPurpose, suggestionReliable) = daySuggestion(state)
    val todayPunches = TimeRules.day(today, state.markings, state.treatments)
    val selectedUnit = units.firstOrNull { it.id == state.unitId }
    val unitName = selectedUnit?.name.orEmpty()
    val locationPolicy = selectedUnit?.locationPolicy ?: LocationPolicy()
    val screenBusy = feedback.busy || submitter.capturing.value
    val pendingAttempt = vm.hasPendingAttempt()
    val canPreserve = !pendingAttempt && TimeRules.canPreserve(state.options, state.unitId, state.offlineReady)
    val canPreserveOffline = !pendingAttempt && TimeRules.canPreserveOffline(state.options, state.unitId, state.offlineReady)
    val preserving = if (online) canPreserve else canPreserveOffline
    val zone = TimeRules.unitZone(state.options, state.unitId)
    var officialNow by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)) }
    LaunchedEffect(state.clockOffset) {
        while (true) {
            officialNow = android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)
            delay(1000 - officialNow % 1000)
        }
    }
    val cycleClosed = state.closedJourneyDate == today || TimeRules.autoJourneyCycleClosed(today, todayShift, todayMarkings, officialNow, zone)
    val breakStatus = if (cycleClosed || !state.monthDataAvailable) null else TimeRules.breakStatus(todayShift, todayMarkings, officialNow, zone)
    // The direct shortcut waits for today's punches and shift: never a sheet over an unread day.
    LaunchedEffect(pendingDirectRecord, state.options, state.unitId, state.dayLoad) {
        if (pendingDirectRecord && state.dayLoad != DayLoad.PENDING && (TimeRules.canRecord(state.options, state.unitId) || canPreserve)) {
            confirming = true
            pendingDirectRecord = false
        }
    }
    val journeyLocationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    fun markedAtOf(punch: DayPunch) = state.markings.firstOrNull { it.receiptId == punch.receiptId }?.markedAt ?: today
    receipt?.let { (punch, markedAt) -> ReceiptSheet(punch, markedAt, vm) { receipt = null } }
    if (selectedMirror) FileSheet("Espelho de ponto", "Competência ${state.month} · versão ${state.mirror?.closure?.version ?: "—"}",
        "espelho-ponto-${state.month}.pdf", "application/pdf", { _, then -> vm.mirrorPdf(context.cacheDir, then) }) { selectedMirror = false }
    if (selectedReceiptArchive) {
        val (start, end) = TimeRules.monthRange(state.month)
        val officialMarkings = state.markings.filterNot { it.pilot }
        val complete = !state.truncated && officialMarkings.isNotEmpty() && officialMarkings.all { it.receiptStatus == "available" }
        val unavailable = officialMarkings.count { it.receiptStatus != "available" }
        FileSheet("Comprovantes oficiais do mês",
            if (complete) "${officialMarkings.size} comprovante(s) oficial(is) · pacote oficial completo; ensaios ficam fora deste arquivo"
            else "$unavailable comprovante(s) oficial(is) ainda indisponível(is) · ensaios ficam fora deste arquivo",
            "comprovantes-ponto-$start-a-$end-${if (complete) "completo" else "incompleto"}.zip", "application/zip",
            { _, then -> vm.receiptArchive(context.cacheDir, then) }) { selectedReceiptArchive = false }
    }
    LaunchedEffect(section, state.month, detailDate) {
        when (section) {
            // Back on today from another month of the records: today's punches are read again.
            "today" -> if (state.month != java.time.YearMonth.from(state.today) && state.options != null) vm.month(java.time.YearMonth.from(state.today))
            "bank" -> if (state.bankDate != (if (state.month == java.time.YearMonth.from(state.today)) state.today else state.month.atEndOfMonth()).toString()) vm.loadBank()
            "day" -> detailDate?.let { if (detailSource != "home" && state.bankDate != it) vm.loadBank(it) }
            "mirror" -> if (state.mirrorYear != state.month.year) vm.loadMirrorYear(state.month.year)
        }
    }
    // One main action: the punch, confirmed in the footer itself; the history has no footer.
    val footer: (@Composable ColumnScope.() -> Unit)? = if (section != "today") null else { {
        if (confirming) {
            PunchConfirmation(vm, state, online, screenBusy, submitter, onCancel = { confirming = false }, onSubmitted = { confirming = false })
        } else {
            if (state.monthDataAvailable && !pendingAttempt && (TimeRules.canRecord(state.options, state.unitId) || canPreserve))
                Text("Próxima: " + TimeRules.nextPunchText(todayPunches.count { !it.discarded }, todayShift, if (suggestionReliable) suggestedPurpose else null) +
                    if (suggestionReliable) " · sugerida" else "", color = Tokens.muted, style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            // One familiar action; confirmation and result explain local saving when needed.
            Action(when {
                pendingAttempt && online -> "Reenviar a mesma batida"
                pendingAttempt -> "Conecte para reenviar a batida"
                cycleClosed -> "Registrar nova batida"
                else -> "Registrar ponto"
            }, screenBusy,
                enabled = if (online) pendingAttempt || TimeRules.canRecord(state.options, state.unitId) || canPreserve
                    else !pendingAttempt && canPreserveOffline) { confirming = true }
        }
    } }
    val screenTitle = when (section) { "records" -> "Registros"; "adjustments" -> "Histórico de ajustes"; "bank" -> "Banco de horas"; "mirror" -> "Espelhos mensais"; "day" -> "Detalhe do dia"; else -> "Registro de ponto" }
    val leave: () -> Unit = { when (section) { "today" -> onBack(); "day" -> if (detailSource == "home") onBack() else section = detailSource
        else -> { section = "today"; java.time.YearMonth.from(state.today).let { if (state.month != it) vm.month(it) } } } }
    fun openDay(date: String, source: String) { detailDate = date; detailSource = source; section = "day"; confirming = false }
    Page(screenTitle, feedback, leave, footer = footer, onRefresh = {
        when (section) { "today" -> vm.load(online); "records", "adjustments" -> vm.month(state.month); "bank" -> vm.loadBank();
            "day" -> detailDate?.let { if (detailSource == "home") vm.loadDay(it) else vm.loadBank(it) }; "mirror" -> vm.loadMirrorYear(state.month.year) }
    }, showConnectivityNotice = false, header = {
        TopBar(screenTitle, busy = screenBusy, onBack = leave)
        // A escala escolhe a unidade; há escolha manual sem unidade escalada, com unidade livre ou com escala fora do vínculo.
        if (section == "today" && TimeRules.unitPickable(state.options, todayShift)) UnitPickerHeader(units.map { it.id to it.name }, state.unitId.orEmpty(), screenBusy || confirming) { vm.unit(it) }
    }) {
        if (section == "today") {
            OfficialClockCard(state, online)
            ScheduledUnitNotice(state.options, todayShift, state.unitId)
            if (todayShift?.executionUnitPolicy == "free" && todayShift.locationTrackingPolicy == "workday") {
                CardBlock {
                    Text("Entre unidades", style = MaterialTheme.typography.titleMedium)
                    when {
                        state.options?.journeyLocationEnabled != true -> Text("Acompanhamento durante a jornada preparado, mas ainda não liberado. A ativação depende da decisão formal de privacidade e do piloto.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                        locationPolicy.mode != "observe" -> Text("Acompanhamento durante a jornada configurado no turno, aguardando a política central desta unidade.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                        !hasPointLocationPermission(context) -> {
                            Text("Se você permitir, a localização será registrada periodicamente durante a jornada entre unidades, pausada no intervalo e encerrada no fim. Isso não bloqueia o ponto.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                            Action("Permitir localização", secondary = true) {
                                journeyLocationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                            }
                        }
                        !deviceLocationEnabled(context) -> {
                            Text("A localização do aparelho está desligada. O ponto continua disponível.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                            Action("Abrir localização do aparelho", secondary = true) { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
                        }
                        else -> Text("Pronto para acompanhar a jornada. Começa no Início da jornada, pausa no intervalo e termina no Fim da jornada.", color = Tokens.okInk, style = MaterialTheme.typography.bodySmall)
                    }
                    if (state.journeyTrackingActive) Action("Encerrar acompanhamento", secondary = true) { vm.stopJourneyLocation() }
                    Text("O indicador técnico do Android aparece apenas enquanto o acompanhamento estiver ativo. Avisos gerais continuam opcionais no Perfil.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (state.journeyTrackingActive && !(todayShift?.executionUnitPolicy == "free" && todayShift.locationTrackingPolicy == "workday")) {
                CardBlock(selected = true) {
                    Text("Acompanhamento ativo neste aparelho", style = MaterialTheme.typography.titleMedium)
                    Text("A configuração da jornada mudou. Você pode encerrar imediatamente; uma atualização on-line também fará a reconciliação.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                    Action("Encerrar acompanhamento", secondary = true) { vm.stopJourneyLocation() }
                }
            }
            breakStatus?.takeIf { it.inPause }?.let { BreakTimerPill(it) }
            // One block for the reason and the contingency issue, instead of two stacked warnings.
            val blocked = if (!online && !state.offlineReady) "Conecte-se à internet para registrar o ponto."
                else TimeRules.blockedReason(state.options, state.offlineReady)
            if (blocked != null) {
                Column(Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    blocked?.let { Text(it, color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold)) }
                    if (online) TextButton({ vm.retryOfflineAuthorization() }, enabled = !feedback.busy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Tentar novamente", color = Tokens.wine) }
                }
            }
            if (state.offlineRows.isNotEmpty()) {
                val blocked = state.offlineRows.count { it.state == "BLOCKED" }
                Text(if (blocked == 0) "${state.offlineRows.size} ${if (state.offlineRows.size == 1) "marcação preservada aguarda" else "marcações preservadas aguardam"} sincronização."
                    else "$blocked ${if (blocked == 1) "marcação precisa" else "marcações precisam"} de conferência do DP; nada foi apagado.",
                    color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
            }
            state.lastOffline?.let { local -> PunchPreservedCard(local, pilotMode) { vm.dismissOffline() } }
            state.last?.let { last -> PunchRecordedCard(last, units.firstOrNull { it.id == last.marking.executionUnitId }?.name ?: unitName,
                { receipt = it }) { vm.dismissLast() } }
            CardBlock {
                Text(dayTitle(state.today), style = MaterialTheme.typography.titleMedium)
                Text(TimeRules.shiftText(todayShift) ?: "Sem turno na escala de hoje", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                TimeRules.breakText(todayShift)?.let { Text(it, color = Tokens.info, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold)) }
                HorizontalDivider(color = Tokens.border)
                if (todayPunches.isEmpty()) Text("Nenhuma batida hoje.", color = Tokens.muted)
                PunchList(todayPunches, !feedback.busy, units, onReceipt = { receipt = it to markedAtOf(it) })
            }
            if (todayMarkings.any { it.pilot }) Text("Ajustes formais ficam indisponíveis no ensaio; a classificação de cada batida continua editável.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            else Action("Pedir ajuste de ponto", secondary = true, enabled = !feedback.busy) { asking = today }
            Text("CONSULTAS", color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.padding(top = 4.dp))
            listOf(
                Triple("records", "Registros", "Batidas e detalhes de cada dia"),
                Triple("adjustments", "Histórico de ajustes", "Pedidos, decisões e antes × depois"),
                Triple("bank", "Banco de horas", "Saldo e lançamentos detalhados"),
                Triple("mirror", "Espelhos mensais", "Documentos das competências fechadas"),
            ).chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { (id, title, subtitle) -> TimeSectionCard(title, subtitle, Modifier.weight(1f).fillMaxHeight()) { section = id; confirming = false } }
                }
            }
        } else if (section == "records") RecordsTab(state, feedback.busy, vm,
            onReceipt = { receipt = it to markedAtOf(it) }, onAdjust = { asking = it }, onAbsence = onInformAbsence, onDay = { openDay(it, "records") }, onArchive = { selectedReceiptArchive = true })
        else if (section == "adjustments") AdjustmentHistoryTab(state, feedback.busy, vm) { openDay(it, "adjustments") }
        else if (section == "bank") BankTab(state, feedback.busy, vm) { openDay(it, "bank") }
        else if (section == "day" && detailDate != null) DayDetail(state, detailDate!!, feedback.busy,
            onReceipt = { receipt = it to markedAtOf(it) }, onAdjust = { asking = it }, onAbsence = onInformAbsence, focus = if (detailSource == "home") "records" else detailSource)
        else MirrorYearTab(state, feedback.busy, vm) { competence -> vm.openMirror(competence) { selectedMirror = true } }
    }
}

@Composable private fun TimeSectionCard(title: String, subtitle: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(18.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Tokens.border),
        colors = CardDefaults.cardColors(containerColor = Tokens.surface), elevation = CardDefaults.cardElevation(0.dp)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(subtitle, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable private fun AuxiliaryMonthPicker(state: TimeState, busy: Boolean, vm: TimeViewModel) {
    val first = state.month.atDay(1)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        NavSquare("‹", "Mês anterior", !busy) { vm.selectAuxiliaryMonth(state.month.minusMonths(1)) }
        Text(first.format(DateTimeFormatter.ofPattern("MMMM 'de' yyyy", ptBR)).replaceFirstChar { it.titlecase(ptBR) },
            style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        NavSquare("›", "Próximo mês", !busy && state.month.isBefore(java.time.YearMonth.from(state.today))) { vm.selectAuxiliaryMonth(state.month.plusMonths(1)) }
    }
}

private fun competenceTitle(competence: String) = runCatching {
    java.time.YearMonth.parse(competence).atDay(1).format(DateTimeFormatter.ofPattern("MMMM 'de' yyyy", ptBR)).replaceFirstChar { it.titlecase(ptBR) }
}.getOrDefault(competence)

/** Filter row of the consultations: pills that scroll sideways when they do not fit. */
@Composable private fun FilterRow(values: List<Pair<String, String>>, selected: String, enabled: Boolean, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        values.forEach { (id, label) -> PillChoice(label, selected == id, enabled) { onSelect(id) } }
    }
}

/** Count over a label, tappable as a filter; the tone repeats what the text says. */
@Composable private fun CountTile(value: String, label: String, ink: Color, background: Color, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(background).border(if (selected) 2.dp else 1.dp, if (selected) Tokens.accent else Tokens.border, RoundedCornerShape(14.dp))
        .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(value, color = ink, style = MaterialTheme.typography.titleLarge.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
        Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
    }
}

private fun purposeColor(purpose: String?) = when (purpose) {
    "journey_start" -> Tokens.ok
    "break_start", "break_end" -> Tokens.info
    "journey_end" -> Tokens.ink
    else -> Tokens.faint
}

/** Times of a day, each with the dot of its purpose; discarded punches stay struck. */
@Composable private fun PunchTimes(punches: List<DayPunch>) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        punches.forEach { punch ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.size(7.dp).background(purposeColor(if (punch.discarded) null else punch.purpose), RoundedCornerShape(50)))
                Text(punch.time, color = if (punch.discarded) Tokens.faint else Tokens.ink,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold,
                        textDecoration = if (punch.discarded) TextDecoration.LineThrough else null))
            }
        }
    }
}

@Composable private fun BankTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onDay: (String) -> Unit) {
    AuxiliaryMonthPicker(state, busy, vm)
    val response = state.bank
    val statement = response?.statement
    var filter by rememberSaveable { mutableStateOf("all") }
    when {
        response == null && !busy -> EmptyState("Banco ainda não carregado", "Puxe a tela para baixo para tentar novamente.")
        response?.policy == null -> EmptyState("Sem política de banco de horas", "O DP ainda não vinculou uma política vigente para este período.")
        statement == null -> EmptyState("Extrato indisponível", "Não há apuração disponível para este período.")
        else -> {
            CardBlock(selected = true) {
                val (balanceStatus, statusInk, statusBg) = when {
                    response.previewCompetences.isNotEmpty() -> Triple("Prévia · mês aberto", Tokens.info, Tokens.infoBg)
                    statement.missing.isNotEmpty() || statement.settlementOutdated -> Triple("Pendente de reapuração", Tokens.warning, Tokens.warningBg)
                    else -> Triple("Fechado", Tokens.okInk, Tokens.okBg)
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text("Saldo do ciclo", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                        Text(TimeRules.durationText(statement.balanceMinutes, true), style = MaterialTheme.typography.headlineLarge.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold),
                            color = if (statement.balanceMinutes < 0) Tokens.warning else Tokens.ink)
                    }
                    StatusChip(balanceStatus, statusInk, statusBg)
                }
                statement.cycle?.let { cycle ->
                    Text("Ciclo ${fullDate(cycle.start)} a ${fullDate(cycle.end)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    TimeRules.cycleProgress(cycle, state.today)?.let { (elapsed, total) ->
                        LinearProgressIndicator(progress = { elapsed.toFloat() / total }, color = Tokens.ink, trackColor = Tokens.greyBg,
                            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(50))
                                .semantics { contentDescription = "Ciclo do banco: dia $elapsed de $total" })
                        Text(if (elapsed >= total) "Ciclo encerrado" else "Dia $elapsed de $total · faltam ${total - elapsed} dias", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatBox("Créditos", TimeRules.durationText(statement.credit), Modifier.weight(1f))
                    StatBox("Débitos", TimeRules.durationText(statement.debit), Modifier.weight(1f))
                    StatBox("Para a folha", TimeRules.durationText(statement.payroll + statement.discount), Modifier.weight(1f))
                }
            }
            val notices = listOfNotNull(
                "O mês aberto pode mudar até o fechamento.".takeIf { response.previewCompetences.isNotEmpty() },
                statement.missing.takeIf { it.isNotEmpty() }?.let { "Falta apurar: ${it.joinToString()}" },
                statement.nightMinutes.takeIf { it > 0 }?.let { "${TimeRules.durationText(it)} em período noturno. Hora reduzida e adicional seguem para conferência da folha." },
                statement.lines.count { TimeRules.bankGroup(it.line.nature) == "review" }.takeIf { it > 0 }?.let { "$it ${if (it == 1) "lançamento" else "lançamentos"} a conferir pelo DP." })
            if (notices.isNotEmpty()) Column(Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (response.previewCompetences.isNotEmpty()) "Prévia: antes do fechamento" else "Antes de conferir", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold))
                notices.forEach { Text("• $it", color = Tokens.warning, style = MaterialTheme.typography.bodySmall) }
            }
            if (statement.lines.isEmpty()) EmptyState("Nenhum lançamento neste ciclo")
            else {
                FilterRow(listOf("all" to "Todos", "credit" to "Créditos", "debit" to "Débitos", "payroll" to "Folha", "review" to "A conferir"), filter, !busy) { filter = it }
                val shown = statement.lines.asReversed().take(100).filter { filter == "all" || TimeRules.bankGroup(it.line.nature) == filter }
                if (shown.isEmpty()) EmptyState("Nenhum lançamento neste filtro")
                shown.groupBy { it.competence }.forEach { (competence, items) ->
                    val closure = items.maxOf { it.closureVersion }
                    val monthMinutes = items.sumOf { when (it.line.nature) { "bank_credit" -> it.line.minutes; "bank_debit" -> -it.line.minutes; else -> 0 } }
                    CardBlock {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("${competenceTitle(competence)} · ${if (closure > 0) "fechado versão $closure" else "prévia"}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Text(TimeRules.durationText(monthMinutes, true), color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont))
                        }
                        items.forEach { item ->
                            var open by rememberSaveable(item.date, item.line.nature, item.line.minutes) { mutableStateOf(false) }
                            HorizontalDivider(color = Tokens.border)
                            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = if (open) "Ocultar detalhes" else "Mostrar detalhes") { open = !open },
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(TimeRules.bankReasonText(item.line.reason), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold))
                                    Text("${shortDate(item.date) ?: item.date} · ${TimeRules.bankNatureText(item.line.nature)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                                }
                                val signedMinutes = when (item.line.nature) { "bank_credit" -> item.line.minutes; "bank_debit" -> -item.line.minutes; else -> 0 }
                                Text(if (signedMinutes == 0) TimeRules.durationText(item.line.minutes) else TimeRules.durationText(signedMinutes, true),
                                    color = if (item.line.nature == "bank_debit") Tokens.warning else Tokens.ink, style = MaterialTheme.typography.titleMedium.copy(fontFamily = CodeFont))
                                DropdownChevron(open, Tokens.muted)
                            }
                            if (open) {
                                SummaryLine("Competência", competenceTitle(item.competence))
                                SummaryLine("Apuração", if (item.closureVersion > 0) "Fechamento versão ${item.closureVersion}" else "Prévia do mês em aberto")
                                Action("Ver dia", secondary = true, enabled = !busy) { onDay(item.date) }
                            }
                        }
                    }
                }
            }
            if (statement.lines.size > 100) Text("Mostrando os 100 lançamentos mais recentes do ciclo.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable private fun MirrorYearTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onMirror: (String) -> Unit) {
    val year = state.month.year
    // The latest closed competence of the year loaded, one tap away.
    val latest = state.mirrors.entries.filter { it.value.closure?.status == "closed" }.maxByOrNull { it.key }
    if (state.mirrorYear == year) latest?.let { (competence, status) ->
        CardBlock(selected = true) {
            Text("Último espelho disponível", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            Text("${competenceTitle(competence)} · versão ${status.closure?.version ?: "—"}", style = MaterialTheme.typography.titleMedium)
            Action("Abrir espelho", enabled = !busy) { onMirror(competence) }
        }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        NavSquare("‹", "Ano anterior", !busy) { vm.selectAuxiliaryMonth(state.month.minusYears(1)) }
        Text("$year", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        NavSquare("›", "Próximo ano", !busy && year < state.today.year) { vm.selectAuxiliaryMonth(state.month.plusYears(1)) }
    }
    Text("Cada mês fechado pelo sistema fica disponível aqui. Na primeira abertura, o documento é preparado automaticamente.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
    val current = java.time.YearMonth.from(state.today)
    val months = (1..12).map { java.time.YearMonth.of(year, it) }.filter { !it.isAfter(current) }
    if (state.mirrorYear != year && busy) Text("Carregando competências…", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
    months.chunked(3).forEach { row ->
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            row.forEach { month ->
                val status = state.mirrors[month.toString()]
                val closed = status?.closure?.status == "closed"
                val (label, tone) = when {
                    status == null && busy -> "Carregando" to Tokens.muted
                    closed && status?.mirror != null -> "Disponível" to Tokens.okInk
                    closed -> "Fechado" to Tokens.okInk
                    status?.closure != null -> "Reaberto" to Tokens.warning
                    month == current -> "Em aberto" to Tokens.wine
                    else -> "Sem fechamento" to Tokens.muted
                }
                Card(onClick = { onMirror(month.toString()) }, enabled = closed && !busy, modifier = Modifier.weight(1f).fillMaxHeight(),
                    shape = RoundedCornerShape(16.dp), border = androidx.compose.foundation.BorderStroke(if (month == current) 1.5.dp else 1.dp,
                        when { month == current -> Tokens.accent; closed -> Tokens.border; else -> Tokens.fieldBorder }),
                    colors = CardDefaults.cardColors(containerColor = if (closed) Tokens.surface else Tokens.soft,
                        disabledContainerColor = Tokens.soft, disabledContentColor = Tokens.muted)) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(month.atDay(1).format(DateTimeFormatter.ofPattern("MMM", ptBR)).replaceFirstChar { it.titlecase(ptBR) }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Box(Modifier.size(8.dp).background(tone, RoundedCornerShape(50)))
                        }
                        Text(label, color = tone, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp, fontWeight = FontWeight.Bold))
                        when {
                            closed -> status?.closure?.let { Text("Versão ${it.version}${if (status.mirror != null) " · abrir" else ""}", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp)) }
                            month == current -> Text("fecha após ${month.atEndOfMonth().format(DateTimeFormatter.ofPattern("dd/MM"))}", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
                        }
                    }
                }
            }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(Triple(Tokens.okInk, "Disponível", "mês fechado; o documento é preparado na primeira abertura."),
            Triple(Tokens.wine, "Em aberto", "mês corrente, ainda sem espelho."),
            Triple(Tokens.warning, "Reaberto", "o DP reabriu a competência; aguarde o novo fechamento."),
            Triple(Tokens.muted, "Sem fechamento", "não houve apuração do mês.")).forEach { (tone, title, hint) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(8.dp).background(tone, RoundedCornerShape(50)))
                Text("$title: $hint", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** The shift of a day said once: the unit and the hours, each in a pill (the shift name stays in the schedule). */
@Composable private fun ShiftPills(shift: OwnShift?) {
    val unit = shift?.unitName?.takeIf { it.isNotBlank() }
    val hours = TimeRules.shiftHours(shift)
    if (unit == null && hours == null) return
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        unit?.let { StatusChip(it, Tokens.muted, Tokens.soft, Modifier.weight(1f, fill = false)) }
        hours?.let { StatusChip(it, Tokens.muted, Tokens.soft) }
    }
}

/** Day actions in a grid of two equal columns: same width and height, one line each. */
@Composable private fun DayActions(actions: List<Pair<String, () -> Unit>>, enabled: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        actions.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { (label, onClick) -> Box(Modifier.weight(1f)) { Action(label, enabled = enabled, secondary = true, onClick = onClick) } }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable private fun RecordsTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onReceipt: (DayPunch) -> Unit,
    onAdjust: (String) -> Unit, onAbsence: (String) -> Unit, onDay: (String) -> Unit, onArchive: () -> Unit) {
    val first = state.month.atDay(1)
    val officialMarkings = state.markings.filterNot { it.pilot }
    val hasPilotMarkings = state.markings.any { it.pilot }
    var filter by rememberSaveable { mutableStateOf("all") }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        NavSquare("‹", "Mês anterior", !busy) { vm.month(state.month.minusMonths(1)) }
        Text(first.format(DateTimeFormatter.ofPattern("MMMM 'de' yyyy", ptBR)).replaceFirstChar { it.titlecase(ptBR) }, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        NavSquare("›", "Próximo mês", !busy && state.month.isBefore(java.time.YearMonth.from(state.today))) { vm.month(state.month.plusMonths(1)) }
    }
    if (!state.monthDataAvailable) {
        EmptyState("Registros ainda não consultados", "Puxe para atualizar quando a consulta estiver disponível.")
        return
    }
    if (state.truncated) Text("O mês tem mais registros do que esta lista mostra; o espelho completo fica no Coala One.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    val last = if (state.month == java.time.YearMonth.from(state.today)) state.today else state.month.atEndOfMonth()
    val days = generateSequence(last) { it.minusDays(1) }.takeWhile { !it.isBefore(first) }.toList()
        .filter { date -> state.markings.any { it.workDate == date.toString() } || state.shifts.any { it.date == date.toString() } || state.treatments.any { it.workDate == date.toString() } }
    val readings = days.associateWith { date -> TimeRules.recordDay(date.toString(), state.markings, state.shifts.firstOrNull { it.date == date.toString() }, state.treatments, state.today) }
    val withAdjustment = state.adjustments.filter { it.status == "in_review" }.map { it.workDate }.toSet()
    val toReview = days.filter { it.toString() !in state.automaticAbsences
        && readings[it]?.first in setOf(com.coalaone.go.domain.RecordDayState.MISSING, com.coalaone.go.domain.RecordDayState.REVIEW) }
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CountTile("${days.count { d -> state.markings.any { it.workDate == d.toString() } }}", "dias com batida", Tokens.ink, Tokens.surface, filter == "all", Modifier.weight(1f).fillMaxHeight()) { filter = "all" }
        CountTile("${toReview.size}", "a conferir", if (toReview.isEmpty()) Tokens.ink else Tokens.warning, if (toReview.isEmpty()) Tokens.surface else Tokens.warningBg, filter == "review", Modifier.weight(1f).fillMaxHeight()) { filter = "review" }
        CountTile("${withAdjustment.count { d -> days.any { it.toString() == d } }}", "ajuste em análise", if (withAdjustment.isEmpty()) Tokens.ink else Tokens.amberInk, if (withAdjustment.isEmpty()) Tokens.surface else Tokens.amberBg, filter == "adjustment", Modifier.weight(1f).fillMaxHeight()) { filter = "adjustment" }
    }
    val shown = when (filter) { "review" -> toReview; "adjustment" -> days.filter { it.toString() in withAdjustment }; else -> days }
    if (days.isEmpty()) EmptyState("Nenhuma batida neste mês")
    else if (shown.isEmpty()) EmptyState(if (filter == "review") "Nenhum dia a conferir" else "Nenhum ajuste em análise", "Toque em \"dias com batida\" para ver o mês inteiro.")
    shown.forEach { date ->
        val key = date.toString()
        val shift = state.shifts.firstOrNull { it.date == key }
        val punches = TimeRules.day(key, state.markings, state.treatments)
        val (reading, worked) = readings[date] ?: (com.coalaone.go.domain.RecordDayState.EMPTY to null)
        var open by rememberSaveable(key) { mutableStateOf(false) }
        CardBlock {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = if (open) "Recolher dia" else "Abrir dia") { open = !open }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(dayTitle(date) + if (date == state.today) " · hoje" else "", style = MaterialTheme.typography.titleMedium)
                    if (punches.isEmpty()) Text("Nenhuma batida", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    else PunchTimes(punches)
                }
                when {
                    key in withAdjustment -> StatusChip("Ajuste em análise", Tokens.amberInk, Tokens.amberBg)
                    key in state.automaticAbsences -> StatusChip("Falta registrada", Tokens.danger, Tokens.dangerBg)
                    reading == com.coalaone.go.domain.RecordDayState.MISSING -> StatusChip("Sem batida", Tokens.warning, Tokens.warningBg)
                    reading == com.coalaone.go.domain.RecordDayState.REVIEW -> StatusChip("A conferir", Tokens.warning, Tokens.warningBg)
                    reading == com.coalaone.go.domain.RecordDayState.IN_PROGRESS -> StatusChip("Em andamento", Tokens.wine, Tokens.accentSoft)
                    // Calculated from the punches on the phone: always a preview, the closing is the reference.
                    worked != null -> Column(horizontalAlignment = Alignment.End) {
                        Text(TimeRules.durationText(worked), style = MaterialTheme.typography.bodyMedium.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
                        Text("prévia", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
                    }
                }
                DropdownChevron(open, Tokens.muted)
            }
            if (open) {
                ShiftPills(shift)
                if (key in state.automaticAbsences) Text("Falta registrada automaticamente após 24 horas sem batida, solicitação de ausência ou ajuste. Você ainda pode solicitar ausência ou pedir ajuste deste dia.",
                    color = Tokens.danger, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().background(Tokens.dangerBg, RoundedCornerShape(12.dp)).padding(12.dp))
                PunchList(punches, !busy, state.options?.executionUnits.orEmpty(), onReceipt)
                val pilotDay = state.markings.any { it.workDate == key && it.pilot }
                DayActions(buildList {
                    add("Detalhar dia" to { onDay(key) })
                    add((if (pilotDay) "Simular ajuste" else "Pedir ajuste") to { onAdjust(key) })
                    if (punches.isEmpty() && shift?.type == "work") add("Informar ausência" to { onAbsence(key) })
                }, !busy)
                if (pilotDay) Text("Simulação: se aprovada, muda só este dia de teste, sem efeito fiscal.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    // Same inset as the cards' content, so the dots line up with the times above.
    if (days.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 2.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        listOf("journey_start" to "Início", "break_start" to "Intervalo", "journey_end" to "Fim").forEach { (purpose, label) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.size(7.dp).background(purposeColor(purpose), RoundedCornerShape(50)))
                Text(label, color = Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
            }
        }
    }
    CardBlock {
        Text("Comprovantes oficiais de ${first.format(DateTimeFormatter.ofPattern("MMMM", ptBR))}", style = MaterialTheme.typography.titleMedium)
        Text("${officialMarkings.size} ${if (officialMarkings.size == 1) "batida oficial" else "batidas oficiais"} · ensaios ficam fora do pacote", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        Action("Exportar comprovantes oficiais do mês", secondary = true,
            enabled = !busy && !state.truncated && officialMarkings.isNotEmpty(), onClick = onArchive)
        if (hasPilotMarkings) Text("Os comprovantes do ensaio ficam fora do pacote oficial. Abra cada batida para salvar ou compartilhar o comprovante identificado como ensaio.",
            color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun AdjustmentHistoryTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onDay: (String) -> Unit) {
    AuxiliaryMonthPicker(state, busy, vm)
    if (!state.monthDataAvailable) {
        EmptyState("Ajustes ainda não consultados", "Puxe para atualizar quando a consulta estiver disponível.")
        return
    }
    var filter by rememberSaveable { mutableStateOf("all") }
    if (state.adjustments.isEmpty() && !busy) EmptyState("Nenhum ajuste neste mês", "Os pedidos enviados aparecem aqui com a decisão do gestor ou do DP.")
    if (state.adjustments.isNotEmpty()) {
        val counts = state.adjustments.groupingBy { it.status }.eachCount()
        FilterRow(listOf("all" to "Todos ${state.adjustments.size}", "in_review" to "Em análise ${counts["in_review"] ?: 0}",
            "approved" to "Aprovados ${counts["approved"] ?: 0}", "rejected" to "Recusados ${counts["rejected"] ?: 0}") +
            (counts["cancelled"]?.let { listOf("cancelled" to "Cancelados $it") } ?: emptyList()), filter, !busy) { filter = it }
    }
    val shown = state.adjustments.filter { filter == "all" || it.status == filter }.sortedWith(compareByDescending<Adjustment> { it.workDate }.thenByDescending { it.createdAt })
    if (state.adjustments.isNotEmpty() && shown.isEmpty()) EmptyState("Nenhum ajuste nesta situação")
    shown.forEach { adjustment ->
        var open by rememberSaveable(adjustment.id) { mutableStateOf(false) }
        val operations = adjustment.operations.ifEmpty { listOf(AdjustmentOperation(adjustment.kind, adjustment.target, adjustment.inclusion)) }
        val times = operations.mapNotNull { it.inclusion?.markedAt ?: it.target?.markedAt }.joinToString(" · ") { TimeRules.minuteOf(it) }
        val (ink, background) = when (adjustment.status) { "approved" -> Tokens.okInk to Tokens.okBg; "in_review" -> Tokens.amberInk to Tokens.amberBg; else -> Tokens.muted to Tokens.soft }
        CardBlock(selected = open && adjustment.status == "in_review") {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClickLabel = if (open) "Recolher pedido" else "Abrir pedido") { open = !open },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(runCatching { dayTitle(LocalDate.parse(adjustment.workDate)) }.getOrDefault(adjustment.workDate), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    Text(listOf(TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == adjustment.kind }?.second ?: adjustment.kind, times).filter { it.isNotBlank() }.joinToString(" · "),
                        style = MaterialTheme.typography.titleMedium)
                    if (adjustment.scope == "pilot") Text("SIMULAÇÃO DO ENSAIO", color = Tokens.warning, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = .5.sp))
                }
                StatusChip(if (adjustment.scope == "pilot" && adjustment.status == "approved") "Simulação aprovada" else TimeRules.ADJUSTMENT_STATUS[adjustment.status]?.substringBefore(" ·") ?: adjustment.status, ink, background)
                DropdownChevron(open, Tokens.muted)
            }
            if (open) {
                operations.forEach { operation ->
                    // Before and after side by side: the original is struck, never removed from the record.
                    Row(Modifier.fillMaxWidth().background(Tokens.soft, RoundedCornerShape(14.dp)).border(1.dp, Tokens.border, RoundedCornerShape(14.dp)).padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text("Batida original", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                            Text(operation.target?.let { TimeRules.minuteOf(it.markedAt) } ?: "—", color = Tokens.faint,
                                style = MaterialTheme.typography.titleLarge.copy(fontFamily = CodeFont, textDecoration = if (operation.target != null && operation.kind != "include") TextDecoration.LineThrough else null))
                            operation.target?.let { Text(if (adjustment.scope == "pilot") "Sequência do ensaio ${it.pilotSequence ?: "—"}" else "Registro oficial ${it.nsr ?: "—"}", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp)) }
                        }
                        Text("→", color = Tokens.faint, style = MaterialTheme.typography.titleMedium)
                        Column(Modifier.weight(1f)) {
                            Text(if (operation.kind == "discard") "Pedido" else "Horário informado", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                            Text(operation.inclusion?.let { TimeRules.minuteOf(it.markedAt) } ?: "Desconsiderar", style = MaterialTheme.typography.titleLarge.copy(fontFamily = CodeFont))
                        }
                    }
                }
                Text("“${adjustment.reason}”", style = MaterialTheme.typography.bodySmall)
                if (adjustment.acts.isNotEmpty()) {
                    Text("TRILHA", color = Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
                    adjustment.acts.sortedBy { it.at }.forEach { act ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                            Box(Modifier.padding(top = 5.dp).size(8.dp).background(if (act.action == "approved") Tokens.ok else if (act.action == "rejected") Tokens.warning else Tokens.ink, RoundedCornerShape(50)))
                            Column {
                                Text(TimeRules.adjustmentActText(act), style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold))
                                Text(listOfNotNull(shortDate(act.at), act.reason).joinToString(" · "),
                                    color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                if (adjustment.scope == "pilot") Text("A decisão testa o fluxo e não altera o ponto, o banco, o espelho ou a folha.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                else if (adjustment.status == "in_review") Text("A batida original continua no registro; nada é apagado.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
                Action("Ver dia", secondary = true, enabled = !busy) { onDay(adjustment.workDate) }
            }
        }
    }
}

@Composable private fun DayDetail(state: TimeState, workDate: String, busy: Boolean, onReceipt: (DayPunch) -> Unit,
    onAdjust: (String) -> Unit, onAbsence: (String) -> Unit, focus: String) {
    val date = runCatching { LocalDate.parse(workDate) }.getOrNull() ?: return
    if (!state.monthDataAvailable) {
        EmptyState("Batidas ainda não consultadas", "Puxe para atualizar quando a consulta estiver disponível.")
        return
    }
    val shift = state.shifts.firstOrNull { it.date == workDate }
    val punches = TimeRules.journeyDay(workDate, shift, state.markings, state.treatments)
    val pilotDay = state.markings.any { it.workDate == workDate && it.pilot }
    val adjustments = state.adjustments.filter { it.workDate == workDate }.sortedByDescending { it.createdAt }
    val lines = state.bank?.statement?.lines.orEmpty().filter { it.date == workDate }
    val planned = TimeRules.plannedWorkMinutes(shift)
    val worked = TimeRules.workedMinutes(punches)
    val breakMinutes = TimeRules.recordedBreakMinutes(punches)
    val closureVersion = lines.maxOfOrNull { it.closureVersion } ?: 0
    val balance = lines.sumOf { when (it.line.nature) { "bank_credit", "payroll_overtime" -> it.line.minutes; "bank_debit", "payroll_discount" -> -it.line.minutes; else -> 0 } }
    CardBlock(selected = focus == "bank") {
        Text(dayTitle(date), style = MaterialTheme.typography.titleLarge)
        Text(if (closureVersion > 0) "Resultado fechado · versão $closureVersion" else "Resultado provisório",
            color = if (closureVersion > 0) Tokens.okInk else Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) { Text("Previsto", color = Tokens.muted, style = MaterialTheme.typography.bodySmall); Text(planned?.let { TimeRules.durationText(it) } ?: "—", style = MaterialTheme.typography.titleLarge) }
            Column(Modifier.weight(1f)) { Text("Trabalhado", color = Tokens.muted, style = MaterialTheme.typography.bodySmall); Text(worked?.let { TimeRules.durationText(it) } ?: "Incompleto", style = MaterialTheme.typography.titleLarge) }
            Column(Modifier.weight(1f)) { Text("Resultado", color = Tokens.muted, style = MaterialTheme.typography.bodySmall); Text(if (lines.isEmpty()) "—" else TimeRules.durationText(balance, true), style = MaterialTheme.typography.titleLarge, color = if (balance < 0) Tokens.warning else Tokens.ink) }
        }
    }
    CardBlock(selected = focus == "records") {
        Text("Jornada e batidas", style = MaterialTheme.typography.titleMedium)
        if (shift == null) SummaryLine("Escala", "Sem turno informado") else ShiftPills(shift)
        if (shift?.executionUnitPolicy == "free") SummaryLine("Local de trabalho", "Entre unidades")
        SummaryLine("Intervalo", "${TimeRules.durationText(breakMinutes)} realizado" + (TimeRules.plannedBreakMinutes(shift).takeIf { it > 0 }?.let { " de ${TimeRules.durationText(it)} previsto" } ?: ""))
        val detailNow = state.clockOffset?.let { android.os.SystemClock.elapsedRealtime() + it } ?: System.currentTimeMillis()
        TimeRules.breakStatus(shift, state.markings.filter { it.workDate == workDate }, detailNow, TimeRules.unitZone(state.options, state.unitId))
            ?.takeIf { it.level != BreakLevel.NEUTRAL }?.let { BreakNoticeCard(it) }
        HorizontalDivider(color = Tokens.border)
        if (punches.isEmpty()) Text("Nenhuma batida registrada.", color = Tokens.muted) else PunchList(punches, !busy, state.options?.executionUnits.orEmpty(), onReceipt, showLocation = true)
    }
    CardBlock(selected = focus == "bank") {
        Text("Memória de cálculo", style = MaterialTheme.typography.titleMedium)
        if (state.bankDate != workDate && busy) Text("Carregando a apuração do dia…", color = Tokens.muted)
        else if (lines.isEmpty()) Text("Nenhum crédito ou débito foi lançado para este dia.", color = Tokens.muted)
        lines.forEach { item ->
            val signed = when (item.line.nature) { "bank_credit", "payroll_overtime" -> item.line.minutes; "bank_debit", "payroll_discount" -> -item.line.minutes; else -> item.line.minutes }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(TimeRules.bankNatureText(item.line.nature), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold))
                    Text(TimeRules.bankReasonText(item.line.reason), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                }
                Text(TimeRules.durationText(signed, true), color = if (signed < 0) Tokens.warning else Tokens.ink, style = MaterialTheme.typography.titleMedium)
            }
        }
        if (worked == null && punches.isNotEmpty()) Text("Há uma sequência incompleta de batidas; o resultado depende da análise do DP.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    }
    CardBlock(selected = focus == "adjustments") {
        Text("Ajustes e ocorrências", style = MaterialTheme.typography.titleMedium)
        TimeRules.breakIssue(state.markings.filter { it.workDate == workDate }, shift)?.let { Text(it, color = Tokens.warning, style = MaterialTheme.typography.bodySmall) }
        if (adjustments.isEmpty()) Text("Nenhuma solicitação relacionada a este dia.", color = Tokens.muted)
        adjustments.forEach { adjustment ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == adjustment.kind }?.second ?: adjustment.kind, modifier = Modifier.weight(1f))
                StatusChip(if (adjustment.scope == "pilot" && adjustment.status == "approved") "Simulação aprovada · só no ensaio" else TimeRules.ADJUSTMENT_STATUS[adjustment.status] ?: adjustment.status,
                    if (adjustment.status == "approved") Tokens.okInk else if (adjustment.status == "in_review") Tokens.warning else Tokens.muted,
                    if (adjustment.status == "approved") Tokens.okBg else if (adjustment.status == "in_review") Tokens.warningBg else Tokens.soft)
            }
        }
    }
    if (pilotDay) Text("Simulação: se aprovada, muda só este dia de teste; não altera ponto oficial, banco, espelho ou folha.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    DayActions(buildList {
        add((if (pilotDay) "Simular ajuste" else "Pedir ajuste") to { onAdjust(workDate) })
        if (punches.isEmpty() && shift?.type == "work") add("Informar ausência" to { onAbsence(workDate) })
    }, !busy)
}

@Composable private fun AdjustmentWeekPicker(value: String, today: LocalDate, enabled: Boolean, onChange: (String) -> Unit) {
    val selected = runCatching { LocalDate.parse(value) }.getOrDefault(today)
    val weekStart = selected.minusDays((selected.dayOfWeek.value - 1).toLong())
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        NavSquare("‹", "Semana anterior", enabled) { onChange(weekStart.minusWeeks(1).toString()) }
        Text("${weekStart.format(DateTimeFormatter.ofPattern("dd/MM"))} a ${weekStart.plusDays(6).format(DateTimeFormatter.ofPattern("dd/MM"))}",
            style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        NavSquare("›", "Próxima semana", enabled && !weekStart.plusWeeks(1).isAfter(today)) { onChange(weekStart.plusWeeks(1).coerceAtMost(today).toString()) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        (0L..6L).forEach { offset ->
            val day = weekStart.plusDays(offset)
            val available = enabled && !day.isAfter(today)
            val chosen = day == selected
            Card(onClick = { onChange(day.toString()) }, enabled = available, modifier = Modifier.weight(1f), shape = RoundedCornerShape(12.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, if (chosen) Tokens.accent else Tokens.border),
                colors = CardDefaults.cardColors(containerColor = if (chosen) Tokens.accentSoft else Tokens.surface, disabledContainerColor = Tokens.soft)) {
                Column(Modifier.fillMaxWidth().padding(vertical = 9.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(day.format(DateTimeFormatter.ofPattern("EE", ptBR)).take(3).uppercase(ptBR), color = if (chosen) Tokens.wine else Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
                    Text(day.dayOfMonth.toString(), style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
    DateField("Abrir calendário para outra data", value, enabled) { if (!LocalDate.parse(it).isAfter(today)) onChange(it) }
}

/** Two steps, as on the web: the form, then a short report of what the DP will receive. */
@Composable private fun AdjustmentScreen(vm: TimeViewModel, initialDate: String, onClose: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var date by rememberSaveable { mutableStateOf(initialDate) }
    var kind by rememberSaveable { mutableStateOf("include") }
    var includedTimes by rememberSaveable { mutableStateOf(listOf("")) }
    var selectedTargets by rememberSaveable { mutableStateOf(listOf<String>()) }
    var correctedTimes by rememberSaveable { mutableStateOf(mapOf<String, String>()) }
    var reason by rememberSaveable { mutableStateOf("") }
    var review by rememberSaveable { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val attemptId = rememberSaveable { TimeRules.newAttempt() }
    LaunchedEffect(date) { selectedTargets = emptyList(); correctedTimes = emptyMap(); val month = runCatching { java.time.YearMonth.from(LocalDate.parse(date)) }.getOrNull(); if (month != null && month != state.month) vm.month(month) }
    val punches = TimeRules.day(date, state.markings, state.treatments)
    val choices = punches.filter { !it.discarded && !it.included && it.receiptId != null }
    val sent = state.sentAdjustment
    val pilotSimulation = state.markings.any { it.workDate == date && it.pilot }
        || (date == state.today.toString() && state.options?.mode == "pilot")
    val kindLabel = TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == kind }?.second.orEmpty()
    fun operations() = when (kind) {
        "include" -> includedTimes.filter { it.isNotBlank() }.map { AdjustmentRequestOperation("include", newTime = it, executionUnitId = state.unitId) }
        "discard" -> selectedTargets.map { AdjustmentRequestOperation("discard", targetReceiptId = it) }
        else -> selectedTargets.map { AdjustmentRequestOperation("correct", targetReceiptId = it, newTime = correctedTimes[it].orEmpty(), executionUnitId = state.unitId) }
    }
    fun check(): Boolean = try { TimeRules.adjustmentRequest(attemptId, date, operations(), reason, state.today); problem = null; true } catch (cause: IllegalArgumentException) { problem = cause.message; false }
    Page(if (pilotSimulation) "Simular ajuste" else "Pedir ajuste", feedback.copy(error = problem ?: feedback.error), onClose, footer = {
        when {
            sent != null -> Action("Concluir") { onClose() }
            review -> FooterPair("Editar", !feedback.busy, { review = false }, "Enviar pedido", !feedback.busy) { vm.requestAdjustment(attemptId, date, operations(), reason) }
            else -> Action("Revisar pedido", feedback.busy) { if (check()) review = true }
        }
    }) {
        if (sent != null) {
            CardBlock(selected = true) {
                Text(if (sent.scope == "pilot") "Simulação enviada" else "Pedido enviado", style = MaterialTheme.typography.titleMedium)
                Text(if (sent.scope == "pilot") "O DP pode analisar todo o fluxo. A decisão não altera ponto, banco, espelho ou folha."
                    else "O DP analisa e decide. Você acompanha a situação no Histórico do dia ${fullDate(sent.workDate)}.", color = Tokens.muted)
            }
            return@Page
        }
        if (review) {
            CardBlock {
                Text("Resumo do pedido", style = MaterialTheme.typography.titleMedium)
                SummaryLine("Quem pede", "Você, pela sua conta no Coala Go")
                SummaryLine("Dia", fullDate(date))
                SummaryLine("Batidas registradas", punches.filter { !it.discarded }.joinToString(" · ") { it.time }.ifBlank { "Nenhuma" })
                SummaryLine("Pedido", kindLabel)
                if (kind != "include") SummaryLine("Batidas escolhidas", selectedTargets.mapNotNull { id -> choices.firstOrNull { it.receiptId == id }?.let { "${it.time} · ${if (it.pilot) "sequência do ensaio" else "registro oficial"} ${it.nsr}" } }.joinToString("; "))
                if (kind == "include") SummaryLine("Horários informados", includedTimes.filter { it.isNotBlank() }.joinToString(" · "))
                if (kind == "correct") SummaryLine("Correções", selectedTargets.mapNotNull { id -> choices.firstOrNull { it.receiptId == id }?.let { "${it.time} → ${correctedTimes[id].orEmpty()}" } }.joinToString("; "))
                SummaryLine("Justificativa", reason.trim())
            }
            Text(if (pilotSimulation) "SIMULAÇÃO · A aprovação serve somente para testar o fluxo e não produz tratamento ou efeito fiscal."
                else "A batida original nunca é apagada. Se o DP aprovar, o ajuste entra no ponto com a identificação de quem pediu e de quem decidiu.",
                color = if (pilotSimulation) Tokens.warning else Tokens.muted, style = MaterialTheme.typography.bodySmall)
            return@Page
        }
        if (pilotSimulation) Text("SIMULAÇÃO DO ENSAIO · O pedido e a decisão ficam separados do ponto oficial e não entram no fechamento.",
            color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
            modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
        AdjustmentWeekPicker(date, state.today, !feedback.busy) { date = it }
        Text("O que aconteceu?", style = MaterialTheme.typography.titleMedium)
        TimeRules.ADJUSTMENT_KINDS.forEach { (id, label) ->
            val available = id == "include" || choices.isNotEmpty()
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = !feedback.busy && available, role = Role.RadioButton) { kind = id; selectedTargets = emptyList(); correctedTimes = emptyMap() }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RadioButton(kind == id, null)
                Column(Modifier.weight(1f)) { Text(label, color = if (available) Tokens.ink else Tokens.faint); Text(if (available) TimeRules.ADJUSTMENT_HINTS[id].orEmpty() else "Não há batida neste dia para escolher.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
            }
        }
        if (kind == "include") {
            Text("Horários que faltaram", style = MaterialTheme.typography.titleMedium)
            includedTimes.forEachIndexed { index, value ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LabeledTimeInput("Horário ${index + 1}", value, !feedback.busy, modifier = Modifier.weight(1f)) { next ->
                        includedTimes = includedTimes.toMutableList().also { it[index] = next }
                    }
                    if (includedTimes.size > 1) TextButton({ includedTimes = includedTimes.filterIndexed { position, _ -> position != index } }, enabled = !feedback.busy) { Text("Remover", color = Tokens.danger) }
                }
            }
            Action("Adicionar outro horário", secondary = true, enabled = includedTimes.size < 8 && !feedback.busy) { includedTimes = includedTimes + "" }
            val expected = TimeRules.expectedPunches(state.shifts.firstOrNull { it.date == date })
            val resultingCount = choices.size + includedTimes.count { it.isNotBlank() }
            Text("Próxima marcação sugerida pela sequência: ${TimeRules.suggestedLabel(resultingCount, expected)}. A classificação é apenas visual; informe o horário real.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        } else {
            Text(if (kind == "discard") "Quais batidas devem ser desconsideradas?" else "Quais batidas estão com horário errado?", style = MaterialTheme.typography.titleMedium)
            choices.forEach { punch ->
                val id = punch.receiptId!!
                val selected = id in selectedTargets
                Column(Modifier.fillMaxWidth().border(1.dp, if (selected) Tokens.accent else Tokens.border, RoundedCornerShape(12.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth().clickable(enabled = !feedback.busy, role = Role.Checkbox) {
                        selectedTargets = if (selected) selectedTargets - id else selectedTargets + id
                    }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Checkbox(selected, null)
                        Text("${punch.time} · ${if (punch.pilot) "sequência do ensaio" else "registro oficial"} ${punch.nsr}", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                    }
                    if (kind == "correct" && selected) LabeledTimeInput("Horário correto", correctedTimes[id].orEmpty(), !feedback.busy) { next ->
                        correctedTimes = correctedTimes + (id to next)
                    }
                }
            }
        }
        NoteInput("Justificativa", reason, 1000, "Explique o que aconteceu (mínimo de 10 caracteres)", !feedback.busy) { reason = it }
    }
}

@Composable fun RequestsScreen(vm: RequestsViewModel, onBack: () -> Unit, initialTab: String = "", initialDate: String? = null) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    LaunchedEffect(Unit) { vm.load() }
    var tab by rememberSaveable { mutableStateOf(initialTab.takeIf { it in listOf("absence", "voucher", "swap") }.orEmpty()) }
    var creating by rememberSaveable { mutableStateOf(initialDate != null) }
    if (creating) {
        val close = { vm.clearSent(); vm.editAbsence(); if (initialDate != null) onBack() else creating = false }
        if (tab == "absence") AbsenceForm(vm, close, initialDate)
        else if (tab == "voucher") VoucherForm(vm, close)
        else ShiftSwapForm(vm, { vm.clearSent(); creating = false }, initialDate)
        return
    }
    val canCreateAbsence = state.absenceOptions?.capabilities?.canCreate == true && state.absenceOptions?.absenceTypes?.isNotEmpty() == true
    val swapOptions = state.shiftSwapOptions
    val canCreateSwap = swapOptions?.ownShifts?.any { own -> swapOptions.candidateShifts.any { other ->
        other.scheduleId == own.scheduleId && other.unitId == own.unitId && other.date == own.date } } == true
    if (tab.isBlank()) {
        Page("Solicitações", feedback, onBack, onRefresh = { vm.load() }) {
            Text("JORNADA", color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
            TimeSectionCard("Ausências", "Solicite aqui ou diretamente no dia escolhido na Escala.") { tab = "absence" }
            TimeSectionCard("Trocas de turno", "Solicite aqui ou diretamente no dia escolhido na Escala.") { tab = "swap" }
            Text("BENEFÍCIOS", color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.padding(top = 4.dp))
            TimeSectionCard("Vale-transporte", "Adesão, alteração, suspensão e reativação.") { tab = "voucher" }
            Text("Ajustes de ponto ficam em Ponto, no detalhe do dia e da batida que precisa ser corrigida.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
        }
        return
    }
    Page("Solicitações", feedback, onBack, onRefresh = { vm.load() }, footer = {
        if (tab == "absence") Action("Solicitar ausência", feedback.busy, enabled = canCreateAbsence) { creating = true }
        else if (tab == "voucher") Action("Solicitar vale-transporte", feedback.busy) { creating = true }
        else Action("Solicitar troca de turno", feedback.busy, enabled = canCreateSwap) { creating = true }
    }) {
        TextButton({ tab = "" }, enabled = !feedback.busy) { Text("‹ Voltar às categorias", color = Tokens.wine) }
        Text(if (tab == "absence") "Ausências" else if (tab == "voucher") "Vale-transporte" else "Trocas de turno", style = MaterialTheme.typography.titleLarge)
        if (tab == "absence") {
            Text("Você também pode iniciar esta solicitação diretamente pelo dia correspondente na Escala.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (state.absenceOptions != null && !canCreateAbsence) Text("Nenhum tipo de ausência liberado para você pedir agora.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (state.absences.isEmpty() && !feedback.busy) EmptyState("Nenhuma solicitação de ausência", "Os pedidos que você fizer aparecem aqui com a situação.")
            state.absences.forEach { row ->
                CardBlock {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(row.typeName, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        StatusChip(TimeRules.ABSENCE_STATUS[row.status] ?: row.status, if (row.status == "approved") Tokens.okInk else if (row.status in listOf("rejected", "cancelled")) Tokens.muted else Tokens.warning, if (row.status == "approved") Tokens.okBg else if (row.status in listOf("rejected", "cancelled")) Tokens.soft else Tokens.warningBg)
                    }
                    Text(listOfNotNull(if (row.input.startDate == row.input.endDate) fullDate(row.input.startDate) else "${fullDate(row.input.startDate)} a ${fullDate(row.input.endDate)}",
                        row.input.startTime?.let { start -> row.input.endTime?.let { "$start–$it" } }, TimeRules.quantityText(row.quantity, row.unit)).joinToString(" · "), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    if (row.approvedByInaction) StatusChip("Aprovada por decurso de prazo", Tokens.info, Tokens.infoBg)
                }
            }
            Text("Para anexar documentos depois do envio ou acompanhar a análise completa, use o Coala One.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
        } else if (tab == "voucher") {
            if (state.vouchers.isEmpty() && !feedback.busy) EmptyState("Nenhuma solicitação de vale-transporte", "Adesão, alteração, suspensão ou reativação.")
            state.vouchers.forEach { row ->
                CardBlock {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(TimeRules.VOUCHER_ACTIONS.firstOrNull { it.first == row.action }?.second ?: row.action, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        StatusChip(TimeRules.VOUCHER_STATUS[row.status] ?: row.status, if (row.status == "approved") Tokens.okInk else if (row.status == "pending") Tokens.warning else Tokens.muted, if (row.status == "approved") Tokens.okBg else if (row.status == "pending") Tokens.warningBg else Tokens.soft)
                    }
                    Text(listOfNotNull("Pedido em ${fullDate(row.requestDate)}", row.effectiveDate?.let { "vale a partir de ${fullDate(it)}" }).joinToString(" · "), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    row.review?.notes?.takeIf { it.isNotBlank() }?.let { Text("DP: $it", style = MaterialTheme.typography.bodySmall) }
                }
            }
        } else {
            Text("Você também pode iniciar esta solicitação diretamente pelo dia correspondente na Escala.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (!canCreateSwap && !feedback.busy) Text("Não há dois turnos elegíveis na mesma unidade e no mesmo dia.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (state.shiftSwaps.isEmpty() && !feedback.busy) EmptyState("Nenhuma troca de turno", "As propostas enviadas e recebidas aparecem aqui.")
            state.shiftSwaps.forEach { request -> ShiftSwapCard(request, feedback.busy, vm) }
        }
    }
}

private fun swapStatus(value: String) = when (value) { "pending" -> "Aguardando resposta"; "accepted" -> "Aceita"; "rejected" -> "Recusada"; "cancelled" -> "Cancelada"; else -> "Escala alterada" }
private fun swapShift(value: ShiftSwapShift) = "${fullDate(value.date)} · ${value.startTime}–${value.endTime} · ${value.occupantName}"

@Composable private fun ShiftSwapCard(request: ShiftSwapRequest, busy: Boolean, vm: RequestsViewModel) {
    var rejectReason by rememberSaveable(request.id) { mutableStateOf("") }
    CardBlock {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${request.requesterName} ⇄ ${request.targetName}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            StatusChip(swapStatus(request.status), if (request.status == "accepted") Tokens.okInk else if (request.status == "pending") Tokens.warning else Tokens.muted,
                if (request.status == "accepted") Tokens.okBg else if (request.status == "pending") Tokens.warningBg else Tokens.soft)
        }
        Text("Oferecido: ${swapShift(request.offeredShift)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        Text("Solicitado: ${swapShift(request.requestedShift)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        request.reason?.let { Text("Motivo: $it", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
        if (request.viewerActions.accept) {
            Text("Ao aceitar, você confirma sua identidade pela sessão autenticada e os dois turnos serão invertidos automaticamente.", color = Tokens.info, style = MaterialTheme.typography.bodySmall)
            Action("Aceitar e trocar", busy, onClick = { vm.decideShiftSwap(request, "accept") })
            NoteInput("Motivo da recusa", rejectReason, 500, "Explique por que não aceita (mínimo de 5 caracteres)", !busy) { rejectReason = it }
            Action("Recusar", busy, enabled = rejectReason.trim().length >= 5, secondary = true) { vm.decideShiftSwap(request, "reject", rejectReason.trim()) }
        } else if (request.viewerActions.cancel) Action("Cancelar proposta", busy, secondary = true) { vm.decideShiftSwap(request, "cancel") }
        if (request.events.isNotEmpty()) Text("${request.events.size} ${if (request.events.size == 1) "ato de identidade registrado" else "atos de identidade registrados"}.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun ShiftOptionCard(option: ShiftSwapOption, selected: Boolean, enabled: Boolean, showPerson: Boolean, onClick: () -> Unit) {
    Card(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
        border = androidx.compose.foundation.BorderStroke(if (selected) 2.dp else 1.dp, if (selected) Tokens.accent else Tokens.border),
        colors = CardDefaults.cardColors(containerColor = if (selected) Tokens.accentSoft else Tokens.surface, disabledContainerColor = Tokens.soft)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            RadioButton(selected, null, enabled = enabled)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(fullDate(option.date), style = MaterialTheme.typography.titleMedium)
                Text("${option.startTime}–${option.endTime} · ${option.shiftName ?: "Turno"}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                Text(listOfNotNull(option.unitName, option.occupantName.takeIf { showPerson }).joinToString(" · "), color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable private fun ShiftSwapForm(vm: RequestsViewModel, onClose: () -> Unit, initialDate: String? = null) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val options = state.shiftSwapOptions
    var offeredKey by rememberSaveable { mutableStateOf("") }
    var requestedKey by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var review by rememberSaveable { mutableStateOf(false) }
    val keyOf: (ShiftSwapOption) -> String = { "${it.scheduleId}:${it.shiftId}" }
    LaunchedEffect(options, initialDate) {
        if (offeredKey.isBlank() && initialDate != null) options?.ownShifts?.firstOrNull { it.date == initialDate }?.let { offeredKey = keyOf(it) }
    }
    val offered = options?.ownShifts?.firstOrNull { keyOf(it) == offeredKey }
    val candidates = options?.candidateShifts.orEmpty().filter { offered != null && it.scheduleId == offered.scheduleId && it.unitId == offered.unitId && it.date == offered.date }
    val requested = candidates.firstOrNull { keyOf(it) == requestedKey }
    val sent = state.sentShiftSwap
    LaunchedEffect(sent?.id) { if (sent != null) onClose() }
    Page("Troca de turno", feedback, onClose, footer = {
        if (review) FooterPair("Editar", !feedback.busy, { review = false }, "Enviar proposta", !feedback.busy) {
            vm.requestShiftSwap(offered!!, requested!!, reason.trim().ifBlank { null })
        } else Action("Revisar proposta", feedback.busy, enabled = offered != null && requested != null && (reason.isBlank() || reason.trim().length >= 5)) { review = true }
    }) {
        if (review && offered != null && requested != null) {
            CardBlock(selected = true) {
                Text("Resumo da proposta", style = MaterialTheme.typography.titleMedium)
                SummaryLine("Seu turno", "${fullDate(offered.date)} · ${offered.startTime}–${offered.endTime} · ${offered.unitName}")
                SummaryLine("Turno que deseja receber", "${requested.startTime}–${requested.endTime} · ${requested.occupantName}")
                SummaryLine("Motivo", reason.trim().ifBlank { "Não informado" })
            }
            Text("${requested.occupantName} será notificada. A escala só muda após o aceite autenticado pela própria conta.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            return@Page
        }
        val referenceMonth = runCatching { java.time.YearMonth.from(LocalDate.parse(initialDate ?: LocalDate.now().toString())) }.getOrDefault(java.time.YearMonth.now())
        val ownThisMonth = options?.ownShifts.orEmpty().filter { runCatching { java.time.YearMonth.from(LocalDate.parse(it.date)) }.getOrNull() == referenceMonth }
        Text("Meu turno · ${referenceMonth.atDay(1).format(DateTimeFormatter.ofPattern("MMMM 'de' yyyy", ptBR)).replaceFirstChar { it.titlecase(ptBR) }}", style = MaterialTheme.typography.titleMedium)
        ownThisMonth.forEach { option ->
            ShiftOptionCard(option, keyOf(option) == offeredKey, !feedback.busy, false) {
                offeredKey = keyOf(option); requestedKey = ""; review = false
            }
        }
        if (ownThisMonth.isEmpty()) EmptyState("Nenhum turno disponível neste mês", "Escolha a troca diretamente por um dia da Escala.")
        Text("Turno que quero receber", style = MaterialTheme.typography.titleMedium)
        candidates.forEach { option ->
            ShiftOptionCard(option, keyOf(option) == requestedKey, !feedback.busy && offered != null, true) { requestedKey = keyOf(option); review = false }
        }
        if (offered == null) Text("Escolha primeiro um dos seus dias acima.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        if (offered != null && candidates.isEmpty()) Text("Não há outro turno elegível na mesma unidade e no mesmo dia.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
        NoteInput("Motivo (opcional)", reason, 500, "Explique a troca, se quiser", !feedback.busy) { reason = it }
        Text("A outra pessoa será notificada. O aceite autenticado fica registrado e apenas os ocupantes dos dois turnos são invertidos; a escala não é reescrita.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun AbsenceForm(vm: RequestsViewModel, onClose: () -> Unit, initialDate: String? = null) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val types = state.absenceOptions?.absenceTypes.orEmpty()
    var typeId by rememberSaveable { mutableStateOf(types.firstOrNull()?.id.orEmpty()) }
    val type = types.firstOrNull { it.id == typeId }
    var unit by rememberSaveable { mutableStateOf("day") }
    val today = initialDate ?: LocalDate.now().toString()
    var start by rememberSaveable { mutableStateOf(today) }
    var end by rememberSaveable { mutableStateOf(today) }
    var startTime by rememberSaveable { mutableStateOf("") }
    var endTime by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var files by remember { mutableStateOf<List<Document>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    val capture = rememberCaptureActions { document -> files = files + document }
    LaunchedEffect(types) { if (typeId.isBlank() && types.isNotEmpty()) typeId = types.first().id }
    LaunchedEffect(type?.units) { type?.units?.let { if (unit !in it) unit = it.first() } }
    val preview = state.preview
    val sent = state.sentAbsence
    fun period() = TimeRules.absencePeriod(type, unit, start, end, startTime, endTime)
    fun check(): Boolean = try { period(); TimeRules.absenceReason(reason); TimeRules.validateAbsenceFiles(files, type?.attachmentRequired == true); problem = null; true } catch (cause: IllegalArgumentException) { problem = cause.message; false }
    Page("Solicitar ausência", feedback.copy(error = problem ?: capture.error ?: feedback.error), onClose, footer = {
        when {
            sent != null -> Action("Concluir") { onClose() }
            preview != null -> FooterPair("Editar", !feedback.busy, { vm.editAbsence() }, "Enviar solicitação", !feedback.busy) { if (check()) vm.sendAbsence(period(), TimeRules.absenceReason(reason), files, type?.attachmentRequired == true) }
            else -> Action("Revisar solicitação", feedback.busy, enabled = type != null) { if (check()) vm.preview(::period) }
        }
    }) {
        if (sent != null) {
            CardBlock(selected = true) {
                Text("Solicitação enviada", style = MaterialTheme.typography.titleMedium)
                Text("Situação: ${TimeRules.ABSENCE_STATUS[sent.status] ?: sent.status}. Você acompanha em Solicitações.", color = Tokens.muted)
            }
            return@Page
        }
        if (preview != null) {
            CardBlock {
                Text("Resumo da solicitação", style = MaterialTheme.typography.titleMedium)
                SummaryLine("Tipo", preview.absenceType.name)
                SummaryLine("Período", (if (preview.period.startDate == preview.period.endDate) fullDate(preview.period.startDate) else "${fullDate(preview.period.startDate)} a ${fullDate(preview.period.endDate)}") +
                    (preview.period.startTime?.let { s -> preview.period.endTime?.let { " · $s–$it" } } ?: ""))
                SummaryLine("Quantidade", TimeRules.quantityText(preview.quantity.value, preview.quantity.unit))
                SummaryLine("Motivo", reason.trim().ifBlank { "Não informado" })
                SummaryLine("Anexos", if (files.isEmpty()) "Nenhum" else files.size.let { if (it == 1) "1 arquivo" else "$it arquivos" })
                preview.instructions?.takeIf { it.isNotBlank() }?.let { SummaryLine("Orientação do DP", it) }
            }
            TimeRules.tacitText(preview.tacitApprovalDays)?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
            return@Page
        }
        Choices("Tipo de ausência", types.map { it.id to it.name }, typeId, !feedback.busy) { typeId = it }
        if (type != null && type.units.size > 1) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PillChoice("Dias", unit == "day") { unit = "day" }
            PillChoice("Horas", unit == "hour") { unit = "hour" }
        }
        DateField("Início", start, !feedback.busy) { start = it; if (end < it) end = it }
        DateField("Fim", end, !feedback.busy) { end = it }
        if (unit == "hour") Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                LabeledTimeInput("Das", startTime, !feedback.busy, modifier = Modifier.weight(1f), showHint = false) { startTime = it }
                LabeledTimeInput("Até", endTime, !feedback.busy, modifier = Modifier.weight(1f), showHint = false) { endTime = it }
            }
            TimeInputHint()
        }
        NoteInput("Motivo (opcional)", reason, 1000, "Explique a ausência, se quiser (mínimo de 10 caracteres)", !feedback.busy) { reason = it }
        Text(if (type?.attachmentRequired == true) "Atestado ou documento (obrigatório)" else "Atestado ou documento (opcional)", style = MaterialTheme.typography.titleMedium)
        files.forEachIndexed { index, file ->
            Row(Modifier.fillMaxWidth().border(1.dp, Tokens.border, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (file.mimeType == "application/pdf") "PDF ${index + 1}" else "Foto ${index + 1}", modifier = Modifier.weight(1f))
                TextButton({ files = files.filterIndexed { position, _ -> position != index } }, enabled = !feedback.busy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Remover", color = Tokens.danger) }
            }
        }
        if (files.size < 5) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.weight(1f)) { Action("Fotografar", enabled = !feedback.busy, secondary = true, onClick = capture.photograph) }
            Box(Modifier.weight(1f)) { Action("Escolher arquivo", enabled = !feedback.busy, secondary = true, onClick = capture.pickFile) }
        }
    }
}

@Composable private fun VoucherForm(vm: RequestsViewModel, onClose: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var action by rememberSaveable { mutableStateOf("activate") }
    var details by rememberSaveable { mutableStateOf("") }
    var review by rememberSaveable { mutableStateOf(false) }
    val sent = state.sentVoucher
    Page("Vale-transporte", feedback, onClose, footer = {
        when {
            sent != null -> Action("Concluir") { onClose() }
            review -> FooterPair("Editar", !feedback.busy, { review = false }, "Enviar solicitação", !feedback.busy) { vm.requestVoucher(action, details) }
            else -> Action("Revisar solicitação", feedback.busy) { review = true }
        }
    }) {
        if (sent != null) {
            CardBlock(selected = true) {
                Text("Solicitação enviada", style = MaterialTheme.typography.titleMedium)
                Text(listOfNotNull("O DP analisa o pedido.", sent.effectiveDate?.let { "Se aprovado, vale a partir de ${fullDate(it)}." }, "Após o dia de corte, entra na competência seguinte.".takeIf { sent.requestedAfterCutoff }).joinToString(" "), color = Tokens.muted)
            }
            return@Page
        }
        if (review) {
            CardBlock {
                Text("Resumo da solicitação", style = MaterialTheme.typography.titleMedium)
                SummaryLine("Pedido", TimeRules.VOUCHER_ACTIONS.firstOrNull { it.first == action }?.second.orEmpty())
                SummaryLine("Detalhes", details.trim().ifBlank { "Não informado" })
            }
            Text("A data em que passa a valer é calculada pelo DP conforme o dia de corte da folha.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            return@Page
        }
        Choices("O que você precisa?", TimeRules.VOUCHER_ACTIONS, action, !feedback.busy) { action = it }
        NoteInput("Detalhes (opcional)", details, 1500, "Linhas, trajeto ou o que mudou", !feedback.busy) { details = it }
    }
}

/** Today's suggested purpose and whether it can be offered: only over punches read from the server, all classified. */
private fun daySuggestion(state: TimeState): Pair<String, Boolean> {
    val today = state.today.toString()
    val markings = state.markings.filter { it.workDate == today }
    val shift = state.shifts.firstOrNull { it.date == today }
    return TimeRules.suggestedPurpose(markings, shift) to
        (state.dayLoad == DayLoad.READ && markings.all { it.classification?.purpose != null })
}

/** Sends a punch: the one-time location read the unit asks for, then the record. Held by the screen, so it outlasts the confirmation. */
internal class PunchSubmitter(val capturing: State<Boolean>, val submit: (online: Boolean, purpose: String) -> Unit)

@Composable internal fun rememberPunchSubmitter(vm: TimeViewModel): PunchSubmitter {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val capturing = remember { mutableStateOf(false) }
    val waiting = rememberSaveable { mutableStateOf<String?>(null) }
    fun policy() = vm.state.value.let { state -> state.options?.executionUnits?.firstOrNull { it.id == state.unitId }?.locationPolicy } ?: LocationPolicy()
    fun captureAndRecord(purpose: String) {
        val policy = policy()
        capturing.value = true
        scope.launch {
            val attempt = capturePointLocation(context, policy.captureTimeoutMs ?: 10_000, policy.maxAccuracyMeters ?: 100.0)
            capturing.value = false
            vm.record(true, attempt, purpose)
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val purpose = waiting.value ?: return@rememberLauncherForActivityResult
        waiting.value = null
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true || result[Manifest.permission.ACCESS_COARSE_LOCATION] == true) captureAndRecord(purpose)
        else vm.record(true, failedLocationAttempt(status = "denied"), purpose)
    }
    return remember(vm) { PunchSubmitter(capturing) { online, purpose ->
        val state = vm.state.value
        val pending = vm.hasPendingAttempt()
        val preserving = !pending && (!online || TimeRules.canPreserve(state.options, state.unitId, state.offlineReady))
        when {
            preserving || pending || policy().mode == "disabled" || vm.hasPendingLocationAttempt() -> vm.record(online, declaredPurpose = purpose)
            hasPointLocationPermission(context) -> captureAndRecord(purpose)
            else -> { waiting.value = purpose; permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
        }
    } }
}

/** The confirmation of a punch: time, unit, what it represents and the one action. Same content on Ponto and on the home sheet. */
@Composable internal fun ColumnScope.PunchConfirmation(vm: TimeViewModel, state: TimeState, online: Boolean, busy: Boolean, submitter: PunchSubmitter,
    onCancel: () -> Unit, onSubmitted: () -> Unit) {
    val context = LocalContext.current
    val units = state.options?.executionUnits.orEmpty()
    val pilotMode = state.options?.mode == "pilot"
    val selectedUnit = units.firstOrNull { it.id == state.unitId }
    val unitName = selectedUnit?.name.orEmpty()
    val locationPolicy = selectedUnit?.locationPolicy ?: LocationPolicy()
    val pending = vm.pendingAttempt()
    val preserving = pending == null && (!online || TimeRules.canPreserve(state.options, state.unitId, state.offlineReady))
    val zone = TimeRules.unitZone(state.options, state.unitId)
    var officialNow by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)) }
    LaunchedEffect(state.clockOffset) {
        while (true) {
            officialNow = android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)
            delay(1000 - officialNow % 1000)
        }
    }
    val (suggestedPurpose, suggestionReliable) = daySuggestion(state)
    var declaredPurpose by rememberSaveable(state.today.toString(), state.markings.size, suggestionReliable) {
        mutableStateOf(if (suggestionReliable) suggestedPurpose else null)
    }
    val lockedPurpose = pending?.purpose
    if (pilotMode) Text("ENSAIO · SEM VALIDADE REP-P", color = Tokens.warning, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = .8.sp))
    val (heading, time, origin) = when {
        // A replay resends the first attempt: its time is shown as such, the server keeps the official one.
        pending != null -> Triple("REENVIAR A MESMA BATIDA",
            pending.firstTriedAt?.let { TimeRules.clockText(it, TimeRules.unitZone(state.options, pending.unitId)) } ?: "—",
            listOfNotNull(when (pending.firstTriedSource) {
                "OFFICIAL" -> "Primeira tentativa · Hora Legal"
                "LOCAL_PERMIT" -> "Primeira tentativa · hora ancorada, informativa"
                else -> "Primeira tentativa · hora do aparelho, informativa"
            }, units.firstOrNull { it.id == pending.unitId }?.name).joinToString(" · "))
        preserving -> Triple("HORÁRIO A PRESERVAR", TimeRules.clockText(officialNow, zone), listOf(unitName, "hora ancorada pela autorização local").filter { it.isNotBlank() }.joinToString(" · "))
        else -> Triple("HORÁRIO A REGISTRAR", TimeRules.clockText(officialNow, zone), unitName)
    }
    Text(heading, color = Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
    Text(time, style = MaterialTheme.typography.headlineLarge.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
    Text(origin, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
    if (lockedPurpose != null) {
        Text("O que este registro representa", style = MaterialTheme.typography.titleMedium)
        Column(Modifier.fillMaxWidth().background(Tokens.accentSoft, RoundedCornerShape(14.dp)).border(2.dp, Tokens.accent, RoundedCornerShape(14.dp)).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(TimeRules.purposeLabel(lockedPurpose), style = MaterialTheme.typography.titleMedium)
            Text("Definida na tentativa original; não pode ser trocada no reenvio.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        }
    } else {
        Text("O que este registro representa?", style = MaterialTheme.typography.titleMedium)
        TimeRules.PUNCH_PURPOSES.forEach { (id, label) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = !busy, role = Role.RadioButton) { declaredPurpose = id }, verticalAlignment = Alignment.CenterVertically) {
                RadioButton(declaredPurpose == id, null, enabled = !busy); Text(label)
                if (suggestionReliable && id == suggestedPurpose) Text(" · sugerida", color = Tokens.wine, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    if (pending != null) Text("O servidor não confirmou a tentativa anterior. O Coala Go reenvia exatamente a mesma batida; se ela já tiver sido gravada, nada é duplicado. Esta hora é apenas informativa: o comprovante terá a hora gravada pelo servidor.",
        color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    else if (preserving) Text(when {
        pilotMode && online -> "A Hora Legal não pôde ser confirmada agora. Este ensaio fica preservado neste aparelho e será sincronizado depois, mas continua fora do fechamento oficial e sem comprovante REP-P."
        pilotMode -> "Sem conexão. Este ensaio fica preservado neste aparelho e será sincronizado depois, mas continua fora do fechamento oficial e sem comprovante REP-P."
        online -> "A Hora Legal não pôde ser confirmada agora. A marcação ficará preservada neste aparelho até o servidor validá-la."
        else -> "A marcação ficará preservada neste aparelho até a conexão voltar."
    }, color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    val purpose = lockedPurpose ?: declaredPurpose
    FooterPair("Voltar", !busy, onCancel, when {
        pending != null -> "Reenviar batida"
        preserving && pilotMode -> "Preservar ensaio no aparelho"
        preserving -> "Preservar no aparelho"
        else -> "Confirmar ponto"
    }, !busy && purpose != null) {
        onSubmitted()
        purpose?.let { submitter.submit(online, it) }
    }
}

/** The scheduled unit is outside the employment scope: said plainly, and the unit picker is offered. */
@Composable private fun ScheduledUnitNotice(options: TimeOptions?, shift: OwnShift?, unitId: String?) {
    if (!TimeRules.scheduledUnitOutside(options, shift)) return
    val target = options?.executionUnits?.firstOrNull { it.id == unitId }?.name ?: "outra unidade"
    // The destination is always named; a choice is only promised when there is one.
    Text("Sua escala de hoje é em ${shift?.unitName ?: "outra unidade"}, que não está entre as unidades do seu vínculo. " +
        (if (TimeRules.unitPickable(options, shift)) "A batida será registrada em $target; troque a unidade se não for a certa. "
        else "A batida será registrada em $target, a única unidade do seu vínculo. ") + "Se a escala estiver certa, fale com o DP.",
        color = Tokens.warning, style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
}

@Composable private fun PunchPreservedCard(local: CapturedOfflineMarking, pilot: Boolean, onOk: () -> Unit) {
    CardBlock(selected = true) {
        Text("Marcação preservada no aparelho · ${TimeRules.secondsOf(local.markedAt)}", style = MaterialTheme.typography.titleMedium)
        Text(if (pilot) "Aguardando sincronização do ensaio. Ainda não há sequência nem comprovante do ensaio; nada será enviado ao registro fiscal oficial."
            else "Aguardando confirmação do servidor. Ainda não há NSR nem comprovante oficial.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
        Action("Ok", secondary = true, onClick = onOk)
    }
}

@Composable private fun PunchRecordedCard(last: MarkingResponse, unitName: String, onReceipt: (Pair<DayPunch, String>) -> Unit, onOk: () -> Unit) {
    CardBlock(selected = true) {
        Text("${if (last.pilot) "Ensaio registrado" else "Ponto registrado"} · ${TimeRules.secondsOf(last.marking.markedAt)}", style = MaterialTheme.typography.titleMedium)
        Text("${if (last.pilot) "Sequência do ensaio" else "Registro oficial"} ${last.marking.nsr} · $unitName${if (last.status == "replayed") " · a batida já estava gravada" else ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        if (last.pilot) Text("Teste sem validade como REP-P e fora do fechamento oficial.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
        last.location?.let { location -> Text(when (location.evaluation) {
            "inside" -> "Localização compatível com a unidade."
            "outside" -> "Localização indicada fora da área da unidade; o ponto foi registrado normalmente."
            "indeterminate" -> "Não foi possível confirmar a localização; o ponto foi registrado normalmente."
            else -> "Localização não solicitada para esta unidade."
        }, color = if (location.evaluation == "inside") Tokens.info else Tokens.muted,
            style = MaterialTheme.typography.bodySmall) }
        if (last.receiptStatus == "available") Action("Abrir comprovante") { onReceipt(DayPunch(TimeRules.minuteOf(last.marking.markedAt), last.marking.nsr, last.receiptId, "available", pilot = last.pilot) to last.marking.markedAt) }
        else Text("Comprovante em emissão. Ele aparece em Ponto assim que for emitido.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
        Action("Ok", secondary = true, onClick = onOk)
    }
}

/**
 * The punch from the home itself: the same confirmation as Ponto, over today's punches read again on opening.
 * Shares Ponto's view model, so a pending attempt is resent from either place and never duplicated.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PunchSheet(vm: TimeViewModel, onOpenTime: () -> Unit, onDismiss: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val context = LocalContext.current
    val online = rememberOnline()
    val submitter = rememberPunchSubmitter(vm)
    var submitted by rememberSaveable { mutableStateOf(false) }
    var receipt by remember { mutableStateOf<Pair<DayPunch, String>?>(null) }
    var choosingUnit by remember { mutableStateOf(false) }
    var started by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.dismissLast(); vm.dismissOffline(); vm.load(); started = true }
    DisposableEffect(Unit) { onDispose { File(context.cacheDir, "receipts").deleteRecursively() } }
    receipt?.let { (punch, markedAt) -> ReceiptSheet(punch, markedAt, vm) { receipt = null } }
    val busy = feedback.busy || submitter.capturing.value
    val units = state.options?.executionUnits.orEmpty()
    val today = state.today.toString()
    val todayShift = state.shifts.firstOrNull { it.date == today }
    if (choosingUnit) PickerSheet("Unidade da batida", units.map { it.id to it.name }, state.unitId.orEmpty(), { vm.unit(it) }) { choosingUnit = false }
    fun close() { vm.dismissLast(); vm.dismissOffline(); onDismiss() }
    ModalBottomSheet(onDismissRequest = { if (!busy) close() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Tokens.surface) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val last = state.last
            val local = state.lastOffline
            val pending = vm.hasPendingAttempt()
            // Same gate as the Ponto button: a pending attempt is only resent on-line, never replaced by a new one.
            val canPunch = if (pending) online else TimeRules.canRecord(state.options, state.unitId)
                || TimeRules.canPreserve(state.options, state.unitId, state.offlineReady)
            val loading = !started || state.dayLoad == DayLoad.PENDING
            when {
                submitted && last != null -> PunchRecordedCard(last, units.firstOrNull { it.id == last.marking.executionUnitId }?.name.orEmpty(), { receipt = it }) { close() }
                submitted && local != null -> PunchPreservedCard(local, state.options?.mode == "pilot") { close() }
                submitted && busy || loading ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 120.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
                        CircularProgressIndicator(Modifier.size(24.dp), color = Tokens.accent, strokeWidth = 3.dp)
                        Text(if (submitted) "Registrando a batida…" else "Conferindo as batidas de hoje…", color = Tokens.muted)
                    }
                !canPunch -> {
                    Text("Registro de ponto", style = MaterialTheme.typography.titleLarge)
                    Text((if (pending) "Há uma batida anterior aguardando confirmação. Conecte-se para reenviá-la sem duplicar." else null)
                        ?: TimeRules.blockedReason(state.options, state.offlineReady) ?: "Não foi possível preparar a batida agora.",
                        color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                    Action("Abrir Ponto") { close(); onOpenTime() }
                }
                else -> {
                    ScheduledUnitNotice(state.options, todayShift, state.unitId)
                    if (TimeRules.unitPickable(state.options, todayShift) && !pending)
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable(enabled = !busy, role = Role.Button, onClickLabel = "Trocar unidade") { choosingUnit = true },
                            verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Unidade da batida", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                                Text(units.firstOrNull { it.id == state.unitId }?.name ?: "Escolha a unidade", style = MaterialTheme.typography.titleMedium)
                            }
                            Text("Trocar", color = Tokens.wine, style = MaterialTheme.typography.labelLarge)
                        }
                    PunchConfirmation(vm, state, online, busy, submitter, onCancel = { close() }, onSubmitted = { submitted = true })
                }
            }
            feedback.error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
        }
    }
}
