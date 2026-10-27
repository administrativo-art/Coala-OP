package com.coalaone.go.ui

import com.coalaone.go.data.*
import com.coalaone.go.domain.ClockSource
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.offline.*
import com.coalaone.go.location.JourneyLocationController
import dagger.hilt.android.lifecycle.HiltViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID
import javax.inject.Inject

data class TimeState(val options: TimeOptions? = null, val clockOffset: Long? = null, val clockSource: ClockSource = ClockSource.NONE, val unitId: String? = null,
    val today: LocalDate = LocalDate.now(), val month: YearMonth = YearMonth.now(), val markings: List<OwnMarking> = emptyList(), val shifts: List<OwnShift> = emptyList(),
    val adjustments: List<Adjustment> = emptyList(), val treatments: List<Treatment> = emptyList(), val truncated: Boolean = false, val last: MarkingResponse? = null, val sentAdjustment: Adjustment? = null,
    val bank: TimeBankResponse? = null, val bankDate: String? = null, val mirror: MirrorStatus? = null, val mirrorCompetence: String? = null,
    val mirrorYear: Int? = null, val mirrors: Map<String, MirrorStatus> = emptyMap(),
    val offlineRows: List<TimeMarkingRow> = emptyList(), val lastOffline: CapturedOfflineMarking? = null,
    val offlineIssue: String? = null, val offlineReady: Boolean = false,
    val journeyTrackingActive: Boolean = false, val journeyClosurePromptDate: String? = null,
    val closedJourneyDate: String? = null)
/** The attempt the screen resends as is: its purpose and unit cannot change, and the time is when it was first tried. */
data class PendingAttempt(val purpose: String?, val unitId: String?, val firstTriedAt: Long?, val firstTriedSource: String? = null)

