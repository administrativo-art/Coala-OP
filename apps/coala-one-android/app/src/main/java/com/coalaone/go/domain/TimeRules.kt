package com.coalaone.go.domain

import com.coalaone.go.data.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/** One line of a day's sequence: an original punch, a punch the DP discarded, or one it included. */
data class DayPunch(val time: String, val nsr: Long?, val receiptId: String?, val receiptStatus: String?, val discarded: Boolean = false, val included: Boolean = false, val unitId: String? = null,
    val purpose: String? = null, val classificationSource: String? = null, val markedAt: String? = null)

/**
 * Rules of the Ponto and Solicitações screens, kept off the UI so they run in unit tests. They follow the web
 * "Registro de ponto" (src/features/dp/rep-p) and the server schemas; the server stays the authority.
 */
object TimeRules {
    /** Fallback when neither the unit nor the establishment says its zone: the zone of the São Luís units. */
    const val DEFAULT_ZONE = "America/Fortaleza"
    private val clockFormat = DateTimeFormatter.ofPattern("HH:mm:ss")
    private val minuteFormat = DateTimeFormatter.ofPattern("HH:mm")
    private val timePattern = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    private val ptBR = Locale.forLanguageTag("pt-BR")
    val ADJUSTMENT_KINDS = listOf("include" to "Esqueci de bater", "discard" to "Bati errado ou em duplicidade", "correct" to "O horário está errado")
    val ADJUSTMENT_HINTS = mapOf("include" to "Inclui um horário que faltou. Você informa a hora.", "discard" to "Pede para desconsiderar uma batida.", "correct" to "Desconsidera a batida e inclui o horário certo.")
    val ADJUSTMENT_STATUS = mapOf("in_review" to "Em análise", "approved" to "Aprovado · tratado no ponto", "rejected" to "Recusado", "cancelled" to "Cancelado")
    val ABSENCE_STATUS = mapOf("draft" to "Rascunho", "submitted" to "Enviada", "in_review" to "Em análise", "adjustments_requested" to "Ajustes pedidos", "approved" to "Aprovada", "rejected" to "Recusada", "cancelled" to "Cancelada")
    val VOUCHER_ACTIONS = listOf("activate" to "Adesão", "change" to "Alteração", "suspend" to "Suspensão", "reactivate" to "Reativação")
    val VOUCHER_STATUS = mapOf("pending" to "Aguardando análise", "approved" to "Aprovada", "rejected" to "Rejeitada", "cancelled" to "Cancelada")

    fun zone(id: String?): ZoneId = runCatching { ZoneId.of(id ?: DEFAULT_ZONE) }.getOrDefault(ZoneId.of(DEFAULT_ZONE))
    /** The punch is stamped in the zone of the chosen unit; the establishment zone covers units without one. */
    fun unitZone(options: TimeOptions?, unitId: String?): ZoneId = zone(options?.executionUnits?.firstOrNull { it.id == unitId }?.timeZone ?: options?.officialClock?.timeZone)
    /** Server time minus the reference clock (monotonic on the phone) when the official reading arrived; the screen adds it back. */
    fun clockOffset(clock: OfficialClock?, receivedAtMillis: Long): Long? = clock?.takeIf { it.available }?.instant?.let { runCatching { Instant.parse(it).toEpochMilli() - receivedAtMillis }.getOrNull() }
    fun clockText(epochMillis: Long, zone: ZoneId): String = Instant.ofEpochMilli(epochMillis).atZone(zone).format(clockFormat)
    /** Civil date in the unit zone, the same date the server checks; the phone date would refuse punches near midnight. */
    fun workDate(epochMillis: Long, zone: ZoneId): String = Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalDate().toString()
    fun utcOffsetLabel(zone: ZoneId, epochMillis: Long): String {
        val seconds = zone.rules.getOffset(Instant.ofEpochMilli(epochMillis)).totalSeconds
        val sign = if (seconds < 0) "−" else "+"; val absolute = Math.abs(seconds)
        return "UTC$sign%02d:%02d".format(absolute / 3600, absolute % 3600 / 60)
    }
    fun canRecord(options: TimeOptions?, unitId: String?) = options != null && options.eligible && options.markingEnabled && options.officialClock?.available == true && options.executionUnits.any { it.id == unitId }
    /** Why the punch button is off, in words; null when it can be used. */
    fun blockedReason(options: TimeOptions?): String? = when {
        options == null -> null
        !options.eligible -> "O registro de ponto vale para vínculos CLT e de aprendiz ativos hoje."
        !options.markingEnabled -> "O registro de ponto ainda não foi liberado para você."
        options.officialClock?.available != true -> "Hora Legal Brasileira indisponível. A batida fica bloqueada até ela voltar."
        options.executionUnits.isEmpty() -> "Nenhuma unidade de trabalho para hoje. Fale com o DP."
        else -> null
    }
    fun newAttempt(): String = UUID.randomUUID().toString()

