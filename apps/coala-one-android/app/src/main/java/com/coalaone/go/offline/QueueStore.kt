package com.coalaone.go.offline

import android.content.Context
import android.util.AtomicFile
import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

interface UploadQueue {
    fun observe(uid: String): Flow<List<QueueRow>>
    suspend fun enqueue(uid: String, upload: PendingUpload)
    suspend fun payload(uid: String, id: String): PendingUpload
    suspend fun acknowledged(uid: String, id: String): UploadResponse?
    suspend fun list(uid: String): List<QueueRow>
    suspend fun markUploaded(uid: String, id: String, response: UploadResponse)
    suspend fun markFailed(uid: String, id: String, failure: AppFailure)
    suspend fun retry(uid: String, id: String)
    suspend fun confirmed(uid: String, id: String, response: PurchaseResponse)
    suspend fun discard(uid: String, id: String)
}
@Singleton class QueueStore @Inject constructor(@ApplicationContext context: Context, private val db: QueueDatabase, private val vault: Vault, private val json: Json) : UploadQueue {
    private val directory = File(context.noBackupFilesDir, "coala-go-queue").apply { mkdirs() }
    private val mutex = Mutex()
    private fun file(uid: String, id: String): File {
        java.util.UUID.fromString(id)
        return File(directory, "${vault.owner(uid)}-$id.enc")
    }
    override fun observe(uid: String) = db.queue().observe(vault.owner(uid))
    override suspend fun enqueue(uid: String, upload: PendingUpload) = withContext(Dispatchers.IO) { mutex.withLock {
        Rules.validateUpload(upload)
        val owner = vault.owner(uid)
        val existing = db.queue().get(owner, upload.submissionId)
        if (existing != null && (existing.state != "BLOCKED" || existing.acknowledgement != null)) return@withLock
        if (existing == null) require(db.queue().total() < 20) { "O aparelho já tem 20 notas pendentes. Sincronize antes de guardar outra." }
        val destination = file(uid, upload.submissionId)
        val atomic = AtomicFile(destination)
        val stream = atomic.startWrite()
        try {
            val sealed = vault.seal(uid, upload.submissionId, json.encodeToString(upload).toByteArray())
            stream.write(sealed); atomic.finishWrite(stream)
            if (existing == null) db.queue().insert(QueueRow(owner, upload.submissionId, System.currentTimeMillis()))
            else db.queue().retry(owner, upload.submissionId)
        } catch (cause: Exception) { atomic.failWrite(stream); throw cause }
    } }
    override suspend fun payload(uid: String, id: String) = withContext(Dispatchers.IO) {
        require(db.queue().get(vault.owner(uid), id) != null) { "Envio indisponível para esta conta." }
        json.decodeFromString<PendingUpload>(vault.open(uid, id, file(uid, id).readBytes()).decodeToString())
    }
    override suspend fun acknowledged(uid: String, id: String): UploadResponse? {
        val row = db.queue().get(vault.owner(uid), id) ?: return null
        return row.acknowledgement?.let { json.decodeFromString<UploadResponse>(vault.open(uid, "$id:ack", it).decodeToString()) }
    }
    override suspend fun list(uid: String): List<QueueRow> = withContext(Dispatchers.IO) { mutex.withLock {
        val owner = vault.owner(uid)
        // Recover the atomic file if the process stopped before the Room insert.
        // A durable CONFIRMED tombstone prevents resurrecting a completed item
        // if the process stopped between the acknowledgement and file deletion.
        directory.listFiles()?.filter { it.isFile && it.name.startsWith("$owner-") && it.name.endsWith(".enc") }?.forEach { stored ->
            val id = stored.name.removePrefix("$owner-").removeSuffix(".enc")
            val row = db.queue().get(owner, id)
            if (row?.state == "CONFIRMED") stored.delete()
            else if (row == null) {
                val upload = json.decodeFromString<PendingUpload>(vault.open(uid, id, stored.readBytes()).decodeToString())
                require(upload.submissionId == id); Rules.validateUpload(upload)
                db.queue().insert(QueueRow(owner, id, stored.lastModified()))
            }
        }
        db.queue().list(owner)
    } }
    override suspend fun markUploaded(uid: String, id: String, response: UploadResponse) {
        require(response.submission.id.isNotBlank() && response.submission.status.isNotBlank())
        db.queue().acknowledge(vault.owner(uid), id, vault.seal(uid, "$id:ack", json.encodeToString(response).toByteArray()))
    }
    override suspend fun markFailed(uid: String, id: String, failure: AppFailure) = db.queue().failed(vault.owner(uid), id, failure.message!!.take(300), if (failure.retryable) "READY" else "BLOCKED")
    override suspend fun retry(uid: String, id: String) = db.queue().retry(vault.owner(uid), id)
    override suspend fun confirmed(uid: String, id: String, response: PurchaseResponse) = withContext(Dispatchers.IO) { mutex.withLock {
        require(response.purchase.id.isNotBlank() && response.purchase.status.isNotBlank()) { "Compra não confirmada; a fila foi preservada." }
        if (db.queue().removeConfirmed(vault.owner(uid), id) == 1) file(uid, id).delete()
    } }
    override suspend fun discard(uid: String, id: String) = withContext(Dispatchers.IO) { mutex.withLock {
        if (db.queue().discard(vault.owner(uid), id) == 1) file(uid, id).delete()
        Unit
    } }
}