/** Ponto: punch, today, history, receipts and adjustment requests, all through the web routes. Nothing is polled. */
@HiltViewModel class TimeViewModel @Inject constructor(private val repository: ApiRepository, private val saved: androidx.lifecycle.SavedStateHandle,
    private val auth: AuthGateway, private val offlineQueue: TimeOfflineQueue, private val offlineSync: TimeOfflineSync,
    private val offlineScheduler: TimeOfflineWorkScheduler, private val journeyLocation: JourneyLocationController? = null,
    private val timeSummaryUpdates: TimeSummaryUpdates = TimeSummaryUpdates()) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(TimeState(closedJourneyDate = saved.get<String>("closedJourneyDate")))
    val state = mutable.asStateFlow()
    private val api get() = repository.api
    /**
     * The pending punch attempt: id and work date travel together and survive the process being killed, so a
     * retry after a lost answer is the same attempt even past midnight. Cleared only after the server answered.
     */
    private var attempt: Pair<String, String>?
        get() = saved.get<String>("attemptId")?.let { id -> saved.get<String>("attemptDate")?.let { id to it } }
        set(value) { saved["attemptId"] = value?.first; saved["attemptDate"] = value?.second }
    private var pendingLocation: LocationAttempt?
        get() = saved.get<String>("attemptLocation")?.let { encoded -> runCatching { Json.decodeFromString<LocationAttempt>(encoded) }.getOrNull() }
        set(value) { saved["attemptLocation"] = value?.let(Json::encodeToString) }
    private var attemptUnitId: String?
        get() = saved["attemptUnitId"]
        set(value) { saved["attemptUnitId"] = value }
    private var attemptPurpose: String?
        get() = saved["attemptPurpose"]
        set(value) { saved["attemptPurpose"] = value }
    private var attemptFirstTriedAt: Long?
        get() = saved["attemptFirstTriedAt"]
        set(value) { saved["attemptFirstTriedAt"] = value }
    /** Where that first time came from: OFFICIAL, LOCAL_PERMIT or DEVICE (no reading; the phone clock). */
    private var attemptFirstTriedSource: String?
        get() = saved["attemptFirstTriedSource"]
        set(value) { saved["attemptFirstTriedSource"] = value }
    private fun clearAttempt() { attempt = null; pendingLocation = null; attemptUnitId = null; attemptPurpose = null; attemptFirstTriedAt = null; attemptFirstTriedSource = null }
    private fun sourceOf(offset: Long?) = if (offset != null) ClockSource.OFFICIAL else ClockSource.NONE
    private fun serverRun(notice: String? = null, work: suspend () -> Unit) = run(notice) { try { work() } catch (cause: Exception) { throw Errors.withServerMessage(cause) } }
    init {
        auth.current?.uid?.let { uid -> viewModelScope.launch { offlineQueue.observe(uid).collect { rows ->
            mutable.update { it.copy(offlineRows = rows) }
        } } }
    }

    private suspend fun refreshPermit(options: TimeOptions, elapsed: Long) {
        if (options.mode !in setOf("official", "pilot")) {
            mutable.update { it.copy(offlineIssue = null, offlineReady = false) }
            return
        }
        val uid = auth.current?.uid ?: return
        try {
            offlineQueue.permitRequest(uid, options.workDate, elapsed, options.mode)?.let { request ->
                offlineQueue.savePermit(uid, api.offlinePermit(request).permit)
            }
            updateContingencyState(uid, options, elapsed, null)
        } catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { updateContingencyState(uid, options, elapsed, Errors.classify(cause).message) }
    }
    private suspend fun updateContingencyState(uid: String, options: TimeOptions, elapsed: Long, issue: String?) {
        val cached = offlineQueue.cachedOptions(uid, elapsed)?.takeIf { it.mode == options.mode }
        val ready = cached != null
        val fallbackOffset = cached?.officialClock?.let { TimeRules.clockOffset(it, elapsed) }
        // The permit anchor is shown as such, never as a Hora Legal confirmed now.
        mutable.update { current -> if (options.officialClock?.available == true) current.copy(offlineReady = ready, offlineIssue = if (ready) null else issue)
            else current.copy(offlineReady = ready, offlineIssue = if (ready) null else issue, clockOffset = fallbackOffset,
                clockSource = if (fallbackOffset != null) ClockSource.LOCAL_PERMIT else ClockSource.NONE) }
    }

    /** Options of today and the month on screen; read when the screen opens and on pull-to-refresh. */
    fun load() = serverRun {
        val today = LocalDate.now()
        val elapsed = android.os.SystemClock.elapsedRealtime()
        var synced = emptyList<SyncedOfflineMarking>()
        try {
            auth.current?.uid?.let { synced = offlineSync.syncWithResult(it).confirmed }
            reconcileSyncedMarkings(synced)
            val options = api.timeOptions(today.toString())
            val offset = TimeRules.clockOffset(options.officialClock, elapsed)
            mutable.update { state -> state.copy(options = options, clockOffset = offset, clockSource = sourceOf(offset), today = today,
                unitId = state.unitId?.takeIf { id -> options.executionUnits.any { it.id == id } } ?: options.executionUnits.firstOrNull()?.id) }
            reconcileJourneyAvailability(options)
            refreshPermit(options, elapsed)
            readMonth(mutable.value.month)
        } catch (cause: IOException) {
            val uid = auth.current?.uid ?: throw cause
            val options = offlineQueue.cachedOptions(uid, elapsed) ?: throw cause
            val offset = TimeRules.clockOffset(options.officialClock, elapsed)
            // Cached options carry the permit anchor; without the network it is not a Hora Legal read now.
            mutable.update { state -> state.copy(options = options, clockOffset = offset,
                clockSource = if (offset != null) ClockSource.LOCAL_PERMIT else ClockSource.NONE, today = today,
                unitId = state.unitId?.takeIf { id -> options.executionUnits.any { it.id == id } } ?: options.executionUnits.firstOrNull()?.id,
                offlineReady = true, offlineIssue = null) }
        }
    }
    private fun reconcileSyncedMarkings(markings: List<SyncedOfflineMarking>) {
        val latest = markings.maxByOrNull { it.response.marking.markedAt } ?: return
        val workDate = latest.request.workDate
        if (saved.get<String>("closedJourneyDate") == workDate) saved["closedJourneyDate"] = null
        mutable.update { it.copy(
            closedJourneyDate = saved.get<String>("closedJourneyDate"),
            journeyClosurePromptDate = workDate.takeIf { latest.request.declaredPurpose == "journey_end" },
        ) }
    }
    /** Direct Home shortcut: load the selected journey and its possible overnight continuation. */
    fun loadDay(workDate: String) = serverRun {
        val date = LocalDate.parse(workDate)
        val next = date.plusDays(1)
        val months = listOf(YearMonth.from(date), YearMonth.from(next)).distinct()
        val options = api.timeOptions(LocalDate.now().toString())
        val markings = api.markings(date.toString(), next.toString())
        val monthReads = months.map { api.timeMonth(it.toString()) }
        val adjustmentReads = months.map { api.adjustments(it.toString()) }
        val offset = TimeRules.clockOffset(options.officialClock, android.os.SystemClock.elapsedRealtime())
        mutable.update { current -> current.copy(options = options, clockOffset = offset, clockSource = sourceOf(offset),
            today = LocalDate.now(), month = YearMonth.from(date), markings = markings.markings,
            truncated = markings.truncated || monthReads.any { it.truncated }, shifts = monthReads.flatMap { it.shifts },
            adjustments = adjustmentReads.flatMap { it.adjustments }, treatments = adjustmentReads.flatMap { it.treatments },
            bank = null, bankDate = null) }
        // Punches and treatments are useful by themselves; a bank outage must not blank the direct detail.
        val bank = api.timeBank(workDate)
        mutable.update { it.copy(bank = bank, bankDate = workDate) }
    }
    fun month(month: YearMonth) = serverRun { readMonth(month) }
    fun selectAuxiliaryMonth(month: YearMonth) { mutable.update { it.copy(month = month) } }
    /** Back from the background: only the options and the official reading, so the clock and the block are current. */
    fun refreshClock() = serverRun {
        val options = api.timeOptions(LocalDate.now().toString())
        val elapsed = android.os.SystemClock.elapsedRealtime()
        val offset = TimeRules.clockOffset(options.officialClock, elapsed)
        mutable.update { it.copy(options = options, clockOffset = offset, clockSource = sourceOf(offset)) }
        reconcileJourneyAvailability(options)
        refreshPermit(options, elapsed)
    }
    private suspend fun readMonth(month: YearMonth) {
        val (start, end) = TimeRules.monthRange(month)
        val key = month.toString()
        val markings = api.markings(start, end); val shifts = api.timeMonth(key); val adjustments = api.adjustments(key)
        mutable.update { current ->
            val scheduledUnit = shifts.shifts.firstOrNull { it.date == current.today.toString() && it.type == "work" }?.unitId
            current.copy(month = month, markings = markings.markings, truncated = markings.truncated || shifts.truncated, shifts = shifts.shifts,
                adjustments = adjustments.adjustments, treatments = adjustments.treatments,
                unitId = scheduledUnit?.takeIf { id -> current.options?.executionUnits?.any { it.id == id } == true } ?: current.unitId)
        }
    }
    /** A pending attempt is immutable: its unit is changed only after a conclusive server answer. */
    fun unit(id: String) { if (attempt == null && mutable.value.unitId != id) mutable.update { it.copy(unitId = id) } }
    fun hasPendingAttempt() = attempt != null
    fun pendingAttempt(): PendingAttempt? = attempt?.let { PendingAttempt(attemptPurpose, attemptUnitId, attemptFirstTriedAt, attemptFirstTriedSource) }
    fun hasPendingLocationAttempt() = attempt != null && pendingLocation != null
    fun record(online: Boolean = true, capturedLocation: LocationAttempt? = null, declaredPurpose: String) = serverRun {
        var state = mutable.value
        if (!online) {
            require(attempt == null) { "Há uma tentativa anterior aguardando confirmação. Conecte-se para reenviar a mesma batida sem duplicá-la." }
            require(TimeRules.canPreserveOffline(state.options, state.unitId, state.offlineReady)) {
                "Sem autorização local válida. Conecte-se para preparar a contingência antes de registrar sem internet."
            }
            preserveLocally(state, declaredPurpose)
            return@serverRun
        }
        // A block caused only by the official clock is read again on tap: the server may already be back.
        if (!TimeRules.canRecord(state.options, state.unitId) && state.options?.officialClock?.available != true) { refreshOptions(); state = mutable.value }
        if (attempt == null && TimeRules.canPreserve(state.options, state.unitId, state.offlineReady)) {
            preserveLocally(state, declaredPurpose)
            return@serverRun
        }
        val replaying = attempt != null
        require(replaying || TimeRules.canRecord(state.options, state.unitId)) { TimeRules.blockedReason(state.options, state.offlineReady) ?: "Escolha a unidade." }
        val selectedUnitId = if (replaying) attemptUnitId ?: state.unitId else state.unitId
        require(selectedUnitId != null) { "Escolha a unidade." }
        val selectedPurpose = if (replaying) attemptPurpose ?: declaredPurpose else declaredPurpose
        val zone = TimeRules.unitZone(state.options, selectedUnitId)
        val pending = attempt ?: (TimeRules.newAttempt() to TimeRules.workDate(officialNow(state), zone)).also {
            attempt = it; attemptUnitId = selectedUnitId; attemptPurpose = selectedPurpose; attemptFirstTriedAt = officialNow(state)
            attemptFirstTriedSource = if (state.clockOffset == null) "DEVICE" else state.clockSource.name
        }
        if (attemptUnitId == null) attemptUnitId = selectedUnitId
        if (attemptPurpose == null) attemptPurpose = selectedPurpose
        val locationEnabled = state.options?.executionUnits?.firstOrNull { it.id == selectedUnitId }?.locationPolicy?.mode != "disabled"
        val location = if (locationEnabled) pendingLocation ?: capturedLocation
            ?: failedLocationAttempt(status = "unavailable") else null
        pendingLocation = location
        val result = try { api.mark(MarkingRequest(pending.first, pending.second, selectedUnitId, declaredPurpose = selectedPurpose, locationAttempt = location)) }
        catch (cause: retrofit2.HttpException) {
            // 409: the attempt clashes with one already recorded. Start over from what the server holds.
            if (cause.code() == 409) { clearAttempt(); readMonth(YearMonth.now()) }
            // The server explicitly guarantees this attempt was not recorded. It is then safe to preserve a new,
            // signed local attempt; network failures and other ambiguous answers keep replaying the original one.
            if (Errors.serverCode(cause) == "REP_P_TIME_UNAVAILABLE" && state.offlineReady) {
                clearAttempt()
                preserveLocally(state.copy(unitId = selectedUnitId), selectedPurpose)
                return@serverRun
            }
            throw cause
        }
        clearAttempt()
        // Every newly confirmed punch reopens a previously closed visual cycle. A new end punch then asks again.
        if (saved.get<String>("closedJourneyDate") == pending.second) saved["closedJourneyDate"] = null
        mutable.update { it.copy(last = result,
            journeyClosurePromptDate = pending.second.takeIf { selectedPurpose == "journey_end" },
            closedJourneyDate = saved.get<String>("closedJourneyDate")) }
        auth.current?.uid?.let { uid ->
            timeSummaryUpdates.recorded(uid, OwnMarking(result.receiptId, pending.second, result.marking.nsr,
                result.marking.markedAt, result.marking.executionUnitId, "01", result.receiptStatus,
                result.receiptIssue, MarkingClassification(selectedPurpose), result.pilot))
        }
        updateJourneyLocation(state, pending.second, result.marking.executionUnitId, selectedPurpose)
        readMonth(YearMonth.from(LocalDate.parse(pending.second)))
    }
    private suspend fun preserveLocally(state: TimeState, declaredPurpose: String) {
        require(attempt == null) { "Há uma tentativa anterior aguardando confirmação. Conecte-se para reenviar a mesma batida sem duplicá-la." }
        val uid = auth.current?.uid ?: error("Sessão expirada.")
        val unitId = state.unitId ?: error("Escolha a unidade.")
        val captured = offlineQueue.capture(uid, unitId, android.os.SystemClock.elapsedRealtime(), declaredPurpose)
        mutable.update { it.copy(lastOffline = captured) }
        updateJourneyLocation(state, captured.workDate, unitId, declaredPurpose)
        offlineScheduler.schedule(uid)
    }
    private fun updateJourneyLocation(state: TimeState, workDate: String, unitId: String, purpose: String) {
        val shift = state.shifts.firstOrNull { it.date == workDate && it.type == "work" }
        val policyActive = state.options?.executionUnits?.firstOrNull { it.id == unitId }?.locationPolicy?.mode == "observe"
        journeyLocation?.afterPunch(shift, workDate, unitId, TimeRules.unitZone(state.options, unitId), purpose, policyActive,
            state.options?.journeyLocationEnabled == true)
        mutable.update { it.copy(journeyTrackingActive = journeyLocation?.isActive() == true) }
    }
    fun classify(receiptId: String, purpose: String) = serverRun {
        val before = mutable.value.markings.firstOrNull { it.receiptId == receiptId }
        val result = api.classifyMarking(receiptId, ClassificationUpdate(purpose))
        feedbackMutable.update { it.copy(notice = if (result.changeStatus == "in_review") "Mês fechado: alteração enviada para revisão." else "Classificação atualizada.") }
        readMonth(mutable.value.month)
        if (result.changeStatus == "applied" && before != null) {
            val state = mutable.value
            val shift = state.shifts.firstOrNull { it.date == before.workDate && it.type == "work" }
            val policyActive = state.options?.executionUnits?.firstOrNull { it.id == before.executionUnitId }?.locationPolicy?.mode == "observe"
            journeyLocation?.reconcile(shift, before.workDate, before.executionUnitId,
                TimeRules.unitZone(state.options, before.executionUnitId), state.markings, policyActive,
                state.options?.journeyLocationEnabled == true)
            val classifiedAsEnd = purpose == "journey_end"
            val isLastPunchOfDay = state.markings.filter { it.workDate == before.workDate }
                .maxByOrNull { it.markedAt }?.receiptId == receiptId
            val wasClosed = state.closedJourneyDate == before.workDate
            val shouldPromptForEnd = classifiedAsEnd && isLastPunchOfDay
            if (wasClosed && (!classifiedAsEnd || shouldPromptForEnd)) saved["closedJourneyDate"] = null
            mutable.update { it.copy(
                journeyTrackingActive = journeyLocation?.isActive() == true,
                closedJourneyDate = if (wasClosed && (!classifiedAsEnd || shouldPromptForEnd)) null else it.closedJourneyDate,
                journeyClosurePromptDate = if (shouldPromptForEnd) before.workDate
                    else if (it.journeyClosurePromptDate == before.workDate) null else it.journeyClosurePromptDate,
            ) }
        }
    }
    private fun reconcileJourneyAvailability(options: TimeOptions) {
        val activeUnits = options.executionUnits.filter { it.locationPolicy.mode == "observe" }.mapTo(mutableSetOf()) { it.id }
        journeyLocation?.stopIfUnavailable(options.journeyLocationEnabled, activeUnits)
        mutable.update { it.copy(journeyTrackingActive = journeyLocation?.isActive() == true) }
    }
    fun stopJourneyLocation() {
        journeyLocation?.stop()
        mutable.update { it.copy(journeyTrackingActive = false) }
        feedbackMutable.update { it.copy(notice = "Acompanhamento encerrado neste aparelho.") }
    }
    /** Organizational closure only. A later punch always remains available and reopens the visual cycle. */
    fun closeJourneyCycle(workDate: String) {
        saved["closedJourneyDate"] = workDate
        journeyLocation?.stop()
        mutable.update { it.copy(closedJourneyDate = workDate, journeyClosurePromptDate = null, journeyTrackingActive = false) }
        feedbackMutable.update { it.copy(notice = "Ciclo da jornada encerrado. Se precisar, você ainda pode registrar uma nova batida.") }
    }
    fun deferJourneyClosure() {
        mutable.update { it.copy(journeyClosurePromptDate = null) }
        feedbackMutable.update { it.copy(notice = "O ciclo continua aberto e pode ser encerrado depois.") }
    }
    /** Official time from the monotonic clock: changing the phone's hour does not move it. Phone time only without a reading. */
    private fun officialNow(state: TimeState) = state.clockOffset?.let { android.os.SystemClock.elapsedRealtime() + it } ?: System.currentTimeMillis()
    private suspend fun refreshOptions() {
        val options = api.timeOptions(LocalDate.now().toString())
        val elapsed = android.os.SystemClock.elapsedRealtime()
        val offset = TimeRules.clockOffset(options.officialClock, elapsed)
        mutable.update { it.copy(options = options, clockOffset = offset, clockSource = sourceOf(offset)) }
        reconcileJourneyAvailability(options)
        refreshPermit(options, elapsed)
    }
    fun dismissLast() { mutable.update { it.copy(last = null) } }
    fun dismissOffline() { mutable.update { it.copy(lastOffline = null) } }
    /** Downloads the PDF into the app cache (never shared storage) and hands the file to the screen to open or share. */
    fun receipt(receiptId: String, markedAt: String, nsr: Long, pilot: Boolean, directory: File, then: (File) -> Unit) = serverRun {
        val file = withContext(Dispatchers.IO) {
            val folder = File(directory, "receipts").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
            File(folder, TimeRules.receiptFileName(markedAt, nsr, pilot)).also { target -> api.receipt(receiptId).use { body -> target.outputStream().use { body.byteStream().copyTo(it) } } }
        }
        then(file)
    }
    /** Exports only official signed receipts; pilot receipts remain individually available and visibly non-official. */
    fun receiptArchive(directory: File, then: (File) -> Unit) = serverRun {
        val state = mutable.value
        require(!state.truncated) { "O mês tem registros demais. Escolha um período menor no Coala One." }
        val officialMarkings = state.markings.filterNot { it.pilot }
        require(officialMarkings.isNotEmpty()) { "Não há comprovantes oficiais neste mês. Os comprovantes do ensaio são baixados em cada batida." }
        val (start, end) = TimeRules.monthRange(state.month)
        val complete = officialMarkings.all { it.receiptStatus == "available" }
        val fileName = "comprovantes-ponto-$start-a-$end-${if (complete) "completo" else "incompleto"}.zip"
        then(cacheFile(directory, "time-documents", fileName, api.receiptArchive(start, end)))
    }
    private fun dateInSelectedMonth(state: TimeState) = if (state.month == YearMonth.from(state.today)) state.today else state.month.atEndOfMonth()
    /** Banco é carregado só quando a aba é aberta: não acrescenta leituras ao registro diário. */
    fun loadBank(dateOverride: String? = null) = serverRun {
        val date = dateOverride ?: dateInSelectedMonth(mutable.value).toString()
        mutable.update { it.copy(bank = api.timeBank(date), bankDate = date) }
    }
    /** Espelho é consultado por competência e nunca é gerado por esta leitura. */
    fun loadMirror() = serverRun {
        val competence = mutable.value.month.toString()
        mutable.update { it.copy(mirror = api.mirror(competence), mirrorCompetence = competence) }
    }
    /** Um acesso de rede por competência existente no ano, somente ao abrir ou trocar o ano dos espelhos. */
    fun loadMirrorYear(year: Int) = serverRun {
        val current = YearMonth.from(mutable.value.today)
        val months = (1..12).map { YearMonth.of(year, it) }.filter { !it.isAfter(current) }
        val statuses = linkedMapOf<String, MirrorStatus>()
        for (month in months) statuses[month.toString()] = api.mirror(month.toString())
        mutable.update { it.copy(mirrorYear = year, mirrors = statuses) }
    }
    /** Fechamento disponível torna o espelho acessível: a primeira abertura gera o instantâneo idempotente. */
    fun openMirror(competence: String, then: () -> Unit) = serverRun {
        var status = api.mirror(competence)
        val closure = status.closure ?: error("Esta competência ainda não foi fechada.")
        require(closure.status == "closed") { "Esta competência ainda não foi fechada." }
        if (status.mirror == null) {
            api.generateMirror(MirrorGenerateRequest(competence = competence, expectedVersion = closure.version))
            status = api.mirror(competence)
        }
        require(status.mirror != null) { "Não foi possível preparar o espelho." }
        mutable.update { state -> state.copy(month = YearMonth.parse(competence), mirror = status, mirrorCompetence = competence,
            mirrors = state.mirrors + (competence to status)) }
        then()
    }
    private suspend fun cacheFile(directory: File, folderName: String, fileName: String, body: okhttp3.ResponseBody): File = withContext(Dispatchers.IO) {
        val folder = File(directory, folderName).apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        File(folder, fileName.replace(Regex("[^A-Za-z0-9._-]"), "-")).also { target -> body.use { source -> target.outputStream().use { source.byteStream().copyTo(it) } } }
    }
    fun mirrorPdf(directory: File, then: (File) -> Unit) = serverRun {
        val competence = mutable.value.month.toString()
        then(cacheFile(directory, "time-documents", "espelho-ponto-$competence.pdf", api.mirrorPdf(competence)))
    }
    fun requestAdjustment(attemptId: String, workDate: String, operations: List<AdjustmentRequestOperation>, reason: String) = serverRun {
        val state = mutable.value
        val unitToday = LocalDate.parse(TimeRules.workDate(officialNow(state), TimeRules.unitZone(state.options, state.unitId)))
        val pilot = state.markings.any { it.workDate == workDate && it.pilot }
            || (workDate == unitToday.toString() && state.options?.mode == "pilot")
        val request = TimeRules.adjustmentRequest(attemptId, workDate, operations.map { operation -> operation.copy(executionUnitId = operation.executionUnitId ?: state.unitId) }, reason, unitToday)
            .copy(scope = if (pilot) "pilot" else null)
        val created = api.requestAdjustment(request).adjustment
        mutable.update { it.copy(sentAdjustment = created) }
        feedbackMutable.update { it.copy(notice = if (pilot) "Simulação de ajuste enviada ao DP." else "Pedido de ajuste enviado ao DP.") }
        readMonth(YearMonth.from(LocalDate.parse(workDate)))
    }
    fun clearAdjustment() { mutable.update { it.copy(sentAdjustment = null) } }
}

