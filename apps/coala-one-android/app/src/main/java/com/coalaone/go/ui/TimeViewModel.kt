package com.coalaone.go.ui

import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID
import javax.inject.Inject

data class TimeState(val options: TimeOptions? = null, val clockOffset: Long? = null, val unitId: String? = null,
    val today: LocalDate = LocalDate.now(), val month: YearMonth = YearMonth.now(), val markings: List<OwnMarking> = emptyList(), val shifts: List<OwnShift> = emptyList(),
    val adjustments: List<Adjustment> = emptyList(), val treatments: List<Treatment> = emptyList(), val truncated: Boolean = false, val last: MarkingResponse? = null, val sentAdjustment: Adjustment? = null)

/** Ponto: punch, today, history, receipts and adjustment requests, all through the web routes. Nothing is polled. */
@HiltViewModel class TimeViewModel @Inject constructor(private val repository: ApiRepository, private val saved: androidx.lifecycle.SavedStateHandle) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(TimeState())
    val state = mutable.asStateFlow()
    private val api get() = repository.api
    /**
     * The pending punch attempt: id and work date travel together and survive the process being killed, so a
     * retry after a lost answer is the same attempt even past midnight. Cleared only after the server answered.
     */
    private var attempt: Pair<String, String>?
        get() = saved.get<String>("attemptId")?.let { id -> saved.get<String>("attemptDate")?.let { id to it } }
        set(value) { saved["attemptId"] = value?.first; saved["attemptDate"] = value?.second }
    private fun serverRun(notice: String? = null, work: suspend () -> Unit) = run(notice) { try { work() } catch (cause: Exception) { throw Errors.withServerMessage(cause) } }

    /** Options of today and the month on screen; read when the screen opens and on pull-to-refresh. */
    fun load() = serverRun {
        val today = LocalDate.now()
        val options = api.timeOptions(today.toString())
        val offset = TimeRules.clockOffset(options.officialClock, android.os.SystemClock.elapsedRealtime())
        mutable.update { state -> state.copy(options = options, clockOffset = offset, today = today,
            unitId = state.unitId?.takeIf { id -> options.executionUnits.any { it.id == id } } ?: options.executionUnits.firstOrNull()?.id) }
        readMonth(mutable.value.month)
    }
    fun month(month: YearMonth) = serverRun { readMonth(month) }
    /** Back from the background: only the options and the official reading, so the clock and the block are current. */
    fun refreshClock() = serverRun {
        val options = api.timeOptions(LocalDate.now().toString())
        mutable.update { it.copy(options = options, clockOffset = TimeRules.clockOffset(options.officialClock, android.os.SystemClock.elapsedRealtime())) }
    }
    private suspend fun readMonth(month: YearMonth) {
        val (start, end) = TimeRules.monthRange(month)
        val key = month.toString()
        val markings = api.markings(start, end); val shifts = api.timeMonth(key); val adjustments = api.adjustments(key)
        mutable.update { it.copy(month = month, markings = markings.markings, truncated = markings.truncated || shifts.truncated, shifts = shifts.shifts, adjustments = adjustments.adjustments, treatments = adjustments.treatments) }
    }
    /** A new unit is a new attempt; the same attempt is resent until the server answers, so a retry never duplicates. */
    fun unit(id: String) { if (mutable.value.unitId != id) { attempt = null; mutable.update { it.copy(unitId = id) } } }
    fun record() = serverRun {
        var state = mutable.value
        // A block caused only by the official clock is read again on tap: the server may already be back.
        if (!TimeRules.canRecord(state.options, state.unitId) && state.options?.officialClock?.available != true) { refreshOptions(); state = mutable.value }
        require(TimeRules.canRecord(state.options, state.unitId)) { TimeRules.blockedReason(state.options) ?: "Escolha a unidade." }
        val zone = TimeRules.unitZone(state.options, state.unitId)
        val pending = attempt ?: (TimeRules.newAttempt() to TimeRules.workDate(officialNow(state), zone)).also { attempt = it }
        val result = try { api.mark(MarkingRequest(pending.first, pending.second, state.unitId!!)) }
        catch (cause: retrofit2.HttpException) {
            // 409: the attempt clashes with one already recorded. Start over from what the server holds.
            if (cause.code() == 409) { attempt = null; readMonth(YearMonth.now()) }
            throw cause
        }
        attempt = null
        mutable.update { it.copy(last = result) }
        readMonth(YearMonth.now())
    }
    /** Official time from the monotonic clock: changing the phone's hour does not move it. Phone time only without a reading. */
    private fun officialNow(state: TimeState) = state.clockOffset?.let { android.os.SystemClock.elapsedRealtime() + it } ?: System.currentTimeMillis()
    private suspend fun refreshOptions() {
        val options = api.timeOptions(LocalDate.now().toString())
        mutable.update { it.copy(options = options, clockOffset = TimeRules.clockOffset(options.officialClock, android.os.SystemClock.elapsedRealtime())) }
    }
    fun dismissLast() { mutable.update { it.copy(last = null) } }
    /** Downloads the PDF into the app cache (never shared storage) and hands the file to the screen to open or share. */
    fun receipt(receiptId: String, markedAt: String, nsr: Long, directory: File, then: (File) -> Unit) = serverRun {
        val file = withContext(Dispatchers.IO) {
            val folder = File(directory, "receipts").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
            File(folder, TimeRules.receiptFileName(markedAt, nsr)).also { target -> api.receipt(receiptId).use { body -> target.outputStream().use { body.byteStream().copyTo(it) } } }
        }
        then(file)
    }
    fun requestAdjustment(attemptId: String, workDate: String, kind: String, targetReceiptId: String?, newTime: String, reason: String) = serverRun("Pedido de ajuste enviado ao DP.") {
        val state = mutable.value
        val unitToday = LocalDate.parse(TimeRules.workDate(officialNow(state), TimeRules.unitZone(state.options, state.unitId)))
        val request = TimeRules.adjustmentRequest(attemptId, workDate, kind, targetReceiptId, newTime, state.unitId, reason, unitToday)
        val created = api.requestAdjustment(request).adjustment
        mutable.update { it.copy(sentAdjustment = created) }
        readMonth(YearMonth.from(LocalDate.parse(workDate)))
    }
    fun clearAdjustment() { mutable.update { it.copy(sentAdjustment = null) } }
}

