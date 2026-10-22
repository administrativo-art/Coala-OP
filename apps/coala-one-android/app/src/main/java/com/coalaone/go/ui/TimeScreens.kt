package com.coalaone.go.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
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
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val file = pending ?: return@rememberLauncherForActivityResult
        if (uri != null) runCatching { context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } }.onFailure { problem = "Não foi possível salvar o arquivo." }
    }
    fun fetch(then: (File) -> Unit) { val id = punch.receiptId ?: return; vm.receipt(id, markedAt, punch.nsr ?: 0, context.cacheDir, then) }
    // The copy lives only while the sheet is open; sign-out also clears the folder.
    DisposableEffect(Unit) { onDispose { File(context.cacheDir, "receipts").deleteRecursively() } }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tokens.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Comprovante · ${punch.time}", style = MaterialTheme.typography.titleLarge)
            Text("NSR ${punch.nsr ?: "—"} · PDF assinado pelo sistema de ponto.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
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
@Composable private fun PunchList(punches: List<DayPunch>, expected: Int?, enabled: Boolean, onReceipt: (DayPunch) -> Unit) {
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
                Text(when { punch.discarded -> "Desconsiderada pelo DP"; punch.included -> "${TimeRules.suggestedLabel(index ?: 0, expected)} · incluída por ajuste aprovado pelo DP"; else -> "${TimeRules.suggestedLabel(index ?: 0, expected)} · sugerida pela ordem" }, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
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
        Text("HORA OFICIAL", color = Tokens.onDark4, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
        if (clock?.available == true && state.clockOffset != null) {
            Text(TimeRules.clockText(official, zone), color = Tokens.onDark, style = MaterialTheme.typography.displaySmall.copy(fontFamily = CodeFont, fontWeight = FontWeight.Bold))
            Text("${TimeRules.utcOffsetLabel(zone, official)} · fuso da unidade escolhida", color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
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
    var tab by rememberSaveable { mutableStateOf("today") }
    var confirming by rememberSaveable { mutableStateOf(false) }
    var capturingLocation by remember { mutableStateOf(false) }
    var asking by rememberSaveable { mutableStateOf<String?>(null) }
    var receipt by remember { mutableStateOf<Pair<DayPunch, String>?>(null) }
    var selectedMirror by remember { mutableStateOf(false) }
    asking?.let { date -> AdjustmentScreen(vm, date) { asking = null; vm.clearAdjustment() }; return }
    val units = state.options?.executionUnits.orEmpty()
    val today = state.today.toString()
    val todayShift = state.shifts.firstOrNull { it.date == today }
    val todayPunches = TimeRules.day(today, state.markings, state.treatments)
    val expected = TimeRules.expectedPunches(todayShift)
    val next = TimeRules.suggestedLabel(todayPunches.count { !it.discarded }, expected)
    val selectedUnit = units.firstOrNull { it.id == state.unitId }
    val unitName = selectedUnit?.name.orEmpty()
    val locationPolicy = selectedUnit?.locationPolicy ?: LocationPolicy()
    val screenBusy = feedback.busy || capturingLocation
    val scope = rememberCoroutineScope()
    fun captureAndRecord() {
        capturingLocation = true
        scope.launch {
            val attempt = capturePointLocation(context, locationPolicy.captureTimeoutMs ?: 10_000,
                locationPolicy.maxAccuracyMeters ?: 100.0)
            capturingLocation = false
            vm.record(true, attempt)
        }
    }
    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true || result[Manifest.permission.ACCESS_COARSE_LOCATION] == true) captureAndRecord()
        else vm.record(true, failedLocationAttempt(status = "denied"))
    }
    fun markedAtOf(punch: DayPunch) = state.markings.firstOrNull { it.receiptId == punch.receiptId }?.markedAt ?: today
    receipt?.let { (punch, markedAt) -> ReceiptSheet(punch, markedAt, vm) { receipt = null } }
    if (selectedMirror) FileSheet("Espelho de ponto", "Competência ${state.month} · versão ${state.mirror?.closure?.version ?: "—"}",
        "espelho-ponto-${state.month}.pdf", "application/pdf", { _, then -> vm.mirrorPdf(context.cacheDir, then) }) { selectedMirror = false }
    LaunchedEffect(tab, state.month) {
        when (tab) {
            "bank" -> if (state.bankDate != (if (state.month == java.time.YearMonth.from(state.today)) state.today else state.month.atEndOfMonth()).toString()) vm.loadBank()
            "mirror" -> if (state.mirrorCompetence != state.month.toString()) vm.loadMirror()
        }
    }
    // One main action: the punch, confirmed in the footer itself; the history has no footer.
    val footer: (@Composable ColumnScope.() -> Unit)? = if (tab != "today") null else { {
        if (confirming) {
            Text(if (online) "Registrar a próxima batida (sugerida: $next) em $unitName? Vale a hora oficial do momento do envio."
                else "Preservar a próxima batida (sugerida: $next) em $unitName neste aparelho? Ela receberá NSR e comprovante quando a internet voltar.",
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
            if (online && locationPolicy.mode != "disabled") {
                Text("Ao confirmar, o Coala Go fará uma única leitura de localização. O ponto será registrado mesmo se a posição estiver indisponível, imprecisa ou fora da unidade.",
                    color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                locationPolicy.privacyNoticeUrl?.let { url ->
                    TextButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
                        enabled = !screenBusy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Aviso de privacidade", color = Tokens.wine) }
                }
            }
            FooterPair("Voltar", !screenBusy, { confirming = false }, if (online) "Confirmar registro" else "Preservar no aparelho", !screenBusy) {
                confirming = false
                when {
                    !online || locationPolicy.mode == "disabled" || vm.hasPendingLocationAttempt() -> vm.record(online)
                    hasPointLocationPermission(context) -> captureAndRecord()
                    else -> locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }
            }
        } else Action(if (online) "Registrar ponto" else "Registrar ponto offline", screenBusy,
            enabled = TimeRules.canRecord(state.options, state.unitId)) { confirming = true }
    } }
    Page("Ponto", feedback, onBack, footer = footer, onRefresh = { vm.load() }, header = {
        TopBar("Ponto", busy = screenBusy, onBack = onBack)
        // The punch needs one unit: no "Todas as unidades" here.
        if (units.isNotEmpty()) UnitPickerHeader(units.map { it.id to it.name }, state.unitId.orEmpty(), screenBusy || confirming) { vm.unit(it) }
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PillChoice("Hoje", tab == "today") { tab = "today" }
                PillChoice("Histórico", tab == "history") { tab = "history"; confirming = false }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PillChoice("Banco de horas", tab == "bank") { tab = "bank"; confirming = false }
                PillChoice("Espelho", tab == "mirror") { tab = "mirror"; confirming = false }
            }
        }
        if (tab == "today") {
            OfficialClockCard(state)
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
                    Text("Ponto registrado · ${TimeRules.secondsOf(last.marking.markedAt)}", style = MaterialTheme.typography.titleMedium)
                    Text("NSR ${last.marking.nsr}${if (last.status == "replayed") " · a batida já estava gravada" else ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    last.location?.let { location -> Text(when (location.evaluation) {
                        "inside" -> "Localização compatível com a unidade."
                        "outside" -> "Localização indicada fora da área da unidade; o ponto foi registrado normalmente."
                        "indeterminate" -> "Não foi possível confirmar a localização; o ponto foi registrado normalmente."
                        else -> "Localização não solicitada para esta unidade."
                    }, color = if (location.evaluation == "inside") Tokens.info else Tokens.muted,
                        style = MaterialTheme.typography.bodySmall) }
                    if (last.receiptStatus == "available") Action("Abrir comprovante") { receipt = DayPunch(TimeRules.minuteOf(last.marking.markedAt), last.marking.nsr, last.receiptId, "available") to last.marking.markedAt }
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
                PunchList(todayPunches, expected, !feedback.busy) { receipt = it to markedAtOf(it) }
                Text("Próxima: $next", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            TextButton({ asking = today }, enabled = !feedback.busy, modifier = Modifier.heightIn(min = 44.dp)) { Text("Pedir ajuste de ponto", color = Tokens.wine) }
        } else if (tab == "history") HistoryTab(state, feedback.busy, vm, onReceipt = { receipt = it to markedAtOf(it) }, onAdjust = { asking = it })
        else if (tab == "bank") BankTab(state, feedback.busy, vm)
        else MirrorTab(state, feedback.busy, vm, onMirror = { selectedMirror = true })
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

@Composable private fun BankTab(state: TimeState, busy: Boolean, vm: TimeViewModel) {
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
                CardBlock {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(TimeRules.bankNatureText(item.line.nature), style = MaterialTheme.typography.titleMedium)
                            Text(fullDate(item.date), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                        }
                        val signedMinutes = when (item.line.nature) { "bank_credit" -> item.line.minutes; "bank_debit" -> -item.line.minutes; else -> 0 }
                        Text(if (signedMinutes == 0) TimeRules.durationText(item.line.minutes) else TimeRules.durationText(signedMinutes, true),
                            color = if (item.line.nature == "bank_debit") Tokens.warning else Tokens.ink, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            if (statement.lines.size > 100) Text("Mostrando os 100 lançamentos mais recentes do ciclo.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable private fun MirrorTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onMirror: () -> Unit) {
    AuxiliaryMonthPicker(state, busy, vm)
    CardBlock {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Espelho de ponto", style = MaterialTheme.typography.titleMedium)
                val status = when {
                    state.mirror?.closure == null -> "Competência ainda não fechada"
                    state.mirror.mirror == null -> "Espelho ainda não gerado"
                    else -> "Versão ${state.mirror.closure.version} · pacote ${state.mirror.`package`?.status ?: "não enviado"}"
                }
                Text(status, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            if (state.mirror?.mirror != null) StatusChip("Disponível", Tokens.okInk, Tokens.okBg)
        }
        if (state.mirror?.mirror != null) Action("Abrir espelho", secondary = true, enabled = !busy, onClick = onMirror)
    }
    Text("A pasta de documentos do colaborador continua disponível somente no Coala One.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall)
}

@Composable private fun HistoryTab(state: TimeState, busy: Boolean, vm: TimeViewModel, onReceipt: (DayPunch) -> Unit, onAdjust: (String) -> Unit) {
    val first = state.month.atDay(1)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        NavSquare("‹", "Mês anterior", !busy) { vm.month(state.month.minusMonths(1)) }
        Text(first.format(DateTimeFormatter.ofPattern("MMMM 'de' yyyy", ptBR)).replaceFirstChar { it.titlecase(ptBR) }, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
        NavSquare("›", "Próximo mês", !busy && state.month.isBefore(java.time.YearMonth.from(state.today))) { vm.month(state.month.plusMonths(1)) }
    }
    if (state.truncated) Text("O mês tem mais registros do que esta lista mostra; o espelho completo fica no Coala One.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
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
                PunchList(punches, TimeRules.expectedPunches(shift), !busy, onReceipt)
                state.adjustments.filter { it.workDate == key }.forEach { adjustment ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == adjustment.kind }?.second.orEmpty(), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        StatusChip(TimeRules.ADJUSTMENT_STATUS[adjustment.status] ?: adjustment.status, if (adjustment.status == "approved") Tokens.okInk else if (adjustment.status == "in_review") Tokens.warning else Tokens.muted, if (adjustment.status == "approved") Tokens.okBg else if (adjustment.status == "in_review") Tokens.warningBg else Tokens.soft)
                    }
                }
                Action("Pedir ajuste deste dia", secondary = true, enabled = !busy) { onAdjust(key) }
            }
        }
    }
}

/** Two steps, as on the web: the form, then a short report of what the DP will receive. */
@Composable private fun AdjustmentScreen(vm: TimeViewModel, initialDate: String, onClose: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var date by rememberSaveable { mutableStateOf(initialDate) }
    var kind by rememberSaveable { mutableStateOf("include") }
    var target by rememberSaveable { mutableStateOf<String?>(null) }
    var time by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var review by rememberSaveable { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val attemptId = rememberSaveable { TimeRules.newAttempt() }
    LaunchedEffect(date) { val month = runCatching { java.time.YearMonth.from(LocalDate.parse(date)) }.getOrNull(); if (month != null && month != state.month) vm.month(month) }
    val punches = TimeRules.day(date, state.markings, state.treatments)
    val choices = punches.filter { !it.discarded && !it.included && it.receiptId != null }
    val sent = state.sentAdjustment
    val kindLabel = TimeRules.ADJUSTMENT_KINDS.firstOrNull { it.first == kind }?.second.orEmpty()
    fun check(): Boolean = try { TimeRules.adjustmentRequest(attemptId, date, kind, target, time, state.unitId, reason, state.today); problem = null; true } catch (cause: IllegalArgumentException) { problem = cause.message; false }
    Page("Pedir ajuste", feedback.copy(error = problem ?: feedback.error), onClose, footer = {
        when {
            sent != null -> Action("Concluir") { onClose() }
            review -> FooterPair("Editar", !feedback.busy, { review = false }, "Enviar pedido", !feedback.busy) { vm.requestAdjustment(attemptId, date, kind, target, time, reason) }
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
                if (kind != "include") SummaryLine("Batida", choices.firstOrNull { it.receiptId == target }?.let { "${it.time} · NSR ${it.nsr}" }.orEmpty())
                if (kind != "discard") SummaryLine("Horário informado", time.trim())
                SummaryLine("Justificativa", reason.trim())
            }
            Text("A batida original nunca é apagada. Se o DP aprovar, o ajuste entra no ponto com a identificação de quem pediu e de quem decidiu.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            return@Page
        }
        DateField("Dia", date, !feedback.busy) { date = it; target = null }
        Text("O que aconteceu?", style = MaterialTheme.typography.titleMedium)
        TimeRules.ADJUSTMENT_KINDS.forEach { (id, label) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = !feedback.busy, role = Role.RadioButton) { kind = id }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RadioButton(kind == id, null)
                Column(Modifier.weight(1f)) { Text(label); Text(TimeRules.ADJUSTMENT_HINTS[id].orEmpty(), color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
            }
        }
        if (kind != "include") {
            if (choices.isEmpty()) Text("Nenhuma batida neste dia para escolher.", color = Tokens.muted)
            else Choices("Batida", choices.map { it.receiptId!! to "${it.time} · NSR ${it.nsr}" }, target.orEmpty(), !feedback.busy) { target = it }
        }
        if (kind != "discard") LabeledInput("Horário correto", time, !feedback.busy, placeholder = "00:00") { time = it.filter { char -> char.isDigit() || char == ':' }.take(5) }
        NoteInput("Justificativa", reason, 1000, "Explique o que aconteceu (mínimo de 10 caracteres)", !feedback.busy) { reason = it }
    }
}

@Composable fun RequestsScreen(vm: RequestsViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    LaunchedEffect(Unit) { vm.load() }
    var tab by rememberSaveable { mutableStateOf("absence") }
    var creating by rememberSaveable { mutableStateOf(false) }
    if (creating) {
        val close = { creating = false; vm.clearSent(); vm.editAbsence() }
        if (tab == "absence") AbsenceForm(vm, close) else if (tab == "voucher") VoucherForm(vm, close) else ShiftSwapForm(vm, close)
        return
    }
    val canCreateAbsence = state.absenceOptions?.capabilities?.canCreate == true && state.absenceOptions?.absenceTypes?.isNotEmpty() == true
    val swapOptions = state.shiftSwapOptions
    val canCreateSwap = swapOptions?.ownShifts?.any { own -> swapOptions.candidateShifts.any { other ->
        other.scheduleId == own.scheduleId && other.unitId == own.unitId && other.date == own.date } } == true
    Page("Solicitações", feedback, onBack, onRefresh = { vm.load() }, footer = {
        if (tab == "absence") Action("Solicitar ausência", feedback.busy, enabled = canCreateAbsence) { creating = true }
        else if (tab == "voucher") Action("Solicitar vale-transporte", feedback.busy) { creating = true }
        else Action("Solicitar troca de turno", feedback.busy, enabled = canCreateSwap) { creating = true }
    }) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PillChoice("Ausência", tab == "absence") { tab = "absence" }
            PillChoice("Vale-transporte", tab == "voucher") { tab = "voucher" }
            PillChoice("Troca de turno", tab == "swap") { tab = "swap" }
        }
        if (tab == "absence") {
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

@Composable private fun ShiftSwapForm(vm: RequestsViewModel, onClose: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val options = state.shiftSwapOptions
    var offeredKey by rememberSaveable { mutableStateOf("") }
    var requestedKey by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    val keyOf: (ShiftSwapOption) -> String = { "${it.scheduleId}:${it.shiftId}" }
    val offered = options?.ownShifts?.firstOrNull { keyOf(it) == offeredKey }
    val candidates = options?.candidateShifts.orEmpty().filter { offered != null && it.scheduleId == offered.scheduleId && it.unitId == offered.unitId && it.date == offered.date }
    val requested = candidates.firstOrNull { keyOf(it) == requestedKey }
    val sent = state.sentShiftSwap
    Page("Troca de turno", feedback, onClose, footer = {
        if (sent != null) Action("Concluir") { onClose() }
        else Action("Enviar proposta", feedback.busy, enabled = offered != null && requested != null && (reason.isBlank() || reason.trim().length >= 5)) {
            vm.requestShiftSwap(offered!!, requested!!, reason.trim().ifBlank { null })
        }
    }) {
        if (sent != null) {
            CardBlock(selected = true) {
                Text("Proposta enviada", style = MaterialTheme.typography.titleMedium)
                Text("${sent.targetName} recebeu a solicitação. A escala só muda quando essa pessoa aceitar pela própria conta.", color = Tokens.muted)
            }
            return@Page
        }
        Choices("Meu turno", options?.ownShifts.orEmpty().map { keyOf(it) to "${fullDate(it.date)} · ${it.startTime}–${it.endTime} · ${it.unitName}" }, offeredKey, !feedback.busy) {
            offeredKey = it; requestedKey = ""
        }
        Choices("Turno que quero receber", candidates.map { keyOf(it) to "${it.startTime}–${it.endTime} · ${it.occupantName}" }, requestedKey, !feedback.busy && offered != null) { requestedKey = it }
        if (offered != null && candidates.isEmpty()) Text("Não há outro turno elegível na mesma unidade e no mesmo dia.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
        NoteInput("Motivo (opcional)", reason, 500, "Explique a troca, se quiser", !feedback.busy) { reason = it }
        Text("A outra pessoa será notificada. O aceite autenticado fica registrado e apenas os ocupantes dos dois turnos são invertidos; a escala não é reescrita.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun AbsenceForm(vm: RequestsViewModel, onClose: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val types = state.absenceOptions?.absenceTypes.orEmpty()
    var typeId by rememberSaveable { mutableStateOf(types.firstOrNull()?.id.orEmpty()) }
    val type = types.firstOrNull { it.id == typeId }
    var unit by rememberSaveable { mutableStateOf("day") }
    val today = LocalDate.now().toString()
    var start by rememberSaveable { mutableStateOf(today) }
    var end by rememberSaveable { mutableStateOf(today) }
    var startTime by rememberSaveable { mutableStateOf("") }
    var endTime by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var files by remember { mutableStateOf<List<Document>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    val capture = rememberCaptureActions { document -> files = files + document }
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