data class RequestsState(val absenceOptions: AbsenceOptions? = null, val absences: List<AbsenceRequestRow> = emptyList(), val vouchers: List<VoucherRequest> = emptyList(),
    val shiftSwapOptions: ShiftSwapOptions? = null, val shiftSwaps: List<ShiftSwapRequest> = emptyList(), val preview: AbsencePreview? = null,
    val sentAbsence: AbsenceRequestRow? = null, val sentVoucher: VoucherRequest? = null, val sentShiftSwap: ShiftSwapRequest? = null)
/** Keys kept across retries of one absence request, so a repeated tap reuses the same draft and preparation. */
private data class AbsenceAttempt(val idempotencyKey: String = UUID.randomUUID().toString(), val proposedRequestId: String = UUID.randomUUID().toString(),
    val submitOperationId: String = UUID.randomUUID().toString(), var preparationIds: List<String> = emptyList(), var draft: AbsenceRequestRow? = null)

/** Solicitações: ausência, vale-transporte e troca de turno pelo mesmo contrato central da web. */
@HiltViewModel class RequestsViewModel @Inject constructor(private val repository: ApiRepository) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(RequestsState())
    val state = mutable.asStateFlow()
    private val api get() = repository.api
    private var attempt: AbsenceAttempt? = null
    private fun serverRun(notice: String? = null, work: suspend () -> Unit) = run(notice) { try { work() } catch (cause: Exception) { throw Errors.withServerMessage(cause) } }

    fun load() = serverRun {
        val options = api.absenceOptions(); val absences = api.absences(); val vouchers = api.vouchers()
        val swapOptions = api.shiftSwapOptions(); val swaps = api.shiftSwaps()
        mutable.update { it.copy(absenceOptions = options, absences = absences.requests, vouchers = vouchers.requests,
            shiftSwapOptions = swapOptions, shiftSwaps = swaps.requests) }
    }
    /** First step: the server computes the summary; nothing is saved yet. */
    fun preview(period: () -> AbsencePeriod) = serverRun { mutable.update { it.copy(preview = api.absencePreview(period()).preview) } }
    fun editAbsence() { mutable.update { it.copy(preview = null) }; attempt = null }
    fun sendAbsence(period: AbsencePeriod, reason: String?, files: List<Document>, attachmentRequired: Boolean) = serverRun("Solicitação enviada.") {
        TimeRules.validateAbsenceFiles(files, attachmentRequired)
        val current = attempt ?: AbsenceAttempt().also { attempt = it }
        if (files.isNotEmpty() && current.preparationIds.isEmpty()) {
            val parts = files.map { MultipartBody.Part.createFormData("files", it.name, it.bytes.toRequestBody(it.mimeType.toMediaType())) }
            current.preparationIds = api.prepareAbsence(current.proposedRequestId.toRequestBody("text/plain".toMediaType()), parts).preparationIds
        }
        val draft = current.draft ?: api.createAbsence(AbsenceDraftRequest(current.idempotencyKey, current.proposedRequestId.takeIf { current.preparationIds.isNotEmpty() }, period, current.preparationIds, reason)).request.also { current.draft = it }
        val sent = if (draft.status == "draft") api.submitAbsence(draft.id, AbsenceSubmit(draft.version, current.submitOperationId)).request else draft
        attempt = null
        mutable.update { it.copy(preview = null, sentAbsence = sent, absences = api.absences().requests) }
    }
    fun requestVoucher(action: String, details: String) = serverRun("Solicitação enviada ao DP.") {
        val created = api.requestVoucher(TimeRules.voucherRequest(action, details)).request
        mutable.update { it.copy(sentVoucher = created, vouchers = api.vouchers().requests) }
    }
    fun requestShiftSwap(offered: ShiftSwapOption, requested: ShiftSwapOption, reason: String?) = serverRun("Solicitação enviada para ${requested.occupantName}.") {
        require(offered.scheduleId == requested.scheduleId && offered.unitId == requested.unitId && offered.date == requested.date) { "Escolha turnos da mesma unidade e do mesmo dia." }
        val created = api.requestShiftSwap(ShiftSwapCreate(offered.scheduleId, offered.shiftId, requested.shiftId, UUID.randomUUID().toString(), reason)).request
        mutable.update { it.copy(sentShiftSwap = created, shiftSwaps = api.shiftSwaps().requests, shiftSwapOptions = api.shiftSwapOptions()) }
    }
    fun decideShiftSwap(request: ShiftSwapRequest, action: String, reason: String? = null) = serverRun(
        if (action == "accept") "Troca aceita e escala atualizada." else if (action == "reject") "Troca recusada." else "Proposta cancelada.") {
        api.decideShiftSwap(request.id, ShiftSwapDecision(action, request.version, UUID.randomUUID().toString(), reason))
        mutable.update { it.copy(shiftSwaps = api.shiftSwaps().requests, shiftSwapOptions = api.shiftSwapOptions()) }
    }
    fun clearSent() { mutable.update { it.copy(sentAbsence = null, sentVoucher = null, sentShiftSwap = null) } }
}