    /** Expected punches of a shift: the registered count, else 2 plus 2 per planned pause; null while pauses are open. */
    fun expectedPunches(shift: OwnShift?): Int? {
        if (shift == null || shift.type != "work") return null
        shift.expectedPunches?.let { return it }
        if (shift.breakType == null || shift.breakType == "none") return 2
        val pauses = when { shift.breakType == "fixed" -> shift.breakSegments?.size ?: 1; shift.breakSplit == "multiple" -> shift.breakPauseCount; else -> 1 }
        return pauses?.let { 2 + 2 * it }
    }
    val PUNCH_PURPOSES = listOf("journey_start" to "Início da jornada", "break_start" to "Início do intervalo",
        "break_end" to "Volta do intervalo", "journey_end" to "Fim da jornada")
    fun purposeLabel(value: String?) = PUNCH_PURPOSES.firstOrNull { it.first == value }?.second ?: "Classificação pendente"
    /** Suggestion is organizational. It never authorizes, blocks or changes the fiscal marking. */
    fun suggestedPurpose(markings: List<OwnMarking>, shift: OwnShift?): String {
        val last = markings.lastOrNull()?.classification?.purpose
        if (last == null) return "journey_start"
        return when (last) {
            "journey_start" -> "break_start"
            "break_start" -> "break_end"
            "break_end" -> {
                val completed = markings.count { it.classification?.purpose == "break_end" }
                val planned = when {
                    shift?.breakType == "fixed" -> shift.breakSegments?.size ?: 1
                    shift?.breakSplit == "multiple" -> shift.breakPauseCount
                    else -> 1
                }
                if (planned != null && completed < planned) "break_start"
                else if (planned == null && shift?.breakDurationMinutes != null) {
                    var start: java.time.OffsetDateTime? = null
                    var used = 0L
                    markings.forEach { marking ->
                        val instant = markingDateTime(marking.markedAt)
                        if (marking.classification?.purpose == "break_start") start = instant
                        val pauseStart = start
                        if (marking.classification?.purpose == "break_end" && pauseStart != null && instant != null) {
                            used += java.time.Duration.between(pauseStart, instant).toMinutes().coerceAtLeast(0); start = null
                        }
                    }
                    if (used < shift.breakDurationMinutes.toLong()) "break_start" else "journey_end"
                } else "journey_end"
            }
            else -> "journey_start"
        }
    }
    fun suggestedLabel(index: Int, expected: Int?): String = when {
        index == 0 -> "Entrada"
        expected != null && index == expected - 1 -> "Saída"
        expected != null && index >= expected -> "Batida extra"
        index % 2 == 1 -> "Saída p/ intervalo"
        else -> "Volta do intervalo"
    }
    private fun clockMinutes(value: String) = value.take(2).toInt() * 60 + value.drop(3).take(2).toInt()
    private fun clockSpan(start: String, end: String): Int {
        val span = clockMinutes(end) - clockMinutes(start)
        return if (span < 0) span + 1440 else span
    }
    fun plannedBreakMinutes(shift: OwnShift?): Int {
        if (shift == null || shift.type != "work" || shift.breakType == "none") return 0
        shift.breakDurationMinutes?.takeIf { it > 0 }?.let { return it }
        if (shift.breakType != "fixed") return 0
        shift.breakSegments?.takeIf { it.isNotEmpty() }?.let { return it.sumOf { segment -> clockSpan(segment.start, segment.end) } }
        return if (shift.breakStart != null && shift.breakEnd != null) clockSpan(shift.breakStart, shift.breakEnd) else 0
    }
    fun plannedWorkMinutes(shift: OwnShift?): Int? {
        if (shift == null || shift.type != "work" || shift.startTime == null || shift.endTime == null) return null
        return (clockSpan(shift.startTime, shift.endTime) - plannedBreakMinutes(shift)).coerceAtLeast(0)
    }
    /** Accepts both the REP-P fiscal offset (-0300) and the ISO offset (-03:00). */
    private fun markingDateTime(markedAt: String) = runCatching {
        java.time.OffsetDateTime.parse(markedAt.replace(Regex("([+-]\\d{2})(\\d{2})$"), "$1:$2"))
    }.getOrNull()
    fun markingInstant(markedAt: String) = markingDateTime(markedAt)?.toInstant()
    private fun instantOf(punch: DayPunch) = punch.markedAt?.let(::markingInstant)
    private fun orderedPunches(punches: List<DayPunch>) = punches.filter { !it.discarded }
        .sortedWith(compareBy<DayPunch> { instantOf(it) ?: java.time.Instant.MAX }.thenBy { it.time })
    private fun punchSpan(start: DayPunch, end: DayPunch): Int {
        val first = instantOf(start); val last = instantOf(end)
        return if (first != null && last != null) java.time.Duration.between(first, last).toMinutes().coerceAtLeast(0).toInt()
        else clockSpan(start.time, end.time)
    }
    fun workedMinutes(punches: List<DayPunch>): Int? {
        val active = orderedPunches(punches)
        if (active.size < 2 || active.size % 2 != 0) return null
        return active.chunked(2).sumOf { pair -> punchSpan(pair[0], pair[1]) }
    }
    fun recordedBreakMinutes(punches: List<DayPunch>): Int {
        val active = orderedPunches(punches)
        val declared = active.filter { it.purpose == "break_start" || it.purpose == "break_end" }
        if (declared.isNotEmpty()) {
            var start: DayPunch? = null
            var total = 0
            declared.forEach { punch ->
                if (punch.purpose == "break_start") start = punch
                else if (punch.purpose == "break_end" && start != null) { total += punchSpan(start!!, punch); start = null }
            }
            return total
        }
        return active.drop(1).dropLast(1).chunked(2).filter { it.size == 2 }.sumOf { punchSpan(it[0], it[1]) }
    }
    /** Aviso organizacional; nunca impede nem altera a marca fiscal. */
    fun breakIssue(markings: List<OwnMarking>, shift: OwnShift?): String? {
        val total = plannedBreakMinutes(shift)
        if (total <= 0 || markings.lastOrNull()?.classification?.purpose != "journey_end") return null
        var start: java.time.OffsetDateTime? = null
        var used = 0L
        markings.forEach { marking ->
            val instant = markingDateTime(marking.markedAt)
            if (marking.classification?.purpose == "break_start") start = instant
            val pauseStart = start
            if (marking.classification?.purpose == "break_end" && pauseStart != null && instant != null) {
                used += java.time.Duration.between(pauseStart, instant).toMinutes().coerceAtLeast(0); start = null
            }
        }
        return if (used < total) "Jornada finalizada com ${used} de $total min de intervalo. A batida permanece válida e o dia vai para conferência." else null
    }
    fun shiftText(shift: OwnShift?): String? = when {
        shift == null -> null
        shift.type == "day_off" -> "Folga"
        else -> listOfNotNull(shift.startTime?.let { start -> shift.endTime?.let { "$start–$it" } }, shift.shiftName).joinToString(" · ").ifBlank { null }
    }
    /** The break planned for the day, so the person sees it next to the punch button. */
    fun breakText(shift: OwnShift?): String? {
        if (shift == null || shift.type != "work") return null
        val minutes = shift.breakDurationMinutes
        return when (shift.breakType) {
            "fixed" -> shift.breakSegments?.takeIf { it.size > 1 }?.let { segments -> "Intervalo fixo: " + segments.joinToString(" e ") { "${it.start}–${it.end}" } }
                ?: shift.breakStart?.let { start -> shift.breakEnd?.let { "Intervalo fixo: $start–$it" } }
            "staggered" -> shift.breakWindowStart?.let { start -> shift.breakWindowEnd?.let { end -> "Janela ${start}–${end}" + (minutes?.let { " · $it min" } ?: "") } }
            "flexible" -> minutes?.let { if (shift.breakSplit == "multiple") "$it min de intervalo, em pausas" else "$it min de intervalo, no horário que preferir" }
            else -> null
        }
    }

