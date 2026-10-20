package com.coalaone.go

import android.content.Context
import android.content.ContextWrapper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import com.coalaone.go.auth.*
import com.coalaone.go.data.*
import com.coalaone.go.offline.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class OfflineQueueInstrumentedTest {
    private val app = ApplicationProvider.getApplicationContext<Context>()
    private lateinit var context: Context
    private lateinit var database: QueueDatabase
    private lateinit var store: QueueStore
    private lateinit var directory: File
    private lateinit var databaseName: String
    private val uid = "instrumented-${UUID.randomUUID()}"
    private val id = UUID.randomUUID().toString()
    private val vault = Vault()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private fun payload() = PendingUpload(id, "2026-10-01T12:00:00Z", "sensitive-test-note", "cash_withdrawal", listOf(Document("note.jpg", "image/jpeg", "sensitive-test-document".toByteArray())), emptyList())
    @Before fun setUp() {
        directory = File(app.cacheDir, "queue-test-${UUID.randomUUID()}").apply { mkdirs() }
        context = object : ContextWrapper(app) { override fun getNoBackupFilesDir() = directory }
        databaseName = "instrumented-${UUID.randomUUID()}.db"
        database = Room.databaseBuilder(context, QueueDatabase::class.java, databaseName).build()
        store = QueueStore(context, database, vault, json)
    }
    @After fun tearDown() { database.close(); app.deleteDatabase(databaseName); directory.deleteRecursively() }
    @Test fun encryptedPayloadSurvivesDatabaseReopenAndNeverLivesInRoomAsPlaintext() = runBlocking {
        store.enqueue(uid, payload())
        val row = store.list(uid).single(); assertEquals(vault.owner(uid), row.owner)
        val encrypted = File(directory, "coala-go-queue/${row.owner}-$id.enc").readBytes().decodeToString()
        assertFalse(encrypted.contains("sensitive-test-note")); assertFalse(encrypted.contains("sensitive-test-document"))
        database.close(); database = Room.databaseBuilder(context, QueueDatabase::class.java, databaseName).build(); store = QueueStore(context, database, vault, json)
        assertEquals(id, store.payload(uid, id).submissionId)
        assertEquals("sensitive-test-document", store.payload(uid, id).receipts.single().bytes.decodeToString())
        assertTrue(store.list("another-owner").isEmpty())
    }
    @Test fun differentOwnerWrongAadAndTamperingCannotDecrypt() {
        val sealed = vault.seal(uid, id, "document".toByteArray())
        assertThrows(Exception::class.java) { vault.open("another-owner", id, sealed) }
        assertThrows(Exception::class.java) { vault.open(uid, "different-id", sealed) }
        sealed[sealed.lastIndex] = (sealed.last().toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { vault.open(uid, id, sealed) }
    }
    @Test fun failureAndUnacknowledgedConfirmationNeverDeleteDocuments() = runBlocking {
        store.enqueue(uid, payload())
        store.markFailed(uid, id, AppFailure(ErrorCategory.NETWORK, true, "offline"))
        store.confirmed(uid, id, PurchaseResponse(PurchaseResult("p", "confirmed")))
        assertEquals(1, store.list(uid).single().retryCount)
        assertEquals(id, store.payload(uid, id).submissionId)
        store.markUploaded(uid, id, UploadResponse(Submission("server", false, "pending_review")))
        assertNotNull(store.acknowledged(uid, id))
        assertEquals(id, store.payload(uid, id).submissionId)
        store.confirmed(uid, id, PurchaseResponse(PurchaseResult("p", "confirmed")))
        assertTrue(store.list(uid).isEmpty())
        assertFalse(File(directory, "coala-go-queue/${vault.owner(uid)}-$id.enc").exists())
    }
    @Test fun duplicateEnqueueKeepsSingleIdAndOriginalDocument() = runBlocking {
        store.enqueue(uid, payload()); store.enqueue(uid, payload())
        assertEquals(1, store.list(uid).size); assertEquals(id, store.payload(uid, id).submissionId)
    }
    @Test fun recoversAtomicPayloadWrittenBeforeRoomInsert() = runBlocking {
        val encrypted = File(directory, "coala-go-queue/${vault.owner(uid)}-$id.enc").apply { parentFile!!.mkdirs() }
        encrypted.writeBytes(vault.seal(uid, id, json.encodeToString(PendingUpload.serializer(), payload()).toByteArray()))
        assertEquals(id, store.list(uid).single().id)
        assertEquals("sensitive-test-note", store.payload(uid, id).note)
    }
    @Test fun confirmedTombstonePreventsResurrectionAfterInterruptedFileDeletion() = runBlocking {
        store.enqueue(uid, payload())
        val file = File(directory, "coala-go-queue/${vault.owner(uid)}-$id.enc")
        val sealed = file.readBytes()
        store.markUploaded(uid, id, UploadResponse(Submission("server", false, "pending_review")))
        store.confirmed(uid, id, PurchaseResponse(PurchaseResult("p", "confirmed")))
        file.writeBytes(sealed)
        assertTrue(store.list(uid).isEmpty()); assertFalse(file.exists())
    }
    @Test fun invalidServerAcknowledgementPreservesQueue() = runBlocking {
        store.enqueue(uid, payload())
        assertThrows(IllegalArgumentException::class.java) { runBlocking { store.markUploaded(uid, id, UploadResponse(Submission("", false, ""))) } }
        assertEquals("READY", store.list(uid).single().state)
        assertEquals(id, store.payload(uid, id).submissionId)
    }
    @Test fun workManagerWorkerUsesSameIdAndRealEncryptedQueue() = runBlocking {
        store.enqueue(uid, payload())
        val auth = object : AuthGateway {
            override val identities = MutableStateFlow<Identity?>(Identity(uid, null)); override val current get() = identities.value
            override suspend fun login(email: String, password: String) = current!!; override suspend fun reauthenticate(password: String) {}
            override suspend fun token(forceRefresh: Boolean) = "test-token"; override fun signOut() { identities.value = null }
        }
        var sent = ""
        val repo = object : MobileRepository {
            override suspend fun profile(): ProfileResponse = error("unused")
            override suspend fun countContext(): CountContext = error("unused")
            override suspend fun startCount(kioskId: String): CountSession = error("unused")
            override suspend fun saveCount(input: SaveCountRequest): SavedCount = error("unused")
            override suspend fun cancelCount(sessionId: String): CancelledCount = error("unused")
            override suspend fun repositions(): Repositions = error("unused")
            override suspend fun receive(input: ReceiveRequest): Received = error("unused")
            override suspend fun upload(input: PendingUpload, expectedUid: String?): UploadResponse { sent = input.submissionId; assertEquals(uid, expectedUid); return UploadResponse(Submission("server", true, "pending_review")) }
            override suspend fun cancelUpload(submissionId: String) = error("unused")
        }
        val sync = QueueSync(auth, store, repo)
        val factory = object : WorkerFactory() { override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker = UploadWorker(appContext, workerParameters, sync, auth, vault) }
        val worker = TestListenableWorkerBuilder<UploadWorker>(context).setWorkerFactory(factory).setInputData(androidx.work.workDataOf("owner" to vault.owner(uid))).build()
        assertEquals(ListenableWorker.Result.success(), worker.doWork())
        assertEquals(id, sent); assertEquals("UPLOADED", store.list(uid).single().state)
    }
    @Test fun goHasSeparateSandboxNoAndroidBackupAndNoMicrophonePermission() {
        assertEquals("coalaone.go.debug", context.packageName)
        assertFalse(context.filesDir.absolutePath.contains("com.coalaone.notas"))
        assertEquals(0, context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)
        val permissions = context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty()
        assertFalse(permissions.contains("android.permission.RECORD_AUDIO"))
    }
}
