package com.coalaone.go.ui

import androidx.lifecycle.viewModelScope
import com.coalaone.go.auth.RuntimeMode
import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules
import com.coalaone.go.offline.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import javax.inject.Inject

data class PendingWithdrawalLink(val purchase: AwaitingPurchase, val withdrawal: Withdrawal)
data class PurchaseState(
    val context: PurchaseContext? = null,
    val withdrawals: Withdrawals? = null,
    val selected: PendingUpload? = null,
    val analysis: ReceiptAnalysis? = null,
    val review: ConfirmPurchase? = null,
    val queue: List<QueueRow> = emptyList(),
    val result: PurchaseResult? = null,
    val pendingLink: PendingWithdrawalLink? = null,
    val linkFocusRequest: Int = 0,
    val organizationFilter: String = Rules.ALL_UNITS,
    val groupFilter: String = Rules.ALL_UNITS,
    val unitFilter: String = Rules.ALL_UNITS,
)
@HiltViewModel class PurchaseViewModel @Inject constructor(private val repository: ApiRepository, private val mode: RuntimeMode, private val queue: UploadQueue, private val sync: QueueSync, private val scheduler: WorkScheduler) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(PurchaseState())
    val state = mutable.asStateFlow()
    init {
        refresh()
        if (!mode.simulation) viewModelScope.launch { queue.observe(mode.identity().uid).collect { rows -> mutable.update { it.copy(queue = rows) } } }
    }
    fun refresh() = run { mutable.update { it.copy(context = repository.api.purchaseContext(), withdrawals = repository.api.withdrawals()) } }
    fun select(source: String, withdrawal: Withdrawal? = null) {
        val active = mutable.value.pendingLink
        if (active != null) {
            mutable.update { it.copy(linkFocusRequest = it.linkFocusRequest + 1) }
            if (withdrawal?.sourceId != active.withdrawal.sourceId) feedbackMutable.value = Feedback(notice = "Conclua ou cancele a vinculação em andamento antes de iniciar outra compra.")
            return
        }
        mutable.update { it.copy(selected = PendingUpload(UUID.randomUUID().toString(), Instant.now().toString(), "", source, emptyList(), emptyList(), withdrawal), analysis = null, review = null, result = null, pendingLink = null) }
    }
    fun note(value: String) { mutable.update { it.copy(selected = it.selected?.copy(note = value.take(240))) } }
    fun attach(document: Document, proof: Boolean) {
        val selected = mutable.value.selected ?: return
        val documents = if (proof) selected.paymentProofs else selected.receipts
        if (documents.size >= 2) { feedbackMutable.value = Feedback(error = "Escolha até dois arquivos por documento."); return }
        mutable.update { it.copy(selected = if (proof) selected.copy(paymentProofs = documents + document) else selected.copy(receipts = documents + document)) }
    }
    fun remove(index: Int, proof: Boolean) { mutable.update { current -> current.copy(selected = current.selected?.let { upload -> if (proof) upload.copy(paymentProofs = upload.paymentProofs.filterIndexed { i, _ -> i != index }) else upload.copy(receipts = upload.receipts.filterIndexed { i, _ -> i != index }) }) } }
    fun upload() = run {
        val input = mutable.value.selected ?: return@run
        Rules.validateUpload(input)
        if (mode.simulation) { showReview(input, repository.upload(input)); return@run }
        val uid = mode.identity().uid
        queue.enqueue(uid, input)
        queue.retry(uid, input.submissionId)
        scheduler.schedule(uid)
        sync.sync(uid)
        val response = queue.acknowledged(uid, input.submissionId)
        if (response == null) {
            val blocked = queue.list(uid).any { it.id == input.submissionId && it.state == "BLOCKED" }
            mutable.update { it.copy(selected = null) }
            feedbackMutable.value = Feedback(notice = if (blocked) "Envio protegido na fila. Abra os documentos pendentes para revisar o erro e corrigir o envio." else "Nota protegida na fila. Volte quando houver conexão para revisar os dados.")
        } else showReview(input, response)
    }
    fun sync() = run("Sincronização concluída; abra os envios recebidos para revisar.") { if (!mode.simulation) { scheduler.schedule(mode.identity().uid); sync.sync(mode.identity().uid) } }
    fun resume(row: QueueRow) = run {
        val uid = mode.identity().uid
        val payload = queue.payload(uid, row.id)
        val response = queue.acknowledged(uid, row.id)
        if (response != null) showReview(payload, response) else mutable.update { it.copy(selected = payload, review = null) }
    }
    private fun showReview(input: PendingUpload, response: UploadResponse) {
        val analysis = response.submission.analysis ?: ReceiptAnalysis()
        val context = mutable.value.context ?: error("Contexto indisponível")
        val unit = input.withdrawal?.unitId ?: context.units.singleOrNull()?.id.orEmpty()
        val center = context.resultCenters.firstOrNull { it.unitId == unit }?.id.orEmpty()
        val review = ConfirmPurchase(input.submissionId, unit, analysis.supplierName.orEmpty(), analysis.supplierTaxId, analysis.purchaseDate ?: LocalDate.now().toString(), analysis.amountCents ?: 0, input.fundingSource, analysis.payment?.method?.takeIf { it != "unknown" && input.fundingSource == "company_payment" }, analysis.suggestedAccountId.orEmpty(), center, input.note, analysis.items.map { item -> PurchaseItem(item.description, item.quantity ?: 0.0, item.unit ?: "un", item.unitPriceCents ?: 0, item.totalCents ?: 0, stock = item.productId?.let { StockEntry(it, item.packages ?: 0.0) }, aiTreatment = item.aiTreatment, aiConfidence = item.aiConfidence, aiReason = item.aiReason) }, input.withdrawal?.let { WithdrawalLink(it.sourceId, it.date) })
        mutable.update { it.copy(selected = input, analysis = analysis, review = review) }
    }
    fun review(value: ConfirmPurchase) { mutable.update { it.copy(review = value) } }
    fun leaveReview() { mutable.update { it.copy(selected = null, review = null, analysis = null) } }
    fun confirm() = run("Compra confirmada.") {
        val current = mutable.value; val input = current.review ?: return@run
        val withdrawal = current.selected?.withdrawal
        require(withdrawal == null || input.unitId == withdrawal.unitId && input.totalCents <= withdrawal.amountCents) { "A unidade e o valor devem corresponder à sangria escolhida." }
        var result = repository.confirm(input)
        if (result.purchase.stockEntry == "pending") result = repository.confirm(input)
        if (!mode.simulation) queue.confirmed(mode.identity().uid, input.submissionId, result)
        mutable.update { it.copy(selected = null, review = null, analysis = null, result = result.purchase) }
    }
    fun prepareLink(purchase: AwaitingPurchase, withdrawal: Withdrawal) {
        val active = mutable.value.pendingLink
        if (active != null && (active.purchase.id != purchase.id || active.withdrawal.sourceId != withdrawal.sourceId)) {
            mutable.update { it.copy(linkFocusRequest = it.linkFocusRequest + 1) }
            feedbackMutable.value = Feedback(notice = "Já existe uma vinculação em andamento. Retome ou cancele antes de escolher outra.")
            return
        }
        mutable.update { it.copy(pendingLink = PendingWithdrawalLink(purchase, withdrawal), linkFocusRequest = it.linkFocusRequest + 1, organizationFilter = Rules.ALL_UNITS, groupFilter = Rules.ALL_UNITS, unitFilter = withdrawal.unitId) }
    }
    fun resumeLink() { if (mutable.value.pendingLink != null) mutable.update { it.copy(linkFocusRequest = it.linkFocusRequest + 1) } }
    fun cancelLink() { mutable.update { it.copy(pendingLink = null) } }
    fun filterOrganization(id: String) { mutable.update { it.copy(organizationFilter = id, groupFilter = Rules.ALL_UNITS, unitFilter = Rules.ALL_UNITS) } }
    fun filterGroup(id: String) { mutable.update { it.copy(groupFilter = id, unitFilter = Rules.ALL_UNITS) } }
    fun filterUnit(id: String) { mutable.update { it.copy(unitFilter = id) } }
    fun link() = run("Compra conciliada com a sangria.") {
        val selection = mutable.value.pendingLink ?: return@run
        require(selection.purchase.unitId == selection.withdrawal.unitId) { "A sangria deve ser da mesma unidade." }
        repository.api.link(LinkWithdrawal(selection.purchase.id, WithdrawalLink(selection.withdrawal.sourceId, selection.withdrawal.date)))
        mutable.update { it.copy(withdrawals = repository.api.withdrawals(), pendingLink = null) }
    }
}
