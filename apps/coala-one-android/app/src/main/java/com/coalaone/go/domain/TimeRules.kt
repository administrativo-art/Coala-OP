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
    val purpose: String? = null, val classificationSource: String? = null, val markedAt: String? = null, val pilot: Boolean = false, val location: MarkingLocation? = null)

enum class BreakLevel { NEUTRAL, INFO, WARN, DANGER, OK }
data class BreakStatus(val level: BreakLevel, val headline: String, val detail: String?, val usedMinutes: Int,
    val totalMinutes: Int, val pausesDone: Int, val plannedPauses: Int?, val inPause: Boolean,
    val countdownSeconds: Long? = null, val countdownLabel: String? = null, val usedSeconds: Long = usedMinutes * 60L)
enum class DaySummaryState { IN_PROGRESS, COMPLETE, PENDING }
data class DaySummary(val state: DaySummaryState, val workedMinutes: Int? = null, val breakMinutes: Int? = null,
    val plannedBreakMinutes: Int? = null, val shiftDifferenceMinutes: Int? = null, val message: String? = null)
/** Where the clock on screen comes from: the confirmed Hora Legal, the anchor of a valid local permit, or nothing. */
enum class ClockSource { OFFICIAL, LOCAL_PERMIT, NONE }
/** How a day reads in Registros; the monthly closing remains the authority. */
enum class RecordDayState { COMPLETE, IN_PROGRESS, REVIEW, MISSING, EMPTY }
data class HomeWorkContext(val date: String, val shift: OwnShift?, val markings: List<OwnMarking>)

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
    fun canPreserve(options: TimeOptions?, unitId: String?, offlineReady: Boolean) = offlineReady && options != null
        && options.eligible && options.markingEnabled && options.officialClock?.available == false
        && options.officialClock?.issue == "REP_P_TIME_UNAVAILABLE"
        && options.executionUnits.any { it.id == unitId }
    /** Offline preservation requires a still-valid local permit; cached options may contain the permit anchor as available. */
    fun canPreserveOffline(options: TimeOptions?, unitId: String?, offlineReady: Boolean) = offlineReady && options != null
        && options.eligible && options.markingEnabled && options.executionUnits.any { it.id == unitId }
    /** Why the punch button is off, in words; null when it can be used. */
    fun blockedReason(options: TimeOptions?, offlineReady: Boolean = false): String? = when {
        options == null -> null
        !options.eligible -> "O registro de ponto vale para vínculos CLT e de aprendiz ativos hoje."
        !options.markingEnabled -> "O registro de ponto ainda não foi liberado para você."
        options.officialClock?.available == false && options.officialClock?.issue == "REP_P_TIME_UNAVAILABLE" ->
            if (offlineReady) null else "Não foi possível registrar agora. Tente novamente em instantes."
        options.officialClock?.available != true -> "O registro está indisponível porque a unidade ou sua fonte de horário ainda não está pronta. Tente novamente ou fale com o DP."
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
    /** Visual cycle only: it never creates or blocks a punch. Overnight and unknown shifts remain open. */
    fun autoJourneyCycleClosed(workDate: String, shift: OwnShift?, markings: List<OwnMarking>, nowEpochMillis: Long, zone: ZoneId): Boolean {
        if (shift == null || shift.type != "work" || shift.overnight || shift.endTime == null) return false
        if (markings.sortedBy { markingInstant(it.markedAt) }.lastOrNull()?.classification?.purpose != "journey_end") return false
        val closesAt = LocalDate.parse(workDate).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        return nowEpochMillis >= closesAt
    }
    /** Times the shift plans for each expected punch, null where it plans none (flexible break). */
    fun plannedPunchTimes(shift: OwnShift?): List<String?> {
        val expected = expectedPunches(shift) ?: return emptyList()
        val planned = shift ?: return emptyList()
        val middle: List<String?> = when {
            expected == 2 -> emptyList()
            planned.breakType == "fixed" && !planned.breakSegments.isNullOrEmpty() -> planned.breakSegments.flatMap { listOf(it.start, it.end) }
            planned.breakType == "fixed" -> listOf(planned.breakStart, planned.breakEnd)
            else -> List(expected - 2) { null }
        }
        return (listOf(planned.startTime) + middle + listOf(planned.endTime)).take(expected).let { it + List(expected - it.size) { null } }
    }
    /** "2ª de 4 · Início do intervalo": position of the next punch and its suggested purpose. */
    fun nextPunchText(done: Int, shift: OwnShift?, purpose: String?): String {
        val expected = expectedPunches(shift)
        val position = when {
            expected != null && done >= expected -> "Batida extra"
            expected != null -> "${done + 1}ª de $expected"
            else -> "${done + 1}ª batida"
        }
        return listOfNotNull(position, purpose?.let(::purposeLabel)).joinToString(" · ")
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
    fun plannedPauses(shift: OwnShift): Int? = when {
        shift.breakType == "fixed" -> shift.breakSegments?.size ?: 1
        shift.breakSplit == "multiple" -> shift.breakPauseCount
        else -> 1
    }

    /** Live organizational guidance. It never blocks or changes the fiscal punch. */
    fun breakStatus(shift: OwnShift?, markings: List<OwnMarking>, nowEpochMillis: Long, zone: ZoneId): BreakStatus? {
        if (shift == null || shift.type != "work" || shift.breakType == null || shift.breakType == "none" || shift.endTime == null) return null
        val total = plannedBreakMinutes(shift)
        if (total <= 0) return null
        val planned = plannedPauses(shift)
        fun result(level: BreakLevel, headline: String, detail: String?, used: Int = 0, pauses: Int = 0,
            inPause: Boolean = false, countdown: Long? = null, countdownLabel: String? = null, usedExact: Long = used * 60L) =
            BreakStatus(level, headline, detail, used, total, pauses, planned, inPause, countdown, countdownLabel, usedExact)
        if (markings.any { it.classification?.purpose == null }) return result(BreakLevel.NEUTRAL,
            "Classifique as batidas para acompanhar o intervalo",
            "A classificação organiza os avisos e pode ser alterada sem modificar o horário registrado.")

        data class ClosedPause(val seconds: Long)
        val ordered = markings.sortedBy { markingInstant(it.markedAt) }
        val closed = mutableListOf<ClosedPause>()
        var pauseStart: Instant? = null
        ordered.forEach { marking ->
            val instant = markingInstant(marking.markedAt) ?: return@forEach
            when (marking.classification?.purpose) {
                "break_start" -> pauseStart = instant
                "break_end" -> pauseStart?.let { start ->
                    closed += ClosedPause(java.time.Duration.between(start, instant).seconds.coerceAtLeast(0)); pauseStart = null
                }
            }
        }
        val now = Instant.ofEpochMilli(nowEpochMillis)
        val closedSeconds = closed.sumOf { it.seconds }
        val currentSeconds = pauseStart?.let { java.time.Duration.between(it, now).seconds.coerceAtLeast(0) } ?: 0L
        val usedSeconds = closedSeconds + currentSeconds
        val used = (usedSeconds / 60).toInt()
        val countdownSeconds = total * 60L - usedSeconds
        val remainingSeconds = countdownSeconds.coerceAtLeast(0)
        val remaining = ((remainingSeconds + 59) / 60).toInt()
        val inPause = pauseStart != null
        val progress = if (planned == 1) null else "Usados $used de $total min · ${closed.size}" +
            (planned?.let { " de $it" } ?: "") + " ${if (closed.size == 1 && planned == null) "pausa" else "pausas"}"
        val tolerance = shift.toleranceMinutes ?: 0
        val journeyEnded = ordered.lastOrNull()?.classification?.purpose == "journey_end"
        if (journeyEnded && used < total) return result(BreakLevel.DANGER, "Jornada finalizada sem o intervalo completo",
            "Foram classificados $used de $total min de intervalo. A batida continua válida e o dia segue para conferência.", used, closed.size)
        if (usedSeconds > (total + tolerance) * 60L) return result(BreakLevel.DANGER, "Intervalo passou de $total min ($used min)",
            if (tolerance > 0) "Tolerância de $tolerance min da jornada excedida." else "A jornada não tem tolerância.",
            used, closed.size, inPause, if (inPause) countdownSeconds else null, "Intervalo", usedSeconds)

        val nowZoned = now.atZone(zone)
        val startMinute = shift.startTime?.let(::clockMinutes) ?: 0
        fun timeline(value: String): Int {
            val minute = clockMinutes(value)
            return if (shift.overnight && minute < startMinute) minute + 1440 else minute
        }
        var nowMinute = nowZoned.hour * 60 + nowZoned.minute
        if (shift.overnight && nowMinute < startMinute) nowMinute += 1440
        fun hhmm(minute: Int): String {
            val normalized = Math.floorMod(minute, 1440)
            return String.format(Locale.ROOT, "%02d:%02d", normalized / 60, normalized % 60)
        }
        fun inMinutes(value: Int) = if (value <= 0) "agora" else "em $value min"
        fun left(value: Int) = if (value == 1) "falta 1 min" else "faltam $value min"

        if (shift.breakType == "fixed") {
            val segments = shift.breakSegments?.takeIf { it.isNotEmpty() }
                ?: if (shift.breakStart != null && shift.breakEnd != null) listOf(BreakSegment(shift.breakStart, shift.breakEnd)) else emptyList()
            if (segments.isEmpty()) return null
            if (closed.size >= segments.size && !inPause) return result(BreakLevel.OK, "Intervalo feito · $used min", null, used, closed.size)
            val index = closed.size.coerceAtMost(segments.lastIndex)
            val segment = segments[index]
            val start = timeline(segment.start)
            var end = timeline(segment.end)
            if (end < start) end += 1440
            val label = if (segments.size > 1) "${index + 1}ª pausa " else "Intervalo "
            if (inPause) {
                val secondsToEnd = (end - nowMinute) * 60L - nowZoned.second
                val back = Math.ceil(secondsToEnd / 60.0).toInt()
                val passed = Math.ceil(kotlin.math.abs(secondsToEnd) / 60.0).toInt()
                return result(if (secondsToEnd < -tolerance * 60L) BreakLevel.DANGER else if (secondsToEnd <= 120) BreakLevel.WARN else BreakLevel.INFO,
                    if (secondsToEnd < 0) "Passou do fim do intervalo há $passed min" else "Em intervalo · volte às ${segment.end} (${left(back.coerceAtLeast(0))})",
                    progress, used, closed.size, true, countdownSeconds, "Intervalo", usedSeconds)
            }
            if (nowMinute > end) return result(BreakLevel.DANGER, "$label${segment.start}–${segment.end} não foi feita",
                "Registre a saída para o intervalo assim que puder.", used, closed.size)
            if (nowMinute >= start) return result(BreakLevel.WARN, "${label}começou às ${segment.start} · termina às ${segment.end}",
                "Registre a saída para o intervalo.", used, closed.size)
            val ahead = start - nowMinute
            return result(if (ahead <= 15) BreakLevel.INFO else BreakLevel.NEUTRAL,
                "$label${segment.start}–${segment.end} · começa ${inMinutes(ahead)}", progress, used, closed.size)
        }

        if (remainingSeconds == 0L && !inPause) return result(BreakLevel.OK, "Intervalo feito · $used min", null, used, closed.size)
        if (!inPause && shift.breakSplit == "multiple" && shift.breakMinPauseMinutes != null &&
            closed.lastOrNull()?.seconds?.let { it < shift.breakMinPauseMinutes * 60L } == true) {
            val last = (closed.last().seconds / 60).toInt()
            return result(BreakLevel.WARN, "Pausa de $last min abaixo do mínimo de ${shift.breakMinPauseMinutes} min",
                "A batida continua válida. Complete o tempo de intervalo previsto nas próximas pausas.", used, closed.size)
        }
        val windowStart = if (shift.breakType == "staggered") shift.breakWindowStart?.let(::timeline) else null
        val windowEnd = if (shift.breakType == "staggered") shift.breakWindowEnd?.let(::timeline) else null
        val endMinute = timeline(shift.endTime)
        val limit = minOf(windowEnd ?: Int.MAX_VALUE, endMinute) - remaining
        val where = if (windowEnd != null) "dentro da janela" else "antes do fim do turno"
        if (inPause) {
            val currentPauseSeconds = currentSeconds
            return result(if (remainingSeconds <= 120) BreakLevel.WARN else BreakLevel.INFO,
                if (planned == 1) "Em intervalo · volte às ${hhmm(nowMinute + remaining)} (${left(remaining)})"
                else "Em pausa há ${(currentPauseSeconds / 60)} min · restam $remaining min de intervalo",
                progress, used, closed.size, true, countdownSeconds, "Intervalo", usedSeconds)
        }
        if (windowStart != null && nowMinute < windowStart) {
            val ahead = windowStart - nowMinute
            return result(if (ahead <= 15) BreakLevel.INFO else BreakLevel.NEUTRAL,
                "Janela ${shift.breakWindowStart}–${shift.breakWindowEnd} abre ${inMinutes(ahead)}", "Inicie o intervalo até ${hhmm(limit)}.", used, closed.size)
        }
        val toLimit = limit - nowMinute
        if (toLimit < 0) return result(BreakLevel.DANGER,
            if (windowEnd != null && nowMinute > windowEnd) "A janela fechou sem o intervalo completo" else "Limite para iniciar passou (era ${hhmm(limit)})",
            "Faltam $remaining min de intervalo.", used, closed.size)
        return result(if (toLimit <= 10) BreakLevel.WARN else if (windowEnd != null) BreakLevel.INFO else BreakLevel.NEUTRAL,
            "${if (closed.isNotEmpty()) "Faltam $remaining min de intervalo" else "Faça $total min de intervalo"} · inicie até ${hhmm(limit)}",
            if (toLimit <= 10) "Faltam $toLimit min para o limite $where." else progress ?: "Limite $where.", used, closed.size)
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
    /** Exact elapsed time for the visual marker placed between the two interval punches. */
    fun intervalSeconds(start: DayPunch, end: DayPunch): Long? {
        val first = instantOf(start)
        val last = instantOf(end)
        if (first != null && last != null) return java.time.Duration.between(first, last).seconds.coerceAtLeast(0)
        if (!timePattern.matches(start.time) || !timePattern.matches(end.time)) return null
        return clockSpan(start.time, end.time) * 60L
    }
    fun workedMinutes(punches: List<DayPunch>): Int? {
        val active = orderedPunches(punches)
        if (active.size < 2 || active.size % 2 != 0) return null
        return active.chunked(2).sumOf { pair -> punchSpan(pair[0], pair[1]) }
    }
    /** Worked time of a journey still open, up to now. Null when the sequence needs conferência. Preliminary. */
    fun workedSoFarMinutes(punches: List<DayPunch>, nowEpochMillis: Long): Int? {
        val active = orderedPunches(punches)
        if (active.isEmpty() || active.any { it.purpose == null } || !validPurposeSequence(active)) return null
        val closed = active.chunked(2).filter { it.size == 2 }.sumOf { pair -> punchSpan(pair[0], pair[1]) }
        if (active.size % 2 == 0) return closed
        val start = instantOf(active.last()) ?: return null
        return closed + java.time.Duration.between(start, java.time.Instant.ofEpochMilli(nowEpochMillis)).toMinutes().coerceAtLeast(0).toInt()
    }
    /** One day of Registros: its reading and, when the journey is complete, the worked time. */
    fun recordDay(date: String, markings: List<OwnMarking>, shift: OwnShift?, treatments: List<Treatment>, today: LocalDate): Pair<RecordDayState, Int?> {
        val summary = daySummary(date, markings, shift, treatments)
        val past = runCatching { LocalDate.parse(date).isBefore(today) }.getOrDefault(false)
        return when {
            summary == null -> (if (past && shift?.type == "work") RecordDayState.MISSING else RecordDayState.EMPTY) to null
            summary.state == DaySummaryState.COMPLETE -> RecordDayState.COMPLETE to summary.workedMinutes
            summary.state == DaySummaryState.IN_PROGRESS && !past -> RecordDayState.IN_PROGRESS to null
            else -> RecordDayState.REVIEW to null
        }
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
    private fun validPurposeSequence(active: List<DayPunch>): Boolean {
        if (active.firstOrNull()?.purpose != "journey_start") return false
        var inBreak = false
        active.drop(1).forEachIndexed { index, punch ->
            val last = index == active.size - 2
            when {
                !inBreak && punch.purpose == "break_start" -> inBreak = true
                inBreak && punch.purpose == "break_end" -> inBreak = false
                !inBreak && punch.purpose == "journey_end" && last -> Unit
                else -> return false
            }
        }
        return true
    }
    private fun summarizeDay(punches: List<DayPunch>, shift: OwnShift?): DaySummary? {
        val active = orderedPunches(punches)
        if (active.isEmpty()) return null
        if (active.any { it.purpose == null }) return DaySummary(DaySummaryState.PENDING,
            message = "Classifique as batidas para calcular o resumo.")
        if (!validPurposeSequence(active)) return DaySummary(DaySummaryState.PENDING,
            message = "A sequência de batidas precisa de conferência.")
        val ended = active.lastOrNull()?.purpose == "journey_end"
        if (!ended) return DaySummary(DaySummaryState.IN_PROGRESS,
            message = if (active.lastOrNull()?.purpose == "break_start") "Intervalo em andamento" else "Jornada em andamento")
        val worked = workedMinutes(punches) ?: return DaySummary(DaySummaryState.PENDING,
            message = "A sequência de batidas precisa de conferência.")
        val planned = plannedWorkMinutes(shift)
        return DaySummary(DaySummaryState.COMPLETE, worked, recordedBreakMinutes(punches),
            plannedBreakMinutes(shift), planned?.let { worked - it })
    }
    /** Compact, preliminary view of a day. The monthly closing remains the authority for the final balance. */
    fun daySummary(date: String, markings: List<OwnMarking>, shift: OwnShift?, treatments: List<Treatment> = emptyList()) =
        summarizeDay(day(date, markings, treatments), shift)
    /** Journey read model used by Home and Detalhe do dia, including the civil next day of overnight shifts. */
    fun journeyDay(date: String, shift: OwnShift?, markings: List<OwnMarking>, treatments: List<Treatment>): List<DayPunch> {
        val startDate = runCatching { LocalDate.parse(date) }.getOrNull()
        val nextDate = startDate?.plusDays(1)?.toString()
        val dateMarkings = markings.filter { it.workDate == date }.sortedBy { markingInstant(it.markedAt) }
        val journeyStart = dateMarkings.indexOfFirst { it.classification?.purpose == "journey_start" }
        // A civil date may begin with the end of the previous overnight shift. Start this journey at
        // its own first declared beginning, retaining any duplicate beginnings after it for validation.
        val base = if (journeyStart >= 0) dateMarkings.drop(journeyStart) else dateMarkings
        val nextDateMarkings = if (shift?.overnight == true && nextDate != null) {
            markings.filter { it.workDate == nextDate }.sortedBy { markingInstant(it.markedAt) }
        } else emptyList()
        val nextJourneyStart = nextDateMarkings.firstOrNull { it.classification?.purpose == "journey_start" }
        val continuation = nextDateMarkings.takeWhile { it !== nextJourneyStart }
        val selected = base + continuation
        val receiptIds = selected.mapTo(mutableSetOf()) { it.receiptId }
        val nextJourneyStartInstant = nextJourneyStart?.markedAt?.let(::markingInstant)
        val relevantTreatments = treatments.filter { treatment ->
            treatment.originalReceiptId in receiptIds || (treatment.type == "inclusion" && when (treatment.workDate) {
                date -> true
                nextDate -> shift?.overnight == true && (nextJourneyStart == null || treatment.markedAt?.let(::markingInstant)
                    ?.let { nextJourneyStartInstant == null || it.isBefore(nextJourneyStartInstant) } != false)
                else -> false
            })
        }
        // Normalize only copies in this read model. Fiscal work dates and originals are never changed.
        return day(date, selected.map { it.copy(workDate = date) }, relevantTreatments.map { it.copy(workDate = date) })
    }
    fun homeDaySummary(date: String, markings: List<OwnMarking>, shift: OwnShift?, treatments: List<Treatment>,
        treatmentsAvailable: Boolean?, offlinePending: Int): DaySummary? {
        val calculated = summarizeDay(journeyDay(date, shift, markings, treatments), shift) ?: return null
        return when {
            offlinePending > 0 -> DaySummary(DaySummaryState.PENDING,
                message = "Há marcação offline aguardando sincronização; a prévia ainda não a inclui.")
            treatmentsAvailable == null -> DaySummary(DaySummaryState.PENDING,
                message = "Atualizando ajustes e tratamentos do dia…")
            !treatmentsAvailable -> DaySummary(DaySummaryState.PENDING,
                message = "Não foi possível conferir os tratamentos. Atualize para ver a prévia.")
            else -> calculated
        }
    }
    /** Selects the journey shown on Home; an overnight journey keeps its start date until a new one begins. */
    fun homeWorkContext(today: LocalDate, shifts: List<OwnShift>, markings: List<OwnMarking>): HomeWorkContext {
        val todayText = today.toString()
        val previousText = today.minusDays(1).toString()
        val ordered = markings.sortedBy { markingInstant(it.markedAt) }
        val todayShift = shifts.firstOrNull { it.date == todayText }
        val todayMarkings = ordered.filter { it.workDate == todayText }
        val currentStart = todayMarkings.indexOfFirst { it.classification?.purpose == "journey_start" }
        if (currentStart >= 0) return HomeWorkContext(todayText, todayShift, todayMarkings.drop(currentStart))
        val previousShift = shifts.firstOrNull { it.date == previousText && it.overnight }
        if (previousShift != null) {
            val previousMarkings = ordered.filter { it.workDate == previousText }
            val previousStart = previousMarkings.indexOfFirst { it.classification?.purpose == "journey_start" }
            if (previousStart >= 0) {
                return HomeWorkContext(previousText, previousShift, previousMarkings.drop(previousStart) + todayMarkings)
            }
        }
        return HomeWorkContext(todayText, todayShift, todayMarkings)
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
    /** Only the hours of the shift ("13:45–20:00"), without its name; "Folga" on a day off. */
    fun shiftHours(shift: OwnShift?): String? = when {
        shift == null -> null
        shift.type == "day_off" -> "Folga"
        else -> shift.startTime?.let { start -> shift.endTime?.let { "$start–$it" } }
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
            purpose = it.classification?.purpose, classificationSource = it.classification?.source, markedAt = it.markedAt, pilot = it.pilot, location = it.location) }
        val included = ofDay.filter { it.type == "inclusion" && it.markedAt != null }.map { DayPunch(minuteOf(it.markedAt!!), null, null, null, included = true, unitId = it.executionUnitId, markedAt = it.markedAt) }
        return (originals + included).sortedWith(compareBy<DayPunch> { instantOf(it) ?: java.time.Instant.MAX }.thenBy { it.time })
    }
    fun receiptFileName(markedAt: String, nsr: Long, pilot: Boolean = false) =
        "comprovante-ponto-${markedAt.take(10)}-${if (pilot) "ensaio-sequencia" else "nsr"}-$nsr.pdf"
    fun durationText(minutes: Int, signed: Boolean = false): String {
        val sign = if (signed && minutes > 0) "+" else if (minutes < 0) "−" else ""
        val absolute = Math.abs(minutes)
        return "$sign${absolute / 60}h${String.format("%02d", absolute % 60)}"
    }
    /** Filter group of a bank line: credit, debit, payroll or review. */
    fun bankGroup(nature: String) = when (nature) {
        "bank_credit" -> "credit"
        "bank_debit" -> "debit"
        "payroll_overtime", "payroll_discount" -> "payroll"
        else -> "review"
    }
    /** Days elapsed and total days of the bank cycle, both inclusive, capped at the cycle. */
    fun cycleProgress(cycle: TimeBankCycle, today: LocalDate): Pair<Int, Int>? = runCatching {
        val start = LocalDate.parse(cycle.start); val end = LocalDate.parse(cycle.end)
        val total = java.time.temporal.ChronoUnit.DAYS.between(start, end).toInt() + 1
        val elapsed = (java.time.temporal.ChronoUnit.DAYS.between(start, today).toInt() + 1).coerceIn(0, total)
        elapsed to total
    }.getOrNull()?.takeIf { it.second > 0 }
    /** One act of an adjustment's trail, in the person's words. */
    fun adjustmentActText(act: AdjustmentAct): String = when (act.action) {
        "requested" -> "Enviado por você"
        "approved" -> "Aprovado pelo gestor ou DP"
        "rejected" -> "Recusado pelo gestor ou DP"
        "cancelled" -> if (act.role == "titular") "Cancelado por você" else "Cancelado pelo gestor ou DP"
        else -> act.action
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