data class RequestsState(val absenceOptions: AbsenceOptions? = null, val absences: List<AbsenceRequestRow> = emptyList(), val vouchers: List<VoucherRequest> = emptyList(),
    val preview: AbsencePreview? = null, val sentAbsence: AbsenceRequestRow? = null, val sentVoucher: VoucherRequest? = null)
/** Keys kept across retries of one absence request, so a repeated tap reuses the same draft and preparation. */
private data class AbsenceAttempt(val idempotencyKey: String = UUID.randomUUID().toString(), val proposedRequestId: String = UUID.randomUUID().toString(),
    val submitOperationId: String = UUID.randomUUID().toString(), var preparationIds: List<String> = emptyList(), var draft: AbsenceRequestRow? = null)

/** Solicitações: absence (with the two-step summary of the web) and transport voucher. */
@HiltViewModel class RequestsViewModel @Inject constructor(private val repository: ApiRepository) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(RequestsState())
    val state = mutable.asStateFlow()
    private val api get() = repository.api
    private var attempt: AbsenceAttempt? = null
    private fun serverRun(notice: String? = null, work: suspend () -> Unit) = run(notice) { try { work() } catch (cause: Exception) { throw Errors.withServerMessage(cause) } }

    fun load() = serverRun {
        val options = api.absenceOptions(); val absences = api.absences(); val vouchers = api.vouchers()
        mutable.update { it.copy(absenceOptions = options, absences = absences.requests, vouchers = vouchers.requests) }
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
    fun clearSent() { mutable.update { it.copy(sentAbsence = null, sentVoucher = null) } }
}