    fun monthRange(month: YearMonth): Pair<String, String> = month.atDay(1).toString() to month.atEndOfMonth().toString()
    fun secondsOf(markedAt: String): String = markingDateTime(markedAt)?.format(clockFormat) ?: markedAt.drop(11).take(8)
    fun minuteOf(markedAt: String): String = markingDateTime(markedAt)?.format(minuteFormat) ?: markedAt.drop(11).take(5)
    /** A day as the DP treated it: discarded punches stay visible and struck, included ones are marked. */
    fun day(date: String, markings: List<OwnMarking>, treatments: List<Treatment>): List<DayPunch> {
        val ofDay = treatments.filter { it.workDate == date }
        val discarded = ofDay.filter { it.type == "discard" }.mapNotNull { it.originalReceiptId }.toSet()
        val originals = markings.filter { it.workDate == date }.map { DayPunch(minuteOf(it.markedAt), it.nsr, it.receiptId, it.receiptStatus, discarded = it.receiptId in discarded, unitId = it.executionUnitId,
            purpose = it.classification?.purpose, classificationSource = it.classification?.source, markedAt = it.markedAt) }
        val included = ofDay.filter { it.type == "inclusion" && it.markedAt != null }.map { DayPunch(minuteOf(it.markedAt!!), null, null, null, included = true, unitId = it.executionUnitId, markedAt = it.markedAt) }
        return (originals + included).sortedWith(compareBy<DayPunch> { instantOf(it) ?: java.time.Instant.MAX }.thenBy { it.time })
    }
    fun receiptFileName(markedAt: String, nsr: Long) = "comprovante-ponto-${markedAt.take(10)}-nsr-$nsr.pdf"
    fun durationText(minutes: Int, signed: Boolean = false): String {
        val sign = if (signed && minutes > 0) "+" else if (minutes < 0) "−" else ""
        val absolute = Math.abs(minutes)
        return "$sign${absolute / 60}h${String.format("%02d", absolute % 60)}"
    }
    fun bankNatureText(nature: String) = when (nature) {
        "bank_credit" -> "Crédito no banco"
        "bank_debit" -> "Débito no banco"
        "payroll_overtime" -> "Hora extra para a folha"
        "payroll_discount" -> "Desconto para a folha"
        else -> "A conferir pelo DP"
    }
    fun bankReasonText(reason: String) = when (reason) {
        "worked_more" -> "Tempo trabalhado acima da jornada prevista"
        "worked_less" -> "Tempo trabalhado abaixo da jornada prevista"
        else -> reason.replace('_', ' ').replaceFirstChar { it.titlecase(ptBR) }
    }

