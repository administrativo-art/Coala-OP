package com.coalaone.go

import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class TimeRulesTest {
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
        assertFalse(TimeRules.canRecord(options.copy(officialClock = OfficialClock(false)), "slz"))
        assertTrue(TimeRules.blockedReason(options.copy(officialClock = OfficialClock(false)))!!.contains("Hora oficial"))
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
    @Test fun treatedDayKeepsTheOriginalPunchStruckAndShowsTheInclusion() {
        val markings = listOf(OwnMarking("r1", "2026-10-18", 1, "2026-10-18T08:00:00-03:00", "slz", "01", "available"), OwnMarking("r2", "2026-10-18", 2, "2026-10-18T08:01:00-03:00", "slz", "01", "available"))
        val treatments = listOf(Treatment("t1", "a", "2026-10-18", "discard", "r2"), Treatment("t2", "b", "2026-10-18", "inclusion", null, "2026-10-18T16:00:00-03:00", "slz"))
        val day = TimeRules.day("2026-10-18", markings, treatments)
        assertEquals(listOf("08:00", "08:01", "16:00"), day.map { it.time })
        assertTrue(day[1].discarded); assertTrue(day[2].included); assertNull(day[2].receiptId)
        assertEquals("comprovante-ponto-2026-10-18-nsr-2.pdf", TimeRules.receiptFileName(markings[1].markedAt, 2))
    }
    @Test fun bankAmountsAndDestinationsAreExplicit() {
        assertEquals("+1h20", TimeRules.durationText(80, true))
        assertEquals("−0h45", TimeRules.durationText(-45, true))
        assertEquals("Hora extra para a folha", TimeRules.bankNatureText("payroll_overtime"))
        assertEquals("A conferir pelo DP", TimeRules.bankNatureText("review"))
    }
    @Test fun adjustmentMirrorsTheServerSchema() {
        val today = LocalDate.parse("2026-10-19")
        val include = TimeRules.adjustmentRequest("a", "2026-10-18", "include", "ignored", "08:00", "slz", "Esqueci de bater.", today)
        assertNull(include.targetReceiptId); assertEquals("08:00", include.newTime); assertEquals("slz", include.executionUnitId)
        val discard = TimeRules.adjustmentRequest("a", "2026-10-18", "discard", "r1", "09:00", "slz", "Bati duas vezes.", today)
        assertNull(discard.newTime); assertNull(discard.executionUnitId)
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", "correct", null, "08:00", "slz", "Horário errado.", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", "include", null, "8h", "slz", "Esqueci de bater.", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-18", "include", null, "08:00", "slz", "curto", today) }
        assertThrows(IllegalArgumentException::class.java) { TimeRules.adjustmentRequest("a", "2026-10-20", "include", null, "08:00", "slz", "Esqueci de bater.", today) }
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
