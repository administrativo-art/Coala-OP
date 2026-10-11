package com.coalaone.go.data

import okhttp3.MultipartBody
import okhttp3.RequestBody
import java.time.LocalDate
import javax.inject.Inject

class DemoApi @Inject constructor() : ApiService {
    private val unit = UnitRef("simulation-unit", "Unidade de simulação")
    override suspend fun release() = Release(4, "0.2.0", 0, "/app/CoalaGo.apk")
    override suspend fun reset(request: ResetRequest) = Unit
    override suspend fun profile() = ProfileResponse(Profile("Ana (simulação)", "simulation@invalid.local", "Atendente"), Modules(true, true, true, true, true, true))
    override suspend fun avatar(photo: MultipartBody.Part) = AvatarResponse("")
    override suspend fun countContext() = CountContext(listOf(unit), emptyList(), listOf(ExitReason("SAIDA_CONSUMO", "Venda/Consumo"), ExitReason("SAIDA_DESCARTE_VENCIMENTO", "Vencimento"), ExitReason("SAIDA_DESCARTE_AVARIA", "Avaria"), ExitReason("SAIDA_DESCARTE_OUTROS", "Outros")))
    override suspend fun startCount(request: StartCountRequest) = StartedCount(CountSession("simulation-count", unit.id, unit.name, "pending_review", "2026-10-01T12:00:00Z", items = listOf(CountItem("l1", "Leite integral (1 L)", "SIM-001", "2026-12-01", 12.0, "caixa"), CountItem("l2", "Açúcar refinado (1 kg)", "SIM-002", null, 5.0, "pacote"), CountItem("l3", "Copo descartável", "SIM-003", null, 8.0, "pacote"), CountItem("l4", "Canudo", "SIM-004", null, 2.0, "pacote"))), false)
    override suspend fun saveCount(request: SaveCountRequest) = SavedCount(if (request.complete) "completed" else "pending_review", false, request.entries.size)
    override suspend fun cancelCount(request: SessionRequest) = CancelledCount(true, false)
    override suspend fun repositions() = Repositions(listOf(Reposition("simulation-reposition", "Centro de distribuição", unit.id, unit.name, "2026-10-01T12:00:00Z", rows = listOf(RepositionRow("b1", "l1", "Leite integral", "SIM-001", 12.0), RepositionRow("b2", "l2", "Açúcar", "SIM-002", 5.0)))), false)
    override suspend fun receive(request: ReceiveRequest) = Received("received", request.rows.any { it.notes.isNotBlank() }, false)
    override suspend fun withdrawals() = Withdrawals(listOf(Withdrawal("a".repeat(64), unit.id, unit.name, "2026-10-01", amountCents = 5000)), emptyList(), DateWindow("2026-10-01", "2026-10-31"), false)
    override suspend fun purchaseContext() = PurchaseContext(listOf(unit), listOf(UnitRef("account", "Insumos")), listOf(ResultCenter("center", unit.name, unit.id)), listOf(StockProduct("milk", "Leite integral", "1 L")))
    override suspend fun upload(fields: Map<String, RequestBody>, documents: List<MultipartBody.Part>, expectedOwner: String?) = UploadResponse(Submission("simulation-submission", false, "pending_review", ReceiptAnalysis("Fornecedor de simulação", null, "2026-10-01", 5000, listOf(AnalysisItem("Leite integral", 10.0, "un", 500, 5000)), "high")))
    override suspend fun confirm(request: ConfirmPurchase) = PurchaseResponse(PurchaseResult("simulation-purchase", "confirmed", stockEntry = "done", stockItemCount = request.items.count { it.stock != null }))
    override suspend fun link(request: LinkWithdrawal) = PurchaseResponse(PurchaseResult(request.purchaseId, "linked", changeCents = 0))
    override suspend fun schedule(year: Int, month: Int): MonthSchedule {
        val first = LocalDate.of(year, month, 1)
        val people = listOf(SchedulePerson("Ana", "Atendente", true), SchedulePerson("Bia", "Atendente", false))
        val shifts = (1..first.lengthOfMonth()).flatMap { day -> people.indices.map { index -> ScheduleShift(index, first.withDayOfMonth(day).toString(), "08:00", "16:00", if ((day + index) % 7 == 0) "day_off" else "work", "Manhã") } }
        return MonthSchedule(LocalDate.now().toString(), year, month, true, listOf(ScheduleUnit(unit.id, unit.name, people, shifts)))
    }
    override suspend fun goalUnits() = GoalUnits(listOf(unit))
    override suspend fun goals(kioskId: String) = UnitGoals(unit.id, LocalDate.now().toString(), listOf(Goal("goal", "Faturamento", "2026-10-01", "2026-10-31", GoalSummary(15000.0, listOf(GoalLevel("target", "Meta", 60000.0, false)), 25.0, NextLevel("Meta", 45000.0), 31, 8, 23, true, 58125.0, 1956.52, 1935.48), listOf(GoalDay("2026-10-01", 1500.0, false)), listOf(GoalMember("Ana", isMe = true, role = "fixed", currentValue = 7500.0, targetValue = 30000.0, percent = 25.0, prize = 120.0)), Prize("Simulação", listOf(PrizeTier("Meta", 60000.0, 300.0, 2.0, false)), totalTeamBonus = 300.0, leadershipBonus = 0.0))))
    override suspend fun signage() = SignageUnits(listOf(SignageUnit(unit.id, unit.name, listOf(SignageScreen(unit.id, "Tela 1", "landscape", true)), "Tela 2", false)))
    override suspend fun pair(request: PairScreen) = PairResponse(PairedScreen(request.screenId ?: "simulation-screen", "Tela 2", unit.name, request.orientation), request.screenId == null)
}