    /** Mirrors createAdjustmentSchema: one request may group up to eight operations of the same nature. */
    fun adjustmentRequest(attemptId: String, workDate: String, operations: List<AdjustmentRequestOperation>, reason: String, today: LocalDate): AdjustmentRequest {
        val date = runCatching { LocalDate.parse(workDate) }.getOrNull()
        require(date != null) { "Escolha o dia." }
        require(!date.isAfter(today)) { "O ajuste vale para dias que já começaram." }
        require(operations.isNotEmpty()) { "Inclua ao menos uma alteração." }
        require(operations.size <= 8) { "Um pedido aceita até oito alterações." }
        require(operations.map { it.kind }.distinct().size == 1) { "Um pedido reúne apenas alterações do mesmo tipo." }
        val kinds = ADJUSTMENT_KINDS.map { it.first }
        operations.forEach { operation ->
            require(operation.kind in kinds) { "Escolha o tipo de ajuste." }
            require(operation.kind == "include" || !operation.targetReceiptId.isNullOrBlank()) { "Escolha a batida." }
            require(operation.kind == "discard" || timePattern.matches(operation.newTime.orEmpty().trim())) { "Informe o horário no formato 00:00." }
        }
        val targets = operations.mapNotNull { it.targetReceiptId }
        require(targets.distinct().size == targets.size) { "A mesma batida foi escolhida mais de uma vez." }
        val times = operations.mapNotNull { it.newTime?.trim() }
        require(times.distinct().size == times.size) { "O mesmo horário foi informado mais de uma vez." }
        val text = reason.trim()
        require(text.length in 10..1000) { "A justificativa precisa ter ao menos 10 caracteres." }
        return AdjustmentRequest(attemptId, workDate, operations.map { it.copy(newTime = it.newTime?.trim(),
            executionUnitId = it.executionUnitId.takeIf { id -> it.kind != "discard" && !id.isNullOrBlank() }) }, text)
    }

