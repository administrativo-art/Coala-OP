package com.coalaone.go

import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class TimeRulesTest {
    @Test fun visualThemeFollowsTheHourInsteadOfTheDevicePreference() {
        assertTrue(com.coalaone.go.ui.timeBasedDarkTheme(0))
        assertTrue(com.coalaone.go.ui.timeBasedDarkTheme(5))
        assertFalse(com.coalaone.go.ui.timeBasedDarkTheme(6))
        assertFalse(com.coalaone.go.ui.timeBasedDarkTheme(15))
        assertFalse(com.coalaone.go.ui.timeBasedDarkTheme(17))
        assertTrue(com.coalaone.go.ui.timeBasedDarkTheme(18))
        assertTrue(com.coalaone.go.ui.timeBasedDarkTheme(23))
    }
    @Test fun offlineCanonicalMatchesTheServerAndUsesTheUnitTimeZone() {
        val markedAt = com.coalaone.go.domain.TimeOfflineRules.markedAt("2026-10-18T11:00:00.000Z", 1000, 1801000, "America/Manaus")
        assertEquals("2026-10-18T07:30:00-0400", markedAt)
        val canonical = com.coalaone.go.domain.TimeOfflineRules.canonical("permit-a", "attempt-a", "unit-a", "a".repeat(64),
            1801000, 7, 1, null, markedAt)
        assertEquals("7ff09350eb0e301c83b874d29906e2f13717ac3c76bf1ec596c3a07356a465ee",
            com.coalaone.go.domain.TimeOfflineRules.hash(canonical))
    }
    private val options = TimeOptions("2026-10-19", true, true, listOf(ExecutionUnit("slz", "São Luís", true), ExecutionUnit("mao", "Manaus", timeZone = "America/Manaus")), OfficialClock(true, "2026-10-19T03:30:00Z", "America/Fortaleza"))

    @Test fun punchUsesTheUnitZoneForTheDateAndTheClock() {
        val instant = Instant.parse("2026-10-19T03:30:00Z").toEpochMilli()
        // 00:30 in São Luís but still 23:30 of the day before in Manaus: the date sent follows the chosen unit.
        assertEquals("2026-10-19", TimeRules.workDate(instant, TimeRules.unitZone(options, "slz")))
        assertEquals("2026-10-18", TimeRules.workDate(instant, TimeRules.unitZone(options, "mao")))
        assertEquals("00:30:00", TimeRules.clockText(instant, TimeRules.unitZone(options, "slz")))
        assertEquals("UTC−04:00", TimeRules.utcOffsetLabel(ZoneId.of("America/Manaus"), instant))
        assertEquals(0L, TimeRules.clockOffset(options.officialClock, instant))
        assertNull(TimeRules.clockOffset(OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE"), instant))
    }
    @Test fun punchIsBlockedWithAReasonUntilEverythingIsReady() {
        assertTrue(TimeRules.canRecord(options, "slz"))
        assertFalse(TimeRules.canRecord(options, "other"))
        assertNull(TimeRules.blockedReason(options))
        assertTrue(TimeRules.blockedReason(options.copy(eligible = false))!!.contains("CLT"))
        val displayOnly = options.copy(eligible = false, markingEnabled = false, executionUnits = emptyList())
        assertTrue(displayOnly.officialClock?.available == true)
        assertFalse(TimeRules.canRecord(displayOnly, null))
        assertFalse(TimeRules.canRecord(options.copy(officialClock = OfficialClock(false)), "slz"))
        assertTrue(TimeRules.blockedReason(options.copy(officialClock = OfficialClock(false)))!!.contains("Hora Legal Brasileira"))
    }
    @Test fun labelsAreSuggestedByOrderAsOnTheWeb() {
        val shift = OwnShift("2026-10-19", "work", "08:00", "16:00", breakType = "fixed", breakStart = "12:00", breakEnd = "13:00")
        assertEquals(4, TimeRules.expectedPunches(shift))
        assertEquals(listOf("Entrada", "Saída p/ intervalo", "Volta do intervalo", "Saída", "Batida extra"), (0..4).map { TimeRules.suggestedLabel(it, 4) })
        assertNull(TimeRules.expectedPunches(shift.copy(breakType = "flexible", breakSplit = "multiple")))
        assertEquals(2, TimeRules.expectedPunches(shift.copy(breakType = "none")))
        assertEquals("Intervalo fixo: 12:00–13:00", TimeRules.breakText(shift))
        assertEquals("Janela 11:30–13:45 · 60 min", TimeRules.breakText(shift.copy(breakType = "staggered", breakWindowStart = "11:30", breakWindowEnd = "13:45", breakDurationMinutes = 60)))
        assertEquals("Folga", TimeRules.shiftText(OwnShift("2026-10-19", "day_off")))
    }
    @Test fun nextPurposeUsesDeclaredStateAndThePlannedPauses() {
        fun marking(id: String, time: String, purpose: String) = OwnMarking(id, "2026-10-19", id.drop(1).toLong(),
            "2026-10-19T$time:00-03:00", "slz", "01", "available", classification = MarkingClassification(purpose))
        val split = OwnShift("2026-10-19", "work", "08:00", "16:00", breakType = "fixed",
            breakSegments = listOf(BreakSegment("10:00", "10:10"), BreakSegment("14:00", "14:10")))
        assertEquals("journey_start", TimeRules.suggestedPurpose(emptyList(), split))
        assertEquals("break_start", TimeRules.suggestedPurpose(listOf(marking("r1", "08:00", "journey_start")), split))
        assertEquals("break_start", TimeRules.suggestedPurpose(listOf(marking("r1", "08:00", "journey_start"),
            marking("r2", "10:00", "break_start"), marking("r3", "10:10", "break_end")), split))
        assertEquals("journey_end", TimeRules.suggestedPurpose(listOf(marking("r1", "08:00", "journey_start"),
            marking("r2", "10:00", "break_start"), marking("r3", "10:10", "break_end"),
            marking("r4", "14:00", "break_start"), marking("r5", "14:10", "break_end")), split))
        val endedWithoutBreak = listOf(marking("r1", "08:00", "journey_start"), marking("r2", "16:00", "journey_end"))
        assertTrue(TimeRules.breakIssue(endedWithoutBreak, split)!!.contains("0 de 20 min"))
    }
    @Test fun treatedDayKeepsTheOriginalPunchStruckAndShowsTheInclusion() {
        val markings = listOf(OwnMarking("r1", "2026-10-18", 1, "2026-10-18T08:00:00-03:00", "slz", "01", "available"), OwnMarking("r2", "2026-10-18", 2, "2026-10-18T08:01:00-03:00", "slz", "01", "available"))
        val treatments = listOf(Treatment("t1", "a", "2026-10-18", "discard", "r2"), Treatment("t2", "b", "2026-10-18", "inclusion", null, "2026-10-18T16:00:00-03:00", "slz"))
        val day = TimeRules.day("2026-10-18", markings, treatments)
        assertEquals(listOf("08:00", "08:01", "16:00"), day.map { it.time })
        assertTrue(day[1].discarded); assertTrue(day[2].included); assertNull(day[2].receiptId)
        assertEquals("comprovante-ponto-2026-10-18-nsr-2.pdf", TimeRules.receiptFileName(markings[1].markedAt, 2))
        assertEquals("comprovante-ponto-2026-10-18-ensaio-sequencia-2.pdf", TimeRules.receiptFileName(markings[1].markedAt, 2, true))
    }
    @Test fun bankAmountsAndDestinationsAreExplicit() {
        assertEquals("+1h20", TimeRules.durationText(80, true))
        assertEquals("−0h45", TimeRules.durationText(-45, true))
        assertEquals("Hora extra para a folha", TimeRules.bankNatureText("payroll_overtime"))
        assertEquals("A conferir pelo DP", TimeRules.bankNatureText("review"))
    }
    @Test fun dayDetailExplainsPlannedWorkedAndBreakMinutes() {
        val shift = OwnShift("2026-10-19", "work", "08:00", "16:00", breakType = "fixed", breakStart = "12:00", breakEnd = "13:00")
        val punches = listOf(
            com.coalaone.go.domain.DayPunch("08:03", 1, "r1", "available", purpose = "journey_start"),
            com.coalaone.go.domain.DayPunch("12:00", 2, "r2", "available", purpose = "break_start"),
            com.coalaone.go.domain.DayPunch("13:00", 3, "r3", "available", purpose = "break_end"),
            com.coalaone.go.domain.DayPunch("16:04", 4, "r4", "available", purpose = "journey_end"),
        )
        assertEquals(420, TimeRules.plannedWorkMinutes(shift))
        assertEquals(421, TimeRules.workedMinutes(punches))
        assertEquals(60, TimeRules.recordedBreakMinutes(punches))
        assertNull(TimeRules.workedMinutes(punches.dropLast(1)))
    }
    @Test fun dayDetailKeepsChronologyWhenTheShiftCrossesMidnight() {
        fun punch(time: String, at: String, purpose: String) = com.coalaone.go.domain.DayPunch(
            time, null, null, null, purpose = purpose, markedAt = at)
        val punches = listOf(
            punch("22:00", "2026-10-19T22:00:00-0300", "journey_start"),
            punch("02:00", "2026-10-20T02:00:00-0300", "break_start"),
            punch("03:00", "2026-10-20T03:00:00-0300", "break_end"),
            punch("07:00", "2026-10-20T07:00:00-0300", "journey_end"),
        )
        assertEquals(480, TimeRules.workedMinutes(punches))
        assertEquals(60, TimeRules.recordedBreakMinutes(punches))
        val markings = punches.mapIndexed { index, item -> OwnMarking("night-$index", "2026-10-19", index.toLong() + 1,
            item.markedAt!!, "slz", "01", "available", classification = MarkingClassification(item.purpose!!)) }
        assertEquals(listOf("22:00", "02:00", "03:00", "07:00"), TimeRules.day("2026-10-19", markings, emptyList()).map { it.time })
    }
    @Test fun adjustmentMirrorsTheServerSchema() {
        val today = LocalDate.parse("2026-10-19")
        val include = TimeRules.adjustmentRequest("a", "2026-10-18", "include", "ignored", "08:00", "slz", "Esqueci de bater.", today)
        assertNull(include.operations.single().targetReceiptId); assertEquals("08:00", include.operations.single().newTime); assertEquals("slz", include.operations.single().executionUnitId)
        val discard = TimeRules.adjustmentRequest("a", "2026-10-18", "discard", "r1", "09:00", "slz", "Bati duas vezes.", today)
        assertNull(discard.operations.single().newTime); assertNull(discard.operations.single().executionUnitId)
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", "correct", null, "08:00", "slz", "Horário errado.", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", "include", null, "8h", "slz", "Esqueci de bater.", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", "include", null, "08:00", "slz", "curto", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-20", "include", null, "08:00", "slz", "Esqueci de bater.", today) }
    }
    @Test fun oneAdjustmentCanGroupSeveralChangesOfTheSameKind() {
        val today = LocalDate.parse("2026-10-19")
        val request = TimeRules.adjustmentRequest("a", "2026-10-18", listOf(
            AdjustmentRequestOperation("include", newTime = "08:00", executionUnitId = "slz"),
            AdjustmentRequestOperation("include", newTime = "12:00", executionUnitId = "slz"),
        ), "Esqueci duas batidas.", today)
        assertEquals(listOf("08:00", "12:00"), request.operations.map { it.newTime })
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", listOf(
            AdjustmentRequestOperation("discard", targetReceiptId = "r1"),
            AdjustmentRequestOperation("correct", targetReceiptId = "r2", newTime = "12:00"),
        ), "Corrigir duas batidas.", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", listOf(
            AdjustmentRequestOperation("discard", targetReceiptId = "r1"),
            AdjustmentRequestOperation("discard", targetReceiptId = "r1"),
        ), "Desconsiderar duplicadas.", today) }
    }
    @Test fun absenceAndVoucherMirrorTheServerSchemas() {
        val type = AbsenceOption("t", "Atestado", listOf("day"), attachmentRequired = true)
        assertNull(TimeRules.absencePeriod(type, "day", "2026-10-20", "2026-10-21", "08:00", "").startTime)
        assertThrows(IllegalArgumentException::class.java) { TimeRules.absencePeriod(type, "hour", "2026-10-20", "2026-10-20", "08:00", "10:00") }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.absencePeriod(type, "day", "2026-10-21", "2026-10-20", "", "") }
        val hours = type.copy(units = listOf("hour"))
        assertThrows(IllegalArgumentException::class.java) { TimeRules.absencePeriod(hours, "hour", "2026-10-20", "2026-10-20", "10:00", "08:00") }
        assertEquals("10:00", TimeRules.absencePeriod(hours, "hour", "2026-10-20", "2026-10-21", "22:00", "10:00").endTime)
        assertNull(TimeRules.absenceReason("  "))
        assertThrows(IllegalArgumentException::class.java) { TimeRules.absenceReason("curto") }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.validateAbsenceFiles(emptyList(), true) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.validateAbsenceFiles(listOf(Document("a.webp", "image/webp", byteArrayOf(1))), false) }
        TimeRules.validateAbsenceFiles(listOf(Document("a.pdf", "application/pdf", byteArrayOf(1))), true)
        assertEquals("Sem análise em 3 dias, a etapa é aprovada por decurso de prazo.", TimeRules.tacitText(3))
        assertEquals("1 dia", TimeRules.quantityText(1.0, "day")); assertEquals("1,5 h", TimeRules.quantityText(1.5, "hour"))
        assertThrows(IllegalArgumentException::class.java) { TimeRules.voucherRequest("cancel", "") }
    }
}
