package com.coalaone.go.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import com.coalaone.go.domain.DayPunch
import com.coalaone.go.domain.TimeRules
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
@Composable private fun PunchList(punches: List<DayPunch>, enabled: Boolean, units: List<ExecutionUnit> = emptyList(), onReceipt: (DayPunch) -> Unit) {
    var position = 0
    punches.forEach { punch ->
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
            }
            when {
                punch.receiptId == null -> Unit
                punch.receiptStatus == "available" -> StatusChip("Comprovante", Tokens.info, Tokens.infoBg)
                else -> StatusChip("Pendente", Tokens.warning, Tokens.warningBg)
            }
        }
    }
}

/** Digital clock with seconds (Portaria 671, Anexo IX), from the official reading plus the phone's elapsed time. */
@Composable private fun OfficialClockCard(state: TimeState) {
    val clock = state.options?.officialClock
    val zone = TimeRules.unitZone(state.options, state.unitId)
    // Monotonic clock plus the official offset: changing the phone's hour does not move the time shown.
    var official by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)) }
    LaunchedEffect(state.clockOffset) { while (true) { official = android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0); delay(1000 - official % 1000) } }
    Column(Modifier.fillMaxWidth().background(Tokens.dark, RoundedCornerShape(20.dp)).padding(horizontal = 18.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("HORA LEGAL BRASILEIRA", color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp), modifier = Modifier.weight(1f))
            if (clock?.available == true && state.clockOffset != null) Text(TimeRules.utcOffsetLabel(zone, official), color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
        }
        if (clock?.available == true && state.clockOffset != null) {
            Text(TimeRules.clockText(official, zone), color = Tokens.onDark, style = MaterialTheme.typography.displaySmall.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
            val unitName = state.options?.executionUnits?.firstOrNull { it.id == state.unitId }?.name
            unitName?.let { Text(it, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall) }
        } else Text(if (state.options == null) "Carregando…" else "Indisponível", color = Tokens.onDark2, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable fun TimeScreen(vm: TimeViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val context = LocalContext.current
    val online = rememberOnline()
    DisposableEffect(Unit) {
        onDispose { listOf("receipts", "time-documents").forEach { File(context.cacheDir, it).deleteRecursively() } }
    }
    LaunchedEffect(Unit) { vm.load() }
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
    var section by rememberSaveable { mutableStateOf("today") }
    var confirming by rememberSaveable { mutableStateOf(false) }
    var capturingLocation by remember { mutableStateOf(false) }
    var asking by rememberSaveable { mutableStateOf<String?>(null) }
    var receipt by remember { mutableStateOf<Pair<DayPunch, String>?>(null) }
    var selectedMirror by remember { mutableStateOf(false) }
    var selectedReceiptArchive by remember { mutableStateOf(false) }
    var detailDate by rememberSaveable { mutableStateOf<String?>(null) }
    var detailSource by rememberSaveable { mutableStateOf("records") }
    asking?.let { date -> AdjustmentScreen(vm, date) { asking = null; vm.clearAdjustment() }; return }
    val units = state.options?.executionUnits.orEmpty()
    val pilotMode = state.options?.mode == "pilot"
    val today = state.today.toString()
    val todayShift = state.shifts.firstOrNull { it.date == today }
    val todayMarkings = state.markings.filter { it.workDate == today }
    val suggestedPurpose = TimeRules.suggestedPurpose(todayMarkings, todayShift)
    val suggestionReliable = todayMarkings.isEmpty() || todayMarkings.all { it.classification?.purpose != null }
    var declaredPurpose by rememberSaveable(today, state.markings.size, suggestionReliable) {
        mutableStateOf(if (suggestionReliable) suggestedPurpose else null)
    }
    val todayPunches = TimeRules.day(today, state.markings, state.treatments)
    val selectedUnit = units.firstOrNull { it.id == state.unitId }
    val unitName = selectedUnit?.name.orEmpty()
    val locationPolicy = selectedUnit?.locationPolicy ?: LocationPolicy()
    val screenBusy = feedback.busy || capturingLocation
    val zone = TimeRules.unitZone(state.options, state.unitId)
    var confirmationNow by remember { mutableLongStateOf(android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)) }
    LaunchedEffect(state.clockOffset, confirming) {
        while (confirming) {
            confirmationNow = android.os.SystemClock.elapsedRealtime() + (state.clockOffset ?: 0)
            delay(1000 - confirmationNow % 1000)
        }
    }
    val confirmationTime = TimeRules.clockText(confirmationNow, zone)
    val scope = rememberCoroutineScope()
    fun captureAndRecord() {
        val purpose = declaredPurpose ?: return
        capturingLocation = true
        scope.launch {
            val attempt = capturePointLocation(context, locationPolicy.captureTimeoutMs ?: 10_000,
                locationPolicy.maxAccuracyMeters ?: 100.0)
            capturingLocation = false
            vm.record(true, attempt, purpose)
        }
    }
    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true || result[Manifest.permission.ACCESS_COARSE_LOCATION] == true) captureAndRecord()
        else declaredPurpose?.let { vm.record(true, failedLocationAttempt(status = "denied"), it) }
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
            "bank" -> if (state.bankDate != (if (state.month == java.time.YearMonth.from(state.today)) state.today else state.month.atEndOfMonth()).toString()) vm.loadBank()
            "day" -> detailDate?.let { if (state.bankDate != it) vm.loadBank(it) }
            "mirror" -> if (state.mirrorYear != state.month.year) vm.loadMirrorYear(state.month.year)
        }
    }
    // One main action: the punch, confirmed in the footer itself; the history has no footer.
    val footer: (@Composable ColumnScope.() -> Unit)? = if (section != "today") null else { {
        if (confirming) {
            Text("HORÁRIO A REGISTRAR", color = Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
            Text(confirmationTime, style = MaterialTheme.typography.headlineLarge.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
            Text(unitName, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            Text("O que este registro representa?", style = MaterialTheme.typography.titleMedium)
            TimeRules.PUNCH_PURPOSES.forEach { (id, label) ->
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(enabled = !screenBusy, role = Role.RadioButton) { declaredPurpose = id }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(declaredPurpose == id, null, enabled = !screenBusy); Text(label)
                    if (suggestionReliable && id == suggestedPurpose) Text(" · sugerida", color = Tokens.wine, style = MaterialTheme.typography.bodySmall)
                }
            }
            if (!online) Text("A marcação ficará preservada neste aparelho até a internet voltar.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            if (online && locationPolicy.mode != "disabled") {
                Text("Ao confirmar, o Coala Go fará uma leitura pontual de localização apenas para esta batida. O ponto será registrado mesmo se a posição estiver indisponível, imprecisa ou fora da unidade.",
                    color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                locationPolicy.privacyNoticeUrl?.let { url ->
                    TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
                        enabled = !screenBusy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Aviso de privacidade", color = Tokens.wine) }
                }
            }
            FooterPair("Voltar", !screenBusy, { confirming = false }, if (online) "Confirmar ponto" else "Preservar no aparelho",
                !screenBusy && declaredPurpose != null && (!pilotMode || online)) {
                confirming = false
                when {
                    !online || locationPolicy.mode == "disabled" || vm.hasPendingLocationAttempt() -> declaredPurpose?.let { vm.record(online, declaredPurpose = it) }
                    hasPointLocationPermission(context) -> captureAndRecord()
                    else -> locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }
        } else {
            if (!online && pilotMode) Text("O ensaio pré-homologação exige internet; nenhuma batida será simulada ou guardada como oficial.",
                color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            Action(when { online -> "Registrar ponto"; pilotMode -> "Conecte-se para registrar"; else -> "Registrar ponto offline" }, screenBusy,
                enabled = TimeRules.canRecord(state.options, state.unitId) && (!pilotMode || online)) { confirming = true }
        }
    } }
    val screenTitle = when (section) { "records" -> "Registros"; "adjustments" -> "Histórico de ajustes"; "bank" -> "Banco de horas"; "mirror" -> "Espelhos mensais"; "day" -> "Detalhe do dia"; else -> "Registro de ponto" }
    val leave: () -> Unit = { when (section) { "today" -> onBack(); "day" -> section = detailSource; else -> section = "today" } }
    fun openDay(date: String, source: String) { detailDate = date; detailSource = source; section = "day"; confirming = false }
    Page(screenTitle, feedback, leave, footer = footer, onRefresh = {
        when (section) { "today" -> vm.load(); "records", "adjustments" -> vm.month(state.month); "bank" -> vm.loadBank(); "day" -> detailDate?.let(vm::loadBank); "mirror" -> vm.loadMirrorYear(state.month.year) }
    }, header = {
        TopBar(screenTitle, busy = screenBusy, onBack = leave)
        // A escala escolhe a unidade automaticamente; só há escolha manual quando o dia não tem unidade escalada.
        if (section == "today" && (todayShift?.unitId == null || todayShift?.executionUnitPolicy == "free") && units.size > 1) UnitPickerHeader(units.map { it.id to it.name }, state.unitId.orEmpty(), screenBusy || confirming) { vm.unit(it) }
    }) {
        if (section == "today") {
            OfficialClockCard(state)
            if (todayShift?.executionUnitPolicy == "free" && todayShift.locationTrackingPolicy == "workday") {
                CardBlock {
                    Text("Entre unidades", style = MaterialTheme.typography.titleMedium)
                    when {
                        state.options?.journeyLocationEnabled != true -> Text("Acompanhamento durante a jornada preparado, mas ainda não liberado. A ativação depende da decisão formal de privacidade e do piloto.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                        locationPolicy.mode != "observe" -> Text("Acompanhamento durante a jornada configurado no turno, aguardando a política central desta unidade.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                        !hasPointLocationPermission(context) -> {
                            Text("Se você permitir, a localização será registrada periodicamente durante a jornada entre unidades, pausada no intervalo e encerrada no fim. Isso não bloqueia o ponto.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                            Action("Permitir localização", secondary = true) { journeyLocationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
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
            TimeRules.breakIssue(todayMarkings, todayShift)?.let { issue ->
                Text(issue, color = Tokens.warning, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
            }
            TimeRules.blockedReason(state.options)?.let { reason ->
                Column(Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(reason, color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold))
                    if (state.options?.officialClock?.available != true) TextButton({ vm.refreshClock() }, enabled = !feedback.busy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Tentar de novo", color = Tokens.wine) }
                }
            }
            state.offlineIssue?.let { issue -> Text("O registro online continua disponível, mas a contingência offline não pôde ser renovada: $issue",
                color = Tokens.warning, style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp)) }
            if (state.offlineRows.isNotEmpty()) {
                val blocked = state.offlineRows.count { it.state == "BLOCKED" }
                Text(if (blocked == 0) "${state.offlineRows.size} ${if (state.offlineRows.size == 1) "marcação preservada aguarda" else "marcações preservadas aguardam"} sincronização."
                    else "$blocked ${if (blocked == 1) "marcação precisa" else "marcações precisam"} de conferência do DP; nada foi apagado.",
                    color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
            }
            state.lastOffline?.let { local ->
                CardBlock(selected = true) {
                    Text("Marcação preservada no aparelho · ${TimeRules.secondsOf(local.markedAt)}", style = MaterialTheme.typography.titleMedium)
                    Text("Aguardando internet. Ainda não há NSR nem comprovante oficial.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                    Action("Ok", secondary = true) { vm.dismissOffline() }
                }
            }
            state.last?.let { last ->
                CardBlock(selected = true) {
                    Text("${if (last.pilot) "Ensaio registrado" else "Ponto registrado"} · ${TimeRules.secondsOf(last.marking.markedAt)}", style = MaterialTheme.typography.titleMedium)
                    Text("${if (last.pilot) "Sequência do ensaio" else "Registro oficial"} ${last.marking.nsr} · ${units.firstOrNull { it.id == last.marking.executionUnitId }?.name ?: unitName}${if (last.status == "replayed") " · a batida já estava gravada" else ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    if (last.pilot) Text("Teste sem validade como REP-P e fora do fechamento oficial.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                    last.location?.let { location -> Text(when (location.evaluation) {
                        "inside" -> "Localização compatível com a unidade."
                        "outside" -> "Localização indicada fora da área da unidade; o ponto foi registrado normalmente."
                        "indeterminate" -> "Não foi possível confirmar a localização; o ponto foi registrado normalmente."
                        else -> "Localização não solicitada para esta unidade."
                    }, color = if (location.evaluation == "inside") Tokens.info else Tokens.muted,
                        style = MaterialTheme.typography.bodySmall) }
                    if (last.receiptStatus == "available") Action("Abrir comprovante") { receipt = DayPunch(TimeRules.minuteOf(last.marking.markedAt), last.marking.nsr, last.receiptId, "available", pilot = last.pilot) to last.marking.markedAt }
                    else Text("Comprovante em emissão. Puxe a tela para baixo para atualizar a lista.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                    Action("Ok", secondary = true) { vm.dismissLast() }
                }
            }
            CardBlock {
                Text(dayTitle(state.today), style = MaterialTheme.typography.titleMedium)
                Text(TimeRules.shiftText(todayShift) ?: "Sem turno na escala de hoje", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                TimeRules.breakText(todayShift)?.let { Text(it, color = Tokens.info, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold)) }
                HorizontalDivider(color = Tokens.border)
                if (todayPunches.isEmpty()) Text("Nenhuma batida hoje.", color = Tokens.muted)
                PunchList(todayPunches, !feedback.busy, units) { receipt = it to markedAtOf(it) }
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
            onReceipt = { receipt = it to markedAtOf(it) }, onAdjust = { asking = it }, onDay = { openDay(it, "records") }, onArchive = { selectedReceiptArchive = true })
        else if (section == "adjustments") AdjustmentHistoryTab(state, feedback.busy, vm) { openDay(it, "adjustments") }
        else if (section == "bank") BankTab(state, feedback.busy, vm) { openDay(it, "bank") }
        else if (section == "day" && detailDate != null) DayDetail(state, detailDate!!, feedback.busy,
            onReceipt = { receipt = it to markedAtOf(it) }, onAdjust = { asking = it }, focus = detailSource)
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

@Composable private fun BankTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onDay: (String) -> Unit) {
    AuxiliaryMonthPicker(state, busy, vm)
    val response = state.bank
    val statement = response?.statement
    when {
        response == null && !busy -> EmptyState("Banco ainda não carregado", "Puxe a tela para baixo para tentar novamente.")
        response?.policy == null -> EmptyState("Sem política de banco de horas", "O DP ainda não vinculou uma política vigente para este período.")
        statement == null -> EmptyState("Extrato indisponível", "Não há apuração disponível para este período.")
        else -> {
            CardBlock(selected = true) {
                val balanceStatus = when {
                    response.previewCompetences.isNotEmpty() -> "provisório"
                    statement.missing.isNotEmpty() || statement.settlementOutdated -> "pendente de reapuração"
                    else -> "fechado"
                }
                Text("Saldo $balanceStatus", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                Text(TimeRules.durationText(statement.balanceMinutes, true), style = MaterialTheme.typography.headlineLarge,
                    color = if (statement.balanceMinutes < 0) Tokens.warning else Tokens.ink)
                statement.cycle?.let { Text("Ciclo ${fullDate(it.start)} a ${fullDate(it.end)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                Text("Créditos ${TimeRules.durationText(statement.credit)} · débitos ${TimeRules.durationText(statement.debit)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            if (response.previewCompetences.isNotEmpty()) Text("Prévia: o mês aberto pode mudar até o fechamento.", color = Tokens.warning,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(12.dp))
            if (statement.missing.isNotEmpty()) Text("Falta apurar: ${statement.missing.joinToString()}", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            if (statement.nightMinutes > 0) Text("${TimeRules.durationText(statement.nightMinutes)} em período noturno. Hora reduzida e adicional seguem para conferência da folha.",
                color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            if (statement.lines.isEmpty()) EmptyState("Nenhum lançamento neste ciclo")
            statement.lines.asReversed().take(100).forEach { item ->
                var open by rememberSaveable(item.date, item.line.nature, item.line.minutes) { mutableStateOf(false) }
                CardBlock {
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClickLabel = if (open) "Ocultar detalhes" else "Mostrar detalhes") { open = !open },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(TimeRules.bankNatureText(item.line.nature), style = MaterialTheme.typography.titleMedium)
                            Text(fullDate(item.date), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                        }
                        val signedMinutes = when (item.line.nature) { "bank_credit" -> item.line.minutes; "bank_debit" -> -item.line.minutes; else -> 0 }
                        Text(if (signedMinutes == 0) TimeRules.durationText(item.line.minutes) else TimeRules.durationText(signedMinutes, true),
                            color = if (item.line.nature == "bank_debit") Tokens.warning else Tokens.ink, style = MaterialTheme.typography.titleMedium)
                        DropdownChevron(open, Tokens.muted)
                    }
                    if (open) {
                        HorizontalDivider(color = Tokens.border)
                        SummaryLine("Motivo", TimeRules.bankReasonText(item.line.reason))
                        SummaryLine("Competência", item.competence)
                        SummaryLine("Apuração", if (item.closureVersion > 0) "Fechamento versão ${item.closureVersion}" else "Prévia do mês em aberto")
                        Action("Ver dia", secondary = true, enabled = !busy) { onDay(item.date) }
                    }
                }
            }
            if (statement.lines.size > 100) Text("Mostrando os 100 lançamentos mais recentes do ciclo.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable private fun MirrorYearTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onMirror: (String) -> Unit) {
    val year = state.month.year
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
                val label = when {
                    status == null && busy -> "Carregando"
                    closed && status?.mirror != null -> "Disponível"
                    closed -> "Fechado"
                    status?.closure != null -> "Reaberto"
                    month == current -> "Em aberto"
                    else -> "Sem fechamento"
                }
                Card(onClick = { onMirror(month.toString()) }, enabled = closed && !busy, modifier = Modifier.weight(1f).fillMaxHeight(),
                    shape = RoundedCornerShape(16.dp), border = androidx.compose.foundation.BorderStroke(1.dp, if (closed) Tokens.border else Tokens.fieldBorder),
                    colors = CardDefaults.cardColors(containerColor = if (closed) Tokens.surface else Tokens.soft,
                        disabledContainerColor = Tokens.soft, disabledContentColor = Tokens.muted)) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 13.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(month.atDay(1).format(DateTimeFormatter.ofPattern("MMM", ptBR)).replaceFirstChar { it.titlecase(ptBR) }, style = MaterialTheme.typography.titleMedium)
                        Text(label, color = if (closed) Tokens.okInk else Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
                        status?.closure?.takeIf { closed }?.let { Text("Versão ${it.version}", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp)) }
                    }
                }
            }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

@Composable private fun RecordsTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onReceipt: (DayPunch) -> Unit,
    onAdjust: (String) -> Unit, onDay: (String) -> Unit, onArchive: () -> Unit) {
    val first = state.month.atDay(1)
    val officialMarkings = state.markings.filterNot { it.pilot }
    val hasPilotMarkings = state.markings.any { it.pilot }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        NavSquare("‹", "Mês anterior", !busy) { vm.month(state.month.minusMonths(1)) }
        Text(first.format(DateTimeFormatter.ofPattern("MMMM 'de' yyyy", ptBR)).replaceFirstChar { it.titlecase(ptBR) }, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        NavSquare("›", "Próximo mês", !busy && state.month.isBefore(java.time.YearMonth.from(state.today))) { vm.month(state.month.plusMonths(1)) }
    }
    if (state.truncated) Text("O mês tem mais registros do que esta lista mostra; o espelho completo fica no Coala One.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    Action("Exportar comprovantes oficiais do mês", secondary = true,
        enabled = !busy && !state.truncated && officialMarkings.isNotEmpty(), onClick = onArchive)
    if (hasPilotMarkings) Text("Os comprovantes do ensaio ficam fora do pacote oficial. Abra cada batida para salvar ou compartilhar o comprovante identificado como ensaio.",
        color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    val last = if (state.month == java.time.YearMonth.from(state.today)) state.today else state.month.atEndOfMonth()
    val days = generateSequence(last) { it.minusDays(1) }.takeWhile { !it.isBefore(first) }.toList()
        .filter { date -> state.markings.any { it.workDate == date.toString() } || state.shifts.any { it.date == date.toString() } || state.treatments.any { it.workDate == date.toString() } }
    if (days.isEmpty()) EmptyState("Nenhuma batida neste mês")
    days.forEach { date ->
        val key = date.toString()
        val shift = state.shifts.firstOrNull { it.date == key }
        val punches = TimeRules.day(key, state.markings, state.treatments)
        var open by rememberSaveable(key) { mutableStateOf(false) }
        CardBlock {
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClickLabel = if (open) "Recolher dia" else "Abrir dia") { open = !open }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(dayTitle(date), style = MaterialTheme.typography.titleMedium)
                    Text(punches.filter { !it.discarded }.joinToString(" · ") { it.time }.ifBlank { TimeRules.shiftText(shift) ?: "Sem batidas" }, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                }
                if (state.adjustments.any { it.workDate == key && it.status == "in_review" }) StatusChip("Ajuste em análise", Tokens.warning, Tokens.warningBg)
                DropdownChevron(open, Tokens.muted)
            }
            if (open) {
                TimeRules.shiftText(shift)?.let { Text("Escala: $it", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                PunchList(punches, !busy, state.options?.executionUnits.orEmpty(), onReceipt)
                Action("Detalhar dia", enabled = !busy) { onDay(key) }
                if (state.markings.any { it.workDate == key && it.pilot }) Text("Ajuste formal indisponível para batidas de ensaio.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                else Action("Pedir ajuste deste dia", secondary = true, enabled = !busy) { onAdjust(key) }
            }
        }
    }
}

@Composable private fun AdjustmentHistoryTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onDay: (String) -> Unit) {
    AuxiliaryMonthPicker(state, busy, vm)
    if (state.adjustments.isEmpty() && !busy) EmptyState("Nenhum ajuste neste mês", "Os pedidos enviados aparecem aqui com a decisão do gestor ou do DP.")
    state.adjustments.groupBy { it.workDate }.toSortedMap(reverseOrder()).forEach { (workDate, rows) ->
        var open by rememberSaveable(workDate) { mutableStateOf(false) }
        CardBlock {
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button) { open = !open }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(fullDate(workDate), style = MaterialTheme.typography.titleMedium)
                    Text("${rows.size} ${if (rows.size == 1) "solicitação" else "solicitações"}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                }
                val summary = rows.groupingBy { it.status }.eachCount().entries.joinToString(" · ") { (status, count) -> "$count ${TimeRules.ADJUSTMENT_STATUS[status]?.substringBefore(" ·")?.lowercase() ?: status}" }
                Text(summary, color = if (rows.any { it.status == "in_review" }) Tokens.warning else Tokens.okInk, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold))
                DropdownChevron(open, Tokens.muted)
            }
            if (open) {
                rows.sortedByDescending { it.createdAt }.forEachIndexed { index, adjustment ->
                    if (index > 0) HorizontalDivider(color = Tokens.border)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == adjustment.kind }?.second ?: adjustment.kind, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        StatusChip(TimeRules.ADJUSTMENT_STATUS[adjustment.status] ?: adjustment.status,
                            if (adjustment.status == "approved") Tokens.okInk else if (adjustment.status == "in_review") Tokens.warning else Tokens.muted,
                            if (adjustment.status == "approved") Tokens.okBg else if (adjustment.status == "in_review") Tokens.warningBg else Tokens.soft)
                    }
                    val operations = adjustment.operations.ifEmpty { listOf(AdjustmentOperation(adjustment.kind, adjustment.target, adjustment.inclusion)) }
                    val originals = operations.mapNotNull { it.target }.joinToString("; ") { "${TimeRules.minuteOf(it.markedAt)} · registro oficial ${it.nsr}" }
                    val inclusions = operations.mapNotNull { it.inclusion }.joinToString(" · ") { TimeRules.minuteOf(it.markedAt) }
                    if (originals.isNotBlank()) Text("Batidas originais: $originals", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    if (inclusions.isNotBlank()) Text("Horários informados: $inclusions", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    Text(adjustment.reason, style = MaterialTheme.typography.bodySmall)
                    Text("${adjustment.acts.size} ${if (adjustment.acts.size == 1) "ato registrado" else "atos registrados"} na trilha.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
                }
                Action("Ver dia", secondary = true, enabled = !busy) { onDay(workDate) }
            }
        }
    }
}

@Composable private fun DayDetail(state: TimeState, workDate: String, busy: Boolean, onReceipt: (DayPunch) -> Unit,
    onAdjust: (String) -> Unit, focus: String) {
    val date = runCatching { LocalDate.parse(workDate) }.getOrNull() ?: return
    val shift = state.shifts.firstOrNull { it.date == workDate }
    val punches = TimeRules.day(workDate, state.markings, state.treatments)
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
        SummaryLine("Escala", TimeRules.shiftText(shift) ?: "Sem turno informado")
        SummaryLine("Local de trabalho", if (shift?.executionUnitPolicy == "free") "Entre unidades" else shift?.unitName ?: "Unidade não informada")
        SummaryLine("Intervalo", "${TimeRules.durationText(breakMinutes)} realizado" + (TimeRules.plannedBreakMinutes(shift).takeIf { it > 0 }?.let { " de ${TimeRules.durationText(it)} previsto" } ?: ""))
        HorizontalDivider(color = Tokens.border)
        if (punches.isEmpty()) Text("Nenhuma batida registrada.", color = Tokens.muted) else PunchList(punches, !busy, state.options?.executionUnits.orEmpty(), onReceipt)
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
                StatusChip(TimeRules.ADJUSTMENT_STATUS[adjustment.status] ?: adjustment.status,
                    if (adjustment.status == "approved") Tokens.okInk else if (adjustment.status == "in_review") Tokens.warning else Tokens.muted,
                    if (adjustment.status == "approved") Tokens.okBg else if (adjustment.status == "in_review") Tokens.warningBg else Tokens.soft)
            }
        }
    }
    if (pilotDay) Text("Ajuste formal indisponível para batidas de ensaio.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
    else Action("Pedir ajuste deste dia", secondary = true, enabled = !busy) { onAdjust(workDate) }
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
    val kindLabel = TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == kind }?.second.orEmpty()
    fun operations() = when (kind) {
        "include" -> includedTimes.filter { it.isNotBlank() }.map { AdjustmentRequestOperation("include", newTime = it, executionUnitId = state.unitId) }
        "discard" -> selectedTargets.map { AdjustmentRequestOperation("discard", targetReceiptId = it) }
        else -> selectedTargets.map { AdjustmentRequestOperation("correct", targetReceiptId = it, newTime = correctedTimes[it].orEmpty(), executionUnitId = state.unitId) }
    }
    fun check(): Boolean = try { TimeRules.adjustmentRequest(attemptId, date, operations(), reason, state.today); problem = null; true } catch (cause: IllegalArgumentException) { problem = cause.message; false }
    Page("Pedir ajuste", feedback.copy(error = problem ?: feedback.error), onClose, footer = {
        when {
            sent != null -> Action("Concluir") { onClose() }
            review -> FooterPair("Editar", !feedback.busy, { review = false }, "Enviar pedido", !feedback.busy) { vm.requestAdjustment(attemptId, date, operations(), reason) }
            else -> Action("Revisar pedido", feedback.busy) { if (check()) review = true }
        }
    }) {
        if (sent != null) {
            CardBlock(selected = true) {
                Text("Pedido enviado", style = MaterialTheme.typography.titleMedium)
                Text("O DP analisa e decide. Você acompanha a situação no Histórico do dia ${fullDate(sent.workDate)}.", color = Tokens.muted)
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
                if (kind != "include") SummaryLine("Batidas escolhidas", selectedTargets.mapNotNull { id -> choices.firstOrNull { it.receiptId == id }?.let { "${it.time} · registro oficial ${it.nsr}" } }.joinToString("; "))
                if (kind == "include") SummaryLine("Horários informados", includedTimes.filter { it.isNotBlank() }.joinToString(" · "))
                if (kind == "correct") SummaryLine("Correções", selectedTargets.mapNotNull { id -> choices.firstOrNull { it.receiptId == id }?.let { "${it.time} → ${correctedTimes[id].orEmpty()}" } }.joinToString("; "))
                SummaryLine("Justificativa", reason.trim())
            }
            Text("A batida original nunca é apagada. Se o DP aprovar, o ajuste entra no ponto com a identificação de quem pediu e de quem decidiu.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            return@Page
        }
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
                    LabeledInput("Horário ${index + 1}", value, !feedback.busy, placeholder = "00:00", modifier = Modifier.weight(1f)) { next ->
                        includedTimes = includedTimes.toMutableList().also { it[index] = next.filter { char -> char.isDigit() || char == ':' }.take(5) }
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
                        Text("${punch.time} · registro oficial ${punch.nsr}", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
                    }
                    if (kind == "correct" && selected) LabeledInput("Horário correto", correctedTimes[id].orEmpty(), !feedback.busy, placeholder = "00:00") { next ->
                        correctedTimes = correctedTimes + (id to next.filter { char -> char.isDigit() || char == ':' }.take(5))
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
        if (unit == "hour") Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            LabeledInput("Das", startTime, !feedback.busy, placeholder = "00:00", modifier = Modifier.weight(1f)) { startTime = it.filter { c -> c.isDigit() || c == ':' }.take(5) }
            LabeledInput("Até", endTime, !feedback.busy, placeholder = "00:00", modifier = Modifier.weight(1f)) { endTime = it.filter { c -> c.isDigit() || c == ':' }.take(5) }
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