    fun adjustmentRequest(attemptId: String, workDate: String, kind: String, targetReceiptId: String?, newTime: String, executionUnitId: String?, reason: String, today: LocalDate) =
        adjustmentRequest(attemptId, workDate, listOf(AdjustmentRequestOperation(kind, targetReceiptId.takeIf { kind != "include" },
            newTime.takeIf { kind != "discard" }, executionUnitId.takeIf { kind != "discard" })), reason, today)

    /** Mirrors absenceRequestPreviewSchema: dates in order, at most 366 days, hours only in the hour unit. */
    fun absencePeriod(type: AbsenceOption?, unit: String, startDate: String, endDate: String, startTime: String, endTime: String): AbsencePeriod {
        require(type != null) { "Escolha o tipo de ausência." }
        require(unit in type.units) { "Este tipo não aceita a unidade escolhida." }
        val start = runCatching { LocalDate.parse(startDate) }.getOrNull(); val end = runCatching { LocalDate.parse(endDate) }.getOrNull()
        require(start != null && end != null) { "Informe o início e o fim." }
        require(!end.isBefore(start)) { "O fim deve ser igual ou posterior ao início." }
        require(java.time.temporal.ChronoUnit.DAYS.between(start, end) < 366) { "O período deve ter no máximo 366 dias." }
        if (unit == "hour") {
            require(timePattern.matches(startTime.trim()) && timePattern.matches(endTime.trim())) { "Informe os dois horários no formato 00:00." }
            require(start != end || LocalTime.parse(endTime.trim()).isAfter(LocalTime.parse(startTime.trim()))) { "Para período noturno, informe a data seguinte de término." }
            return AbsencePeriod(type.id, startDate, endDate, unit, startTime.trim(), endTime.trim())
        }
        return AbsencePeriod(type.id, startDate, endDate, unit)
    }
    fun absenceReason(text: String): String? = text.trim().takeIf { it.isNotEmpty() }?.also { require(it.length in 10..1000) { "O motivo precisa ter ao menos 10 caracteres." } }
    /** The preparation route accepts up to five PDF, JPEG or PNG files of up to 10 MB each. */
    fun validateAbsenceFiles(files: List<Document>, required: Boolean) {
        require(!required || files.isNotEmpty()) { "Este tipo exige anexar o atestado ou documento." }
        require(files.size <= 5) { "Anexe até cinco arquivos." }
        require(files.all { it.bytes.isNotEmpty() && it.bytes.size <= 10 * 1024 * 1024 && it.mimeType in listOf("application/pdf", "image/jpeg", "image/png") }) { "Use PDF, JPEG ou PNG de até 10 MB." }
    }
    fun quantityText(value: Double?, unit: String): String = when {
        value == null -> "Calculada na análise"
        unit == "hour" -> "${Rules.quantityText(value)} h"
        value == 1.0 -> "1 dia"
        else -> "${Rules.quantityText(value)} dias"
    }
    fun tacitText(days: Int?): String? = days?.let { "Sem análise em $it ${if (it == 1) "dia" else "dias"}, a etapa é aprovada por decurso de prazo." }
    fun voucherRequest(action: String, details: String): VoucherRequestCreate {
        require(action in VOUCHER_ACTIONS.map { it.first }) { "Escolha o pedido." }
        require(details.trim().length <= 1500) { "Detalhes: máximo de 1500 caracteres." }
        return VoucherRequestCreate(action, details.trim())
    }
}
