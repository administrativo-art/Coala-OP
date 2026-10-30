package com.coalaone.go

import com.coalaone.go.auth.*
import com.coalaone.go.data.*
import com.coalaone.go.offline.*
import kotlinx.coroutines.flow.MutableStateFlow
import java.time.Instant

class TestAuth : AuthGateway {
    val mutable = MutableStateFlow<Identity?>(Identity("test-owner", "test@example.invalid"))
    override val identities = mutable
    override val current get() = mutable.value
    var rejectPassword = false
    var googleExpectedUid: String? = null
    var googleToken: String? = null
    var googleEmail = "google@example.invalid"
    override suspend fun login(email: String, password: String) = Identity("test-owner", email).also { mutable.value = it }
    override suspend fun loginWithGoogle(idToken: String, expectedUid: String?) =
        Identity(expectedUid ?: "test-owner", googleEmail).also {
            googleToken = idToken
            googleExpectedUid = expectedUid
            mutable.value = it
        }
    override suspend fun reauthenticate(password: String) { if (rejectPassword) error("Bad password") }
    override suspend fun token(forceRefresh: Boolean) = "test-token"
    override fun signOut() { mutable.value = null }
}
class MemoryQueue : UploadQueue {
    val rows = MutableStateFlow<List<QueueRow>>(emptyList())
    val payloads = mutableMapOf<Pair<String, String>, PendingUpload>()
    val acks = mutableMapOf<Pair<String, String>, UploadResponse>()
    override fun observe(uid: String) = rows
    override suspend fun enqueue(uid: String, upload: PendingUpload) {
        payloads[uid to upload.submissionId] = upload
        if (rows.value.none { it.id == upload.submissionId && it.owner == uid }) rows.value += QueueRow(uid, upload.submissionId, 0)
    }
    override suspend fun payload(uid: String, id: String) = payloads.getValue(uid to id)
    override suspend fun acknowledged(uid: String, id: String) = acks[uid to id]
    override suspend fun list(uid: String) = rows.value.filter { it.owner == uid }
    override suspend fun markUploaded(uid: String, id: String, response: UploadResponse) { acks[uid to id] = response; rows.value = rows.value.map { if (it.owner == uid && it.id == id) it.copy(state = "UPLOADED") else it } }
    override suspend fun markFailed(uid: String, id: String, failure: AppFailure) { rows.value = rows.value.map { if (it.owner == uid && it.id == id) it.copy(error = failure.message, retryCount = it.retryCount + 1, state = if (failure.retryable) "READY" else "BLOCKED") else it } }
    override suspend fun retry(uid: String, id: String) { rows.value = rows.value.map { if (it.owner == uid && it.id == id && it.state == "BLOCKED") it.copy(state = "READY") else it } }
    override suspend fun confirmed(uid: String, id: String, response: PurchaseResponse) { rows.value = rows.value.filterNot { it.owner == uid && it.id == id && it.state == "UPLOADED" }; payloads.remove(uid to id) }
    override suspend fun discard(uid: String, id: String) { rows.value = rows.value.filterNot { it.owner == uid && it.id == id }; payloads.remove(uid to id); acks.remove(uid to id) }
}
class MemoryDrafts : CountDraftStore {
    val values = mutableMapOf<Pair<String, String>, StoredCountDraft>()
    override suspend fun load(uid: String, sessionId: String) = values[uid to sessionId]
    override suspend fun save(uid: String, sessionId: String, draft: StoredCountDraft) { values[uid to sessionId] = draft }
    override suspend fun clear(uid: String, sessionId: String) { values.remove(uid to sessionId) }
}
class MemoryTimeOfflineQueue : TimeOfflineQueue {
    val rows = MutableStateFlow<List<TimeMarkingRow>>(emptyList())
    var savedPermit: OfflinePermit? = null
    var cachedOptionsValue: TimeOptions? = null
    var permitRequestValue: OfflinePermitRequest? = null
    var readyRows = emptyList<Pair<TimeMarkingRow, MarkingRequest>>()
    val syncedIds = mutableListOf<String>()
    val failures = mutableListOf<Pair<String, AppFailure>>()
    val capturedUnitIds = mutableListOf<String>()
    val capturedPurposes = mutableListOf<String>()
    override fun observe(uid: String) = rows
    override suspend fun permitRequest(uid: String, workDate: String, elapsedRealtimeMs: Long, scope: String) = permitRequestValue
    override suspend fun savePermit(uid: String, permit: OfflinePermit) { savedPermit = permit }
    override suspend fun permit(uid: String) = savedPermit
    override suspend fun cachedOptions(uid: String, elapsedRealtimeMs: Long): TimeOptions? = cachedOptionsValue
    override suspend fun capture(uid: String, executionUnitId: String, elapsedRealtimeMs: Long, declaredPurpose: String): CapturedOfflineMarking {
        capturedUnitIds += executionUnitId; capturedPurposes += declaredPurpose
        val id = java.util.UUID.randomUUID().toString(); rows.value += TimeMarkingRow(uid, id, "permit", rows.value.size + 1, 0, sealed = byteArrayOf())
        return CapturedOfflineMarking(id, "2026-10-19T08:00:00-0300", "2026-10-19")
    }
    override suspend fun ready(uid: String) = readyRows
    override suspend fun synced(uid: String, id: String) {
        if (readyRows.any { it.first.id == id } || rows.value.any { it.id == id }) syncedIds += id
        rows.value = rows.value.filterNot { it.id == id }
    }
    override suspend fun failed(uid: String, id: String, failure: AppFailure) { failures += id to failure }
}
fun pending() = PendingUpload("11111111-1111-4111-8111-111111111111", "2026-10-01T12:00:00Z", "Compra", "cash_withdrawal", listOf(Document("nota.jpg", "image/jpeg", byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 1))), emptyList())
fun purchase() = ConfirmPurchase(pending().submissionId, "unit", "Fornecedor", null, "2026-10-01", 5000, "cash_withdrawal", null, "account", "center", items = listOf(PurchaseItem("Leite", 10.0, "un", 500, 5000)))
fun countSession() = CountSession("count", "unit", "Unidade", "pending_review", "2026-10-01T12:00:00Z", "2026-10-01T13:00:00Z", listOf(CountItem("lot", "Leite", "L1", null, 12.0, "caixa")))
fun repository(auth: TestAuth = TestAuth(), api: ApiService = DemoApi()) = ApiRepository(api, DemoApi(), RuntimeMode(auth))
fun timeViewModel(auth: TestAuth, repository: ApiRepository, saved: androidx.lifecycle.SavedStateHandle,
    queue: MemoryTimeOfflineQueue = MemoryTimeOfflineQueue()): com.coalaone.go.ui.TimeViewModel =
    com.coalaone.go.ui.TimeViewModel(repository, saved, auth, queue, TimeOfflineSync(auth, queue, repository), TimeOfflineWorkScheduler { })
