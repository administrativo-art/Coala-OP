package com.coalaone.go

import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class TimeRulesTest {
    @Test fun v2PreparationAndCycleHaveIndependentTwentyFourHourDeadlines() {
        val rules = com.coalaone.go.domain.TimeOfflineRules
        val start = Instant.parse("2026-10-27T23:00:00Z")
        val hour = 3_600_000L
        val permit = OfflinePermit("permit", "install", "key", "tee", 7, 1000, start.toString(), start.toString(),
            start.plusSeconds(48 * 3600).toString(), listOf(OfflinePermitUnit("unit", "Unit", "America/Belem")),
            protocolVersion = 2, preparationExpiresAt = start.plusSeconds(24 * 3600).toString())
        assertNull(rules.permitIssue(permit, 7, 1000 + 24 * hour))
        assertNotNull(rules.permitIssue(permit, 7, 1001 + 24 * hour))
        val cycle = OfflineCycle("first", start.plusSeconds(23 * 3600).toString(), start.plusSeconds(47 * 3600).toString())
        assertNull(rules.permitIssue(permit, 7, 1000 + 47 * hour, cycle))
        assertNotNull(rules.permitIssue(permit, 7, 1001 + 47 * hour, cycle))
        assertNotNull(rules.permitIssue(permit, 8, 1000 + 24 * hour, cycle))
        assertNotNull(rules.permitIssue(permit, 7, 999, cycle))
        assertNotNull(rules.permitIssue(permit.copy(protocolVersion = null), 7, 1000 + 13 * hour))
    }
    @Test fun cycleIdentityAndFirstMonotonicInstantArePartOfTheVersionTwoCanonicalPayload() {
        val rules = com.coalaone.go.domain.TimeOfflineRules
        val cycle = OfflineCycleEvidence("first", 1000)
        val canonical = rules.canonical("permit", "first", "unit", "key", 1000, 7, 1, null,
            "2026-10-27T20:00:00-0300", "pilot", cycle)
        assertEquals("coala-rep-p-pilot-offline-v2\npermit\nfirst\nunit\nkey\n1000\n7\n1\n\n2026-10-27T20:00:00-0300\nfirst\n1000", canonical)
        assertNotEquals(canonical, rules.canonical("permit", "first", "unit", "key", 1000, 7, 1, null,
            "2026-10-27T20:00:00-0300", "pilot", cycle.copy(startedElapsedRealtimeMs = 1001)))
        assertEquals("coala-rep-p-pilot-offline-v1", rules.canonical("permit", "first", "unit", "key", 1000, 7, 1, null,
            "2026-10-27T20:00:00-0300", "pilot").lineSequence().first())
    }
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
        assertFalse(TimeRules.canRecord(options.copy(officialClock = OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE")), "slz"))
        val hlbOutage = options.copy(officialClock = OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE"))
        // The message follows the device state: a valid permit preserves, none blocks.
        assertEquals("Não foi possível registrar agora. Tente novamente em instantes.", TimeRules.blockedReason(hlbOutage))
        assertEquals("Seu ponto será salvo neste aparelho e enviado depois.", TimeRules.blockedReason(hlbOutage, offlineReady = true))
        assertEquals("Seu ensaio será salvo neste aparelho e enviado depois.", TimeRules.blockedReason(hlbOutage.copy(mode = "pilot"), offlineReady = true))
        assertTrue(TimeRules.blockedReason(options.copy(officialClock = OfficialClock(false, issue = "REP_P_ESTABLISHMENT_NOT_READY")), offlineReady = true)!!.contains("fonte de horário"))
    }
    @Test fun nextPunchAndPlannedTimesFollowTheShift() {
        val shift = OwnShift("2026-10-19", "work", "08:00", "17:00", breakType = "fixed", breakStart = "12:00", breakEnd = "13:00")
        assertEquals(4, TimeRules.expectedPunches(shift))
        assertEquals(listOf("08:00", "12:00", "13:00", "17:00"), TimeRules.plannedPunchTimes(shift))
        assertEquals("2ª de 4 · Início do intervalo", TimeRules.nextPunchText(1, shift, "break_start"))
        assertEquals("Batida extra", TimeRules.nextPunchText(4, shift, null))
        assertEquals("1ª batida · Início da jornada", TimeRules.nextPunchText(0, null, "journey_start"))
        assertTrue(TimeRules.plannedPunchTimes(null).isEmpty())
    }
    @Test fun workedSoFarCountsTheOpenSegmentAndStopsDuringTheBreak() {
        fun punch(time: String, purpose: String) = com.coalaone.go.domain.DayPunch(time, 1, "r$time", "available", purpose = purpose, markedAt = "2026-10-19T$time:00-0300")
        val now = Instant.parse("2026-10-19T14:47:00Z").toEpochMilli() // 11:47 em São Luís
        assertEquals(225, TimeRules.workedSoFarMinutes(listOf(punch("08:02", "journey_start")), now))
        assertEquals(238, TimeRules.workedSoFarMinutes(listOf(punch("08:02", "journey_start"), punch("12:00", "break_start")), now))
        assertNull(TimeRules.workedSoFarMinutes(listOf(punch("08:02", "break_end")), now))
    }
    @Test fun recordsDayReadsMissingPunchesAndCycleProgress() {
        val shift = OwnShift("2026-10-16", "work", "08:00", "12:00")
        val today = LocalDate.parse("2026-10-19")
        assertEquals(com.coalaone.go.domain.RecordDayState.MISSING, TimeRules.recordDay("2026-10-16", emptyList(), shift, emptyList(), today).first)
        assertEquals(com.coalaone.go.domain.RecordDayState.EMPTY, TimeRules.recordDay("2026-10-19", emptyList(), shift.copy(date = "2026-10-19"), emptyList(), today).first)
        assertEquals(56 to 181, TimeRules.cycleProgress(TimeBankCycle("2026-09-01", "2027-02-28", 1), LocalDate.parse("2026-10-26")))
        assertEquals(181 to 181, TimeRules.cycleProgress(TimeBankCycle("2026-09-01", "2027-02-28", 1), LocalDate.parse("2027-05-01")))
        assertEquals("credit", TimeRules.bankGroup("bank_credit"))
        assertEquals("payroll", TimeRules.bankGroup("payroll_discount"))
        assertEquals("review", TimeRules.bankGroup("review_required"))
    }
    @Test fun localPreservationOnlyCoversAnExplicitHlbOutage() {
        val hlbOutage = options.copy(officialClock = OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE"), mode = "pilot")
        assertTrue(TimeRules.canPreserve(hlbOutage, "slz", offlineReady = true))
        assertFalse(TimeRules.canPreserve(hlbOutage.copy(officialClock = OfficialClock(false, issue = "REP_P_ESTABLISHMENT_NOT_READY")), "slz", offlineReady = true))
        assertFalse(TimeRules.canPreserve(hlbOutage.copy(officialClock = OfficialClock(false, issue = "REP_P_PILOT_UNIT_TIME_ZONE_MISSING")), "slz", offlineReady = true))
        assertFalse(TimeRules.canPreserve(hlbOutage, "slz", offlineReady = false))
    }
    @Test fun offlinePreservationAlwaysRequiresAValidPermitAndEligibleUnit() {
        assertTrue(TimeRules.canPreserveOffline(options.copy(mode = "pilot"), "slz", offlineReady = true))
        assertFalse(TimeRules.canPreserveOffline(options, "slz", offlineReady = false))
        assertFalse(TimeRules.canPreserveOffline(options.copy(eligible = false), "slz", offlineReady = true))
        assertFalse(TimeRules.canPreserveOffline(options, "other", offlineReady = true))
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
    @Test fun visualCycleAutoClosesAtLocalMidnightOnlyForDaytimeShift() {
        fun marking(purpose: String) = OwnMarking("r1", "2026-10-19", 1,
            "2026-10-19T17:00:00-03:00", "slz", "01", "available", classification = MarkingClassification(purpose))
        val zone = ZoneId.of("America/Fortaleza")
        val daytime = OwnShift("2026-10-19", "work", "08:00", "17:00")
        val before = java.time.OffsetDateTime.parse("2026-10-19T23:59:59-03:00").toInstant().toEpochMilli()
        val after = java.time.OffsetDateTime.parse("2026-10-20T00:00:00-03:00").toInstant().toEpochMilli()
        assertFalse(TimeRules.autoJourneyCycleClosed("2026-10-19", daytime, listOf(marking("journey_end")), before, zone))
        assertTrue(TimeRules.autoJourneyCycleClosed("2026-10-19", daytime, listOf(marking("journey_end")), after, zone))
        assertFalse(TimeRules.autoJourneyCycleClosed("2026-10-19", daytime.copy(overnight = true), listOf(marking("journey_end")), after, zone))
        assertFalse(TimeRules.autoJourneyCycleClosed("2026-10-19", daytime, listOf(marking("break_end")), after, zone))
        assertFalse(TimeRules.autoJourneyCycleClosed("2026-10-19", null, listOf(marking("journey_end")), after, zone))
    }
    @Test fun liveBreakStatusCoversFixedWindowFlexibleAndMinimumPause() {
        fun marking(id: String, time: String, purpose: String) = OwnMarking(id, "2026-10-19", id.drop(1).toLong(),
            "2026-10-19T$time:00-03:00", "slz", "01", "available", classification = MarkingClassification(purpose))
        fun now(time: String) = java.time.OffsetDateTime.parse("2026-10-19T$time:00-03:00").toInstant().toEpochMilli()
        val zone = ZoneId.of("America/Fortaleza")
        val fixed = OwnShift("2026-10-19", "work", "08:00", "16:00", breakType = "fixed",
            breakSegments = listOf(BreakSegment("11:30", "11:37"), BreakSegment("14:30", "14:38")))
        val firstDone = listOf(marking("r1", "08:00", "journey_start"), marking("r2", "11:30", "break_start"), marking("r3", "11:37", "break_end"))
        assertEquals("2ª pausa 14:30–14:38 · começa em 10 min", TimeRules.breakStatus(fixed, firstDone, now("14:20"), zone)?.headline)
        assertEquals(com.coalaone.go.domain.BreakLevel.DANGER, TimeRules.breakStatus(fixed,
            listOf(marking("r1", "08:00", "journey_start")), now("11:40"), zone)?.level)

        val window = OwnShift("2026-10-19", "work", "10:00", "16:15", breakType = "staggered",
            breakDurationMinutes = 15, breakWindowStart = "12:00", breakWindowEnd = "14:00")
        assertEquals("Janela 12:00–14:00 abre em 10 min", TimeRules.breakStatus(window,
            listOf(marking("r1", "09:57", "journey_start")), now("11:50"), zone)?.headline)
        assertEquals(com.coalaone.go.domain.BreakLevel.WARN, TimeRules.breakStatus(window,
            listOf(marking("r1", "09:57", "journey_start")), now("13:38"), zone)?.level)

        val flexible = window.copy(breakType = "flexible", breakWindowStart = null, breakWindowEnd = null)
        val inPause = TimeRules.breakStatus(flexible, listOf(marking("r1", "09:57", "journey_start"),
            marking("r2", "13:00", "break_start")), now("13:10"), zone)!!
        assertEquals(300L, inPause.countdownSeconds)
        assertTrue(inPause.headline.contains("volte às 13:15"))

        val multiple = flexible.copy(breakSplit = "multiple", breakMinPauseMinutes = 5)
        val short = TimeRules.breakStatus(multiple, listOf(marking("r1", "09:57", "journey_start"),
            marking("r2", "12:00", "break_start"), marking("r3", "12:03", "break_end")), now("13:00"), zone)!!
        assertEquals(com.coalaone.go.domain.BreakLevel.WARN, short.level)
        assertTrue(short.headline.contains("mínimo de 5 min"))
    }
    @Test fun liveBreakStatusRequiresClassificationsAndNeverBlocksThePunch() {
        val shift = OwnShift("2026-10-19", "work", "08:00", "16:00", breakType = "flexible", breakDurationMinutes = 60)
        val unclassified = OwnMarking("r1", "2026-10-19", 1, "2026-10-19T08:00:00-03:00", "slz", "01", "available")
        val status = TimeRules.breakStatus(shift, listOf(unclassified), Instant.parse("2026-10-19T13:00:00Z").toEpochMilli(), ZoneId.of("UTC"))
        assertTrue(status!!.headline.contains("Classifique"))
        assertTrue(TimeRules.canRecord(options, "slz"))
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
    @Test fun homeDaySummaryAppearsOnlyAsCompleteAfterTheJourneyEnd() {
        fun marking(id: String, time: String, purpose: String?) = OwnMarking(id, "2026-10-19", id.drop(1).toLong(),
            "2026-10-19T$time:00-03:00", "slz", "01", "available",
            classification = purpose?.let(::MarkingClassification))
        val shift = OwnShift("2026-10-19", "work", "08:00", "17:00", breakType = "fixed", breakStart = "12:00", breakEnd = "13:00")
        val open = listOf(marking("r1", "08:02", "journey_start"), marking("r2", "12:00", "break_start"), marking("r3", "13:00", "break_end"))
        assertEquals(com.coalaone.go.domain.DaySummaryState.IN_PROGRESS,
            TimeRules.daySummary("2026-10-19", open, shift)?.state)
        val complete = TimeRules.daySummary("2026-10-19", open + marking("r4", "17:06", "journey_end"), shift)!!
        assertEquals(com.coalaone.go.domain.DaySummaryState.COMPLETE, complete.state)
        assertEquals(484, complete.workedMinutes)
        assertEquals(60, complete.breakMinutes)
        assertEquals(4, complete.shiftDifferenceMinutes)
        assertEquals(com.coalaone.go.domain.DaySummaryState.PENDING,
            TimeRules.daySummary("2026-10-19", listOf(marking("r1", "08:02", null)), shift)?.state)
        val contradictory = listOf(marking("r1", "08:00", "journey_start"), marking("r2", "09:00", "journey_start"),
            marking("r3", "13:00", "break_end"), marking("r4", "17:00", "journey_end"))
        assertEquals(com.coalaone.go.domain.DaySummaryState.PENDING,
            TimeRules.daySummary("2026-10-19", contradictory, shift)?.state)
        assertTrue(TimeRules.homeDaySummary("2026-10-19", open + marking("r4", "17:06", "journey_end"),
            shift, emptyList(), false, 0)?.message!!.contains("tratamentos"))
        assertTrue(TimeRules.homeDaySummary("2026-10-19", open + marking("r4", "17:06", "journey_end"),
            shift, emptyList(), true, 1)?.message!!.contains("offline"))
    }
    @Test fun homeDaySummaryHonorsTreatmentsAndLeavesInclusionsWithoutPurposePending() {
        fun marking(id: String, time: String, purpose: String) = OwnMarking(id, "2026-10-19", id.drop(1).toLong(),
            "2026-10-19T$time:00-03:00", "slz", "01", "available", classification = MarkingClassification(purpose))
        val shift = OwnShift("2026-10-19", "work", "08:00", "17:00", breakType = "fixed", breakStart = "12:00", breakEnd = "13:00")
        val markings = listOf(marking("r1", "08:00", "journey_start"), marking("r2", "08:01", "journey_start"),
            marking("r3", "12:00", "break_start"), marking("r4", "13:00", "break_end"), marking("r5", "17:00", "journey_end"))
        val discarded = listOf(Treatment("t1", "a1", "2026-10-19", "discard", originalReceiptId = "r2"))
        assertEquals(com.coalaone.go.domain.DaySummaryState.COMPLETE,
            TimeRules.daySummary("2026-10-19", markings, shift, discarded)?.state)
        val included = discarded + Treatment("t2", "a1", "2026-10-19", "inclusion", markedAt = "2026-10-19T10:00:00-03:00", executionUnitId = "slz")
        assertEquals(com.coalaone.go.domain.DaySummaryState.PENDING,
            TimeRules.daySummary("2026-10-19", markings, shift, included)?.state)
        val outside = discarded + Treatment("t3", "a2", "2026-10-19", "inclusion", markedAt = "2026-10-19T19:00:00-03:00", executionUnitId = "slz")
        assertEquals(com.coalaone.go.domain.DaySummaryState.PENDING,
            TimeRules.homeDaySummary("2026-10-19", markings, shift, outside, true, 0)?.state)
    }
    @Test fun homeWorkContextKeepsAnOvernightJourneyOnItsStartDate() {
        fun marking(id: String, date: String, at: String, purpose: String) = OwnMarking(id, date, id.drop(1).toLong(), at,
            "slz", "01", "available", classification = MarkingClassification(purpose))
        val shifts = listOf(
            OwnShift("2026-10-19", "work", "22:00", "07:00", overnight = true),
            OwnShift("2026-10-20", "work", "22:00", "07:00", overnight = true),
        )
        val overnight = listOf(
            marking("r1", "2026-10-19", "2026-10-19T22:00:00-03:00", "journey_start"),
            marking("r2", "2026-10-20", "2026-10-20T02:00:00-03:00", "break_start"),
            marking("r3", "2026-10-20", "2026-10-20T03:00:00-03:00", "break_end"),
            marking("r4", "2026-10-20", "2026-10-20T07:00:00-03:00", "journey_end"),
        )
        val previous = TimeRules.homeWorkContext(LocalDate.parse("2026-10-20"), shifts, overnight)
        assertEquals("2026-10-19", previous.date)
        assertEquals(listOf("r1", "r2", "r3", "r4"), previous.markings.map { it.receiptId })
        val summary = TimeRules.homeDaySummary(previous.date, previous.markings, previous.shift, emptyList(), true, 0)
        assertEquals(com.coalaone.go.domain.DaySummaryState.COMPLETE, summary?.state)
        assertEquals(480, summary?.workedMinutes)
        val newStart = overnight + marking("r5", "2026-10-20", "2026-10-20T22:00:00-03:00", "journey_start")
        val current = TimeRules.homeWorkContext(LocalDate.parse("2026-10-20"), shifts, newStart)
        assertEquals("2026-10-20", current.date)
        assertEquals(listOf("r5"), current.markings.map { it.receiptId })
        val duplicateStart = newStart + marking("r6", "2026-10-20", "2026-10-20T22:01:00-03:00", "journey_start") +
            marking("r7", "2026-10-20", "2026-10-21T07:00:00-03:00", "journey_end")
        val duplicated = TimeRules.homeWorkContext(LocalDate.parse("2026-10-20"), shifts, duplicateStart)
        assertEquals(com.coalaone.go.domain.DaySummaryState.PENDING,
            TimeRules.homeDaySummary(duplicated.date, duplicated.markings, duplicated.shift, emptyList(), true, 0)?.state)
    }
    @Test fun homeAndDetailSelectTheSameJourneyOnConsecutiveOvernightShifts() {
        fun marking(id: String, date: String, at: String, purpose: String) = OwnMarking(id, date, id.drop(1).toLong(), at,
            "slz", "01", "available", classification = MarkingClassification(purpose))
        val shift = OwnShift("2026-01-31", "work", "22:00", "07:00", overnight = true)
        val markings = listOf(
            marking("r1", "2026-01-30", "2026-01-30T22:00:00-03:00", "journey_start"),
            marking("r2", "2026-01-31", "2026-01-31T07:00:00-03:00", "journey_end"),
            marking("r3", "2026-01-31", "2026-01-31T22:00:00-03:00", "journey_start"),
            marking("r4", "2026-02-01", "2026-02-01T07:00:00-03:00", "journey_end"),
        )
        val detail = TimeRules.journeyDay("2026-01-31", shift, markings, emptyList())
        assertEquals(listOf("r3", "r4"), detail.map { it.receiptId })
        val home = TimeRules.homeWorkContext(LocalDate.parse("2026-02-01"), listOf(shift), markings.drop(1))
        assertEquals(listOf("r3", "r4"), home.markings.map { it.receiptId })
        assertEquals(com.coalaone.go.domain.DaySummaryState.COMPLETE,
            TimeRules.homeDaySummary(home.date, home.markings, home.shift, emptyList(), true, 0)?.state)

        val nextJourney = markings + marking("r5", "2026-02-01", "2026-02-01T22:00:00-03:00", "journey_start")
        val nextJourneyTreatment = Treatment("t-next", "a-next", "2026-02-01", "inclusion",
            markedAt = "2026-02-01T23:00:00-03:00", executionUnitId = "slz")
        val separated = TimeRules.journeyDay("2026-01-31", shift, nextJourney, listOf(nextJourneyTreatment))
        assertEquals(listOf("r3", "r4"), separated.map { it.receiptId })
        assertFalse(separated.any { it.included })

        val duplicateEnd = markings + marking("r5", "2026-02-01", "2026-02-01T07:01:00-03:00", "journey_end")
        val detailWithDuplicate = TimeRules.journeyDay("2026-01-31", shift, duplicateEnd, emptyList())
        assertEquals(listOf("r3", "r4", "r5"), detailWithDuplicate.map { it.receiptId })
        assertNull(TimeRules.workedMinutes(detailWithDuplicate))
        val homeWithDuplicate = TimeRules.homeWorkContext(LocalDate.parse("2026-02-01"), listOf(shift), duplicateEnd.drop(1))
        assertEquals(listOf("r3", "r4", "r5"), homeWithDuplicate.markings.map { it.receiptId })
        assertEquals(com.coalaone.go.domain.DaySummaryState.PENDING,
            TimeRules.homeDaySummary(homeWithDuplicate.date, homeWithDuplicate.markings, homeWithDuplicate.shift,
                emptyList(), true, 0)?.state)
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
