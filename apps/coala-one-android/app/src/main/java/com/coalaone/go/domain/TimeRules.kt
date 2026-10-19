package com.coalaone.go.domain

import com.coalaone.go.data.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

/** One line of a day's sequence: an original punch, a punch the DP discarded, or one it included. */
data class DayPunch(val time: String, val nsr: Long?, val receiptId: String?, val receiptStatus: String?, val discarded: Boolean = false, val included: Boolean = false)

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
        options.officialClock?.available != true -> "Hora oficial indisponível. A batida fica bloqueada até ela voltar."
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
    /** Suggested by the order of the punches, as on the web; the person never has to classify a punch. */
    fun suggestedLabel(index: Int, expected: Int?): String = when {
        index == 0 -> "Entrada"
        expected != null && index == expected - 1 -> "Saída"
        expected != null && index >= expected -> "Batida extra"
        index % 2 == 1 -> "Saída p/ intervalo"
        else -> "Volta do intervalo"
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
    fun secondsOf(markedAt: String): String = runCatching { java.time.OffsetDateTime.parse(markedAt).format(clockFormat) }.getOrElse { markedAt.drop(11).take(8) }
    fun minuteOf(markedAt: String): String = runCatching { java.time.OffsetDateTime.parse(markedAt).format(minuteFormat) }.getOrElse { markedAt.drop(11).take(5) }
    /** A day as the DP treated it: discarded punches stay visible and struck, included ones are marked. */
    fun day(date: String, markings: List<OwnMarking>, treatments: List<Treatment>): List<DayPunch> {
        val ofDay = treatments.filter { it.workDate == date }
        val discarded = ofDay.filter { it.type == "discard" }.mapNotNull { it.originalReceiptId }.toSet()
        val originals = markings.filter { it.workDate == date }.map { DayPunch(minuteOf(it.markedAt), it.nsr, it.receiptId, it.receiptStatus, discarded = it.receiptId in discarded) }
        val included = ofDay.filter { it.type == "inclusion" && it.markedAt != null }.map { DayPunch(minuteOf(it.markedAt!!), null, null, null, included = true) }
        return (originals + included).sortedBy { it.time }
    }
    fun receiptFileName(markedAt: String, nsr: Long) = "comprovante-ponto-${markedAt.take(10)}-nsr-$nsr.pdf"

    /** Mirrors createAdjustmentSchema: what each kind needs, and the 10-character justification. */
    fun adjustmentRequest(attemptId: String, workDate: String, kind: String, targetReceiptId: String?, newTime: String, executionUnitId: String?, reason: String, today: LocalDate): AdjustmentRequest {
        val date = runCatching { LocalDate.parse(workDate) }.getOrNull()
        require(date != null) { "Escolha o dia." }
        require(!date.isAfter(today)) { "O ajuste vale para dias que já começaram." }
        require(kind in ADJUSTMENT_KINDS.map { it.first }) { "Escolha o tipo de ajuste." }
        require(kind == "include" || !targetReceiptId.isNullOrBlank()) { "Escolha a batida." }
        val time = newTime.trim()
        require(kind == "discard" || timePattern.matches(time)) { "Informe o horário no formato 00:00." }
        val text = reason.trim()
        require(text.length in 10..1000) { "A justificativa precisa ter ao menos 10 caracteres." }
        return AdjustmentRequest(attemptId, workDate, kind, targetReceiptId.takeIf { kind != "include" }, time.takeIf { kind != "discard" }, executionUnitId.takeIf { kind != "discard" && !it.isNullOrBlank() }, text)
    }

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
