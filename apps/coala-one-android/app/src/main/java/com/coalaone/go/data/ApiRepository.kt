package com.coalaone.go.data

import com.coalaone.go.domain.Rules
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import javax.inject.Inject
import javax.inject.Singleton

interface MobileRepository {
    suspend fun profile(): ProfileResponse
    suspend fun countContext(): CountContext
    suspend fun startCount(kioskId: String): CountSession
    suspend fun saveCount(input: SaveCountRequest): SavedCount
    suspend fun cancelCount(sessionId: String): CancelledCount
    suspend fun repositions(): Repositions
    suspend fun receive(input: ReceiveRequest): Received
    suspend fun upload(input: PendingUpload, expectedUid: String? = null): UploadResponse
    suspend fun cancelUpload(submissionId: String)
}
@Singleton class ApiRepository @Inject constructor(private val liveApi: ApiService, private val demo: DemoApi, private val mode: com.coalaone.go.auth.RuntimeMode) : MobileRepository {
    val api: ApiService get() = if (mode.simulation) demo else liveApi
    override suspend fun profile() = api.profile()
    override suspend fun countContext() = api.countContext()
    override suspend fun startCount(kioskId: String) = api.startCount(StartCountRequest(kioskId)).session
    override suspend fun saveCount(input: SaveCountRequest) = api.saveCount(input)
    override suspend fun cancelCount(sessionId: String) = api.cancelCount(SessionRequest(sessionId))
    override suspend fun repositions() = api.repositions()
    override suspend fun receive(input: ReceiveRequest) = api.receive(input)
    override suspend fun upload(input: PendingUpload, expectedUid: String?): UploadResponse {
        Rules.validateUpload(input)
        val fields = mutableMapOf("submissionId" to input.submissionId, "capturedAt" to input.capturedAt, "fundingSource" to input.fundingSource)
        if (input.note.isNotBlank()) fields["note"] = input.note.trim()
        fun parts(role: String, documents: List<Document>) = documents.map { MultipartBody.Part.createFormData(role, it.name, it.bytes.toRequestBody(it.mimeType.toMediaType())) }
        val result = api.upload(fields.mapValues { it.value.toRequestBody("text/plain".toMediaType()) }, parts("receipt", input.receipts) + parts("paymentProof", input.paymentProofs), if (mode.simulation) null else expectedUid ?: mode.identity().uid)
        require(result.submission.id.isNotBlank() && result.submission.status.isNotBlank()) { "Confirmação inválida: o envio permanece na fila." }
        return result
    }
    override suspend fun cancelUpload(submissionId: String) {
        val status = api.cancelUpload(CancelUpload(submissionId)).submission.status
        require(status == "cancelled" || status == "not_found") { "Cancelamento não confirmado: a nota continua guardada." }
    }
    suspend fun avatar(document: Document) = api.avatar(MultipartBody.Part.createFormData("photo", document.name, document.bytes.toRequestBody(document.mimeType.toMediaType()))).avatarUrl
    suspend fun confirm(input: ConfirmPurchase): PurchaseResponse { Rules.validatePurchase(input); return api.confirm(input) }
}
