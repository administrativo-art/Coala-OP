package com.coalaone.go.data

import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.MediaType.Companion.toMediaType
import java.time.LocalDate
import javax.inject.Inject

class DemoApi @Inject constructor() : ApiService {
    private val simulatedUserName = "Heucilene Oliveira Ribeiro"
    // Eight units, so lists, pickers and the goals header can be judged with a realistic amount of data.
    private val units = listOf(UnitRef("simulation-unit", "Unidade de simulação"), UnitRef("sim-tirirical", "Quiosque Tirirical"), UnitRef("sim-joao-paulo", "Quiosque João Paulo"), UnitRef("sim-matriz", "Matriz"),
        UnitRef("sim-centro", "Quiosque Centro"), UnitRef("sim-orla", "Quiosque Orla"), UnitRef("sim-shopping", "Quiosque Shopping"), UnitRef("sim-cd", "Centro de distribuição"))
    private val unit = units.first()
    private fun unitOf(id: String) = units.firstOrNull { it.id == id } ?: unit
    override suspend fun release() = Release(4, "0.2.0", 0, "/app/CoalaGo.apk")
    override suspend fun reset(request: ResetRequest) = Unit
    override suspend fun profile() = ProfileResponse(Profile(simulatedUserName, "simulation@invalid.local", "Atendente"), Modules(true, true, true, true, true, true, true, true))
    override suspend fun registerPush(request: PushDeviceRegistration, expectedOwner: String) = PushDeviceRegistered(false)
    override suspend fun removePush(request: PushDeviceRemoval, expectedOwner: String) = PushDeviceRemoved(false)
    override suspend fun avatar(photo: MultipartBody.Part) = AvatarResponse("")
    override suspend fun countContext() = CountContext(units, emptyList(), listOf(ExitReason("SAIDA_CONSUMO", "Venda/Consumo"), ExitReason("SAIDA_DESCARTE_VENCIMENTO", "Vencimento"), ExitReason("SAIDA_DESCARTE_AVARIA", "Avaria"), ExitReason("SAIDA_DESCARTE_OUTROS", "Outros")))
    override suspend fun startCount(request: StartCountRequest) = StartedCount(CountSession("simulation-count", unitOf(request.kioskId).id, unitOf(request.kioskId).name, "pending_review", "2026-10-01T12:00:00Z", items = listOf(CountItem("l1", "Leite integral (1 L)", "SIM-001", "2026-12-01", 12.0, "caixa"), CountItem("l2", "Açúcar refinado (1 kg)", "SIM-002", null, 5.0, "pacote"), CountItem("l3", "Copo descartável", "SIM-003", null, 8.0, "pacote"), CountItem("l4", "Canudo", "SIM-004", null, 2.0, "pacote"))), false)
    override suspend fun saveCount(request: SaveCountRequest) = SavedCount(if (request.complete) "completed" else "pending_review", false, request.entries.size)
    override suspend fun cancelCount(request: SessionRequest) = CancelledCount(true, false)
    override suspend fun repositions() = Repositions(listOf(Reposition("simulation-reposition", "Centro de distribuição", unit.id, unit.name, "2026-10-01T12:00:00Z", rows = listOf(RepositionRow("b1", "l1", "Leite integral", "SIM-001", 12.0), RepositionRow("b2", "l2", "Açúcar", "SIM-002", 5.0))),
        Reposition("simulation-reposition-2", "Centro de distribuição", units[1].id, units[1].name, "2026-10-02T12:00:00Z", dispatchedAt = "2026-10-02T11:40:00Z", rows = listOf(RepositionRow("b3", "l5", "Morango congelado", "SIM-005", 8.0))),
        Reposition("simulation-reposition-3", "Centro de distribuição", units[4].id, units[4].name, "2026-10-03T12:00:00Z", dispatchedAt = "2026-10-03T09:15:00Z", rows = listOf(RepositionRow("b4", "l6", "Copo 500 ml", "SIM-006", 20.0), RepositionRow("b5", "l7", "Granola", "SIM-007", 6.0)))), false)
    override suspend fun receive(request: ReceiveRequest) = Received("received", request.rows.any { it.notes.isNotBlank() }, false)
    override suspend fun withdrawals() = Withdrawals(listOf(Withdrawal("a".repeat(64), unit.id, unit.name, "2026-10-01", amountCents = 5000, reason = "Compra de gelo"),
        Withdrawal("b".repeat(64), units[1].id, units[1].name, "2026-10-07", "14:20", 20000, "Caio Martins"), Withdrawal("c".repeat(64), units[4].id, units[4].name, "2026-10-06", "10:05", 8000, simulatedUserName)), emptyList(), DateWindow("2026-10-01", "2026-10-31"), false)
    override suspend fun purchaseContext() = PurchaseContext(units, listOf(UnitRef("account", "Insumos")), units.mapIndexed { index, row -> ResultCenter(if (index == 0) "center" else "center-${row.id}", row.name, row.id) }, listOf(StockProduct("milk", "Leite integral", "1 L")))
    override suspend fun upload(fields: Map<String, RequestBody>, documents: List<MultipartBody.Part>, expectedOwner: String?) = UploadResponse(Submission("simulation-submission", false, "pending_review", ReceiptAnalysis("Fornecedor de simulação", null, "2026-10-01", 5000, listOf(AnalysisItem("Leite integral", 10.0, "un", 500, 5000)), "high")))
    override suspend fun confirm(request: ConfirmPurchase) = PurchaseResponse(PurchaseResult("simulation-purchase", "confirmed", stockEntry = "done", stockItemCount = request.items.count { it.stock != null }))
    override suspend fun link(request: LinkWithdrawal) = PurchaseResponse(PurchaseResult(request.purchaseId, "linked", changeCents = 0))
    override suspend fun schedule(year: Int, month: Int): MonthSchedule {
        val first = LocalDate.of(year, month, 1)
        val colleagues = listOf("Bia" to null, "Caio" to "#FFADAD", "Lia" to "#9BF6FF", "Rafa" to "#FDFFB6", "Duda" to "#FBCFE8", "Edna" to null, "Joana" to "#BDB2FF", "Samila" to null)
        return MonthSchedule(LocalDate.now().toString(), year, month, true, units.mapIndexed { unitIndex, row ->
            // The simulated user works in the first unit and covers weekends in the second.
            val mine = unitIndex <= 1
            val people = listOfNotNull(SchedulePerson(simulatedUserName, "Atendente", true, color = "#BDB2FF").takeIf { mine }) + (0..1).map { offset -> colleagues[(unitIndex + offset) % colleagues.size].let { (name, color) -> SchedulePerson(name, if (offset == 0) "Atendente" else "Líder", false, color = color) } }
            val shifts = (1..first.lengthOfMonth()).flatMap { day ->
                val date = first.withDayOfMonth(day); val weekend = date.dayOfWeek.value >= 6
                people.indices.mapNotNull { index ->
                    val isMe = mine && index == 0
                    when {
                        isMe && unitIndex == 0 && weekend -> null
                        isMe && unitIndex == 1 && !weekend -> null
                        else -> ScheduleShift(index, date.toString(), if (index % 2 == 0) "08:00" else "14:00", if (index % 2 == 0) "16:00" else "22:00", if ((day + index + unitIndex) % 7 == 0) "day_off" else "work", if (index % 2 == 0) "Manhã" else "Tarde")
                    }
                }
            }
            ScheduleUnit(row.id, row.name, people, shifts)
        })
    }
    override suspend fun goalUnits() = GoalUnits(units)
    override suspend fun goalsOverview(): GoalsOverview {
        val rows = units.map { unit -> OverviewUnit(unit.id, unit.name, goals(unit.id).goals.map { OverviewGoal(it.id, it.typeLabel, it.startDate, it.endDate, it.summary.cumulative, it.summary.currentValue, it.summary.levels.first().amount, it.summary.percentOfTarget) }) }
        val all = rows.flatMap { it.goals }; val current = all.sumOf { it.currentValue }; val target = all.sumOf { it.targetValue }
        return GoalsOverview(LocalDate.now().toString(), OverviewTotal(current, target, Math.round(current / target * 1000) / 10.0, rows.count { it.goals.isNotEmpty() }), rows)
    }
    override suspend fun goals(kioskId: String): UnitGoals {
        val index = units.indexOfFirst { it.id == kioskId }.coerceAtLeast(0)
        // One unit without a goal under way, to show the empty state.
        if (units[index].id == "sim-shopping") return UnitGoals(units[index].id, LocalDate.now().toString(), emptyList())
        val factor = 1 + index * .35; val target = 60000.0; val current = (15000.0 * factor).coerceAtMost(target * 1.3)
        val daily = target / 31; val projection = current / 8 * 31
        val next = listOf("Meta" to target, "UP" to target * 1.2).firstOrNull { current < it.second }
        val mine = index <= 1
        return UnitGoals(units[index].id, LocalDate.now().toString(), listOf(Goal("goal-$index", "Faturamento", "2026-10-01", "2026-10-31",
            GoalSummary(current, listOf(GoalLevel("target", "Meta", target, current >= target), GoalLevel("up", "UP", target * 1.2, current >= target * 1.2)), Math.round(current / target * 1000) / 10.0, next?.let { NextLevel(it.first, it.second - current) }, 31, 8, 23, true, projection, next?.let { (it.second - current) / 23 }, daily),
            listOf(2100.0, 1800.0, 2400.0, 1500.0, 2050.0, 1950.0, 2300.0, 900.0).mapIndexed { day, value -> GoalDay(LocalDate.now().minusDays((7 - day).toLong()).toString(), value * factor, value * factor >= daily) },
            listOfNotNull(GoalMember(simulatedUserName, isMe = true, role = "fixed", currentValue = current / 2, targetValue = target / 2, percent = Math.round(current / target * 1000) / 10.0, prize = 120.0, color = "#BDB2FF").takeIf { mine },
                GoalMember("Bia", isMe = false, role = "relief", currentValue = current / 2, targetValue = target / 2, percent = Math.round(current / target * 1000) / 10.0, prize = 0.0), GoalMember("Caio", isMe = false, role = "leader", currentValue = current * .6, targetValue = target / 2, percent = Math.round(current * .6 / (target / 2) * 1000) / 10.0, prize = 150.0, color = "#FFADAD").takeIf { !mine }),
            Prize("Simulação", listOf(PrizeTier("Meta", target, 300.0, 2.0, current >= target), PrizeTier("UP", target * 1.2, 600.0, 2.5, current >= target * 1.2)), highestTierLabel = if (current >= target * 1.2) "UP" else if (current >= target) "Meta" else null, totalTeamBonus = if (current >= target) 300.0 + (current - target) * .02 else 0.0, leadershipBonus = 0.0))))
    }
    override suspend fun signage() = SignageUnits(units.mapIndexed { index, row -> SignageUnit(row.id, row.name, if (index % 3 == 2) emptyList() else listOf(SignageScreen(row.id, "Tela 1", if (index % 2 == 0) "landscape" else "portrait", index % 2 == 0)), if (index % 3 == 2) "Tela 1" else "Tela 2", false) })
    // Ponto in simulation: a fixed clock reading, two punches today and nothing reaches the server.
    private val simulatedMarkings = mutableListOf<OwnMarking>()
    private fun zoned(date: LocalDate, time: String) = "${date}T$time:00-03:00"
    private fun seedMarkings() { if (simulatedMarkings.isEmpty()) {
        val today = LocalDate.now()
        (1L..3L).forEach { back -> val day = today.minusDays(back); listOf("08:01", "12:02", "13:00", "16:04").forEachIndexed { index, time -> simulatedMarkings += OwnMarking("sim-$day-$index", day.toString(), 100L + back * 10 + index, zoned(day, time), unit.id, "01", "available") } }
        listOf("08:03", "12:00").forEachIndexed { index, time -> simulatedMarkings += OwnMarking("sim-$today-$index", today.toString(), 200L + index, zoned(today, time), unit.id, "01", if (index == 1) "pending" else "available") }
    } }
    override suspend fun timeOptions(workDate: String) = TimeOptions(workDate, true, true, listOf(ExecutionUnit(unit.id, unit.name, true), ExecutionUnit(units[1].id, units[1].name)), OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza"))
    override suspend fun offlinePermit(request: OfflinePermitRequest) = OfflinePermitResponse(OfflinePermit(
        "simulation-offline-permit", request.installationId, request.deviceKeyId, request.keySecurity, request.bootCount,
        request.anchorElapsedRealtimeMs, java.time.Instant.now().toString(), java.time.Instant.now().toString(),
        java.time.Instant.now().plusSeconds(12 * 60 * 60).toString(), listOf(OfflinePermitUnit(unit.id, unit.name, "America/Fortaleza"))))
    override suspend fun mark(request: MarkingRequest): MarkingResponse {
        seedMarkings()
        val nsr = 300L + simulatedMarkings.size
        val at = java.time.OffsetDateTime.now(java.time.ZoneOffset.ofHours(-3)).withNano(0).toString()
        simulatedMarkings += OwnMarking("sim-new-$nsr", request.workDate, nsr, at, request.executionUnitId, "01", "available")
        return MarkingResponse("recorded", "sim-new-$nsr", "available", null, RecordedMarking(nsr, at, request.executionUnitId))
    }
    override suspend fun markings(startDate: String, endDate: String): OwnMarkings { seedMarkings(); return OwnMarkings(startDate, endDate, simulatedMarkings.filter { it.workDate in startDate..endDate }) }
    override suspend fun timeMonth(month: String): OwnMonth {
        val first = java.time.YearMonth.parse(month).atDay(1)
        return OwnMonth(month, (0 until first.lengthOfMonth()).map { first.plusDays(it.toLong()) }.map { date ->
            if (date.dayOfWeek.value == 7) OwnShift(date.toString(), "day_off") else OwnShift(date.toString(), "work", "08:00", "16:00", unitId = unit.id, unitName = unit.name, shiftName = "Manhã", breakType = "staggered", breakDurationMinutes = 60, breakWindowStart = "11:30", breakWindowEnd = "13:45")
        })
    }
    // A minimal PDF, so open, share and save can be tried in simulation.
    override suspend fun receipt(receiptId: String): ResponseBody = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF".toResponseBody("application/pdf".toMediaType())
    override suspend fun adjustments(month: String) = OwnAdjustments(emptyList())
    override suspend fun requestAdjustment(request: AdjustmentRequest) = AdjustmentCreated(Adjustment("simulation-adjustment", request.workDate, request.kind, "in_review", 1, reason = request.reason, createdAt = java.time.Instant.now().toString()))
    override suspend fun timeBank(date: String) = TimeBankResponse(TimeBankPolicy("simulation-policy", 1, "Banco de simulação", true),
        TimeBankStatement(TimeBankCycle(date.take(7) + "-01", date, 0), balanceMinutes = 95, credit = 180, debit = 85, nightMinutes = 60,
            lines = listOf(TimeBankStatementLine(date, date.take(7), 0, TimeBankLineValue("bank_credit", 60, "worked_more")),
                TimeBankStatementLine(date, date.take(7), 0, TimeBankLineValue("bank_debit", 25, "worked_less")))), listOf(date.take(7)))
    override suspend fun mirror(competence: String) = MirrorStatus(competence, ClosureStatus("closed", 1),
        MirrorFileStatus("simulation", java.time.Instant.now().toString()), ClosingPackageStatus("signed", signedAt = java.time.Instant.now().toString()))
    override suspend fun mirrorPdf(competence: String): ResponseBody = receipt("simulation-mirror")
    override suspend fun absenceOptions() = AbsenceOptions(listOf(AbsenceOption("sim-medical", "Atestado médico", listOf("day", "hour"), attachmentRequired = true), AbsenceOption("sim-personal", "Assunto particular", listOf("day"))), AbsenceCapabilities(true))
    override suspend fun absencePreview(request: AbsencePeriod) = AbsencePreviewResponse(AbsencePreview(PreviewType(request.absenceTypeId, if (request.absenceTypeId == "sim-medical") "Atestado médico" else "Assunto particular"),
        PreviewPeriod(request.startDate, request.endDate, request.startTime, request.endTime), PreviewQuantity((java.time.temporal.ChronoUnit.DAYS.between(LocalDate.parse(request.startDate), LocalDate.parse(request.endDate)) + 1).toDouble(), request.unit), 3, request.absenceTypeId == "sim-medical"))
    override suspend fun prepareAbsence(proposedRequestId: RequestBody, files: List<MultipartBody.Part>) = AbsencePreparation("simulation", files.indices.map { "simulation-file-$it" })
    override suspend fun createAbsence(request: AbsenceDraftRequest) = AbsenceRequestEnvelope(AbsenceRequestRow("simulation-absence", "draft", 1, "Atestado médico", AbsenceInput(request.request.startDate, request.request.endDate, request.request.startTime, request.request.endTime), 1.0, request.request.unit, request.reason, createdAt = java.time.Instant.now().toString()))
    override suspend fun submitAbsence(requestId: String, request: AbsenceSubmit) = AbsenceRequestEnvelope(AbsenceRequestRow(requestId, "in_review", 2, "Atestado médico", AbsenceInput(LocalDate.now().toString(), LocalDate.now().toString()), 1.0, "day", createdAt = java.time.Instant.now().toString()))
    override suspend fun absences() = AbsenceRequests(listOf(AbsenceRequestRow("sim-a1", "approved", 3, "Atestado médico", AbsenceInput(LocalDate.now().minusDays(9).toString(), LocalDate.now().minusDays(9).toString()), 1.0, "day", approvedByInaction = true, createdAt = "2026-10-01T12:00:00Z")))
    override suspend fun vouchers() = VoucherRequests(listOf(VoucherRequest("sim-v1", "activate", "approved", "Linha 401", "2026-09-02", "2026-10-01", createdAt = "2026-09-02T12:00:00Z")))
    override suspend fun requestVoucher(request: VoucherRequestCreate) = VoucherCreated(VoucherRequest("simulation-voucher", request.action, "pending", request.details, LocalDate.now().toString(), LocalDate.now().plusMonths(1).withDayOfMonth(1).toString(), createdAt = java.time.Instant.now().toString()))
    private fun simulatedSwapOptions(): ShiftSwapOptions {
        val date = LocalDate.now().plusDays(3).toString()
        return ShiftSwapOptions(
            listOf(ShiftSwapOption("simulation-schedule", "simulation-own-shift", unit.id, unit.name, date, "08:00", "16:00", "simulation-morning", "Manhã", "simulation-user", simulatedUserName)),
            listOf(ShiftSwapOption("simulation-schedule", "simulation-target-shift", unit.id, unit.name, date, "14:00", "22:00", "simulation-afternoon", "Tarde", "simulation-bia", "Bia")),
            LocalDate.now().plusDays(62).toString())
    }
    private fun simulatedSwap(status: String = "pending", version: Int = 1): ShiftSwapRequest {
        val options = simulatedSwapOptions(); val offered = options.ownShifts.single(); val requested = options.candidateShifts.single(); val now = java.time.Instant.now().toString()
        return ShiftSwapRequest("simulation-swap", status, version, offered.occupantUid, offered.occupantName, requested.occupantUid, requested.occupantName,
            ShiftSwapShift(offered.scheduleId, offered.shiftId, offered.unitId, offered.unitName, offered.date, offered.startTime, offered.endTime, offered.shiftDefinitionId, offered.shiftName, offered.occupantUid, offered.occupantName),
            ShiftSwapShift(requested.scheduleId, requested.shiftId, requested.unitId, requested.unitName, requested.date, requested.startTime, requested.endTime, requested.shiftDefinitionId, requested.shiftName, requested.occupantUid, requested.occupantName),
            events = emptyList(), createdAt = now, updatedAt = now, viewerActions = ShiftSwapViewerActions(cancel = status == "pending"))
    }
    override suspend fun shiftSwapOptions() = simulatedSwapOptions()
    override suspend fun shiftSwaps() = ShiftSwapRequests(listOf(simulatedSwap()))
    override suspend fun requestShiftSwap(request: ShiftSwapCreate) = ShiftSwapCreated(simulatedSwap())
    override suspend fun decideShiftSwap(requestId: String, request: ShiftSwapDecision) = ShiftSwapCreated(simulatedSwap(if (request.action == "accept") "accepted" else if (request.action == "reject") "rejected" else "cancelled", 2))
    override suspend fun pair(request: PairScreen) = PairResponse(PairedScreen(request.screenId ?: "simulation-screen", if (request.screenId == null) "Tela 2" else "Tela 1", unitOf(request.kioskId).name, request.orientation), request.screenId == null)
}
