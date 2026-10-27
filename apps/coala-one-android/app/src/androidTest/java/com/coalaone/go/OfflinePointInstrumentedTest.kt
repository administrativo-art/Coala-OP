package com.coalaone.go

import android.content.Context
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
import java.io.IOException
import java.security.KeyStore
import java.time.Instant
import java.util.UUID

/** Real Room/Keystore and the production worker; only server responses and account are synthetic. */
@RunWith(AndroidJUnit4::class)
class OfflinePointInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val uid = "demo-point-${UUID.randomUUID()}"
    private val databaseName = "demo-point-${UUID.randomUUID()}.db"
    private val vault = Vault()
    private val json = Json { encodeDefaults = true; explicitNulls = true }
    private lateinit var database: TimeOfflineDatabase
    private lateinit var queue: TimeOfflineStore
    private val auth = object : AuthGateway {
        override val identities = MutableStateFlow<Identity?>(Identity(uid, null))
        override val current get() = identities.value
        override suspend fun login(email: String, password: String) = current!!
        override suspend fun reauthenticate(password: String) {}
        override suspend fun token(forceRefresh: Boolean) = "demo-token"
        override fun signOut() { identities.value = null }
    }
    private fun open() {
        database = Room.databaseBuilder(context, TimeOfflineDatabase::class.java, databaseName).build()
        queue = TimeOfflineStore(database, vault, TimeDeviceIdentity(context, vault), json)
    }
    @Before fun setup() = runBlocking {
        open()
        val elapsed = android.os.SystemClock.elapsedRealtime()
        val request = requireNotNull(queue.permitRequest(uid, "2026-10-27", elapsed, "pilot"))
        val now = Instant.now()
        queue.savePermit(uid, OfflinePermit("demo-permit", request.installationId, request.deviceKeyId,
            request.keySecurity, request.bootCount, elapsed, now.toString(), now.toString(),
            now.plusSeconds(43_200).toString(), listOf(OfflinePermitUnit("demo-unit", "Test unit", "America/Belem")), "pilot"))
    }
    @After fun cleanup() {
        database.close(); context.deleteDatabase(databaseName)
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.also {
            it.deleteEntry("coala.go.time.offline.v1.${vault.owner(uid)}")
            it.deleteEntry("coala.go.queue.v1.${vault.owner(uid)}")
        }
    }
    private fun worker(api: ApiService): TimeOfflineWorker {
        val repository = ApiRepository(api, DemoApi(), RuntimeMode(auth))
        val sync = TimeOfflineSync(auth, queue, repository)
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker =
                TimeOfflineWorker(appContext, workerParameters, sync, auth, vault)
        }
        return TestListenableWorkerBuilder<TimeOfflineWorker>(context).setWorkerFactory(factory)
            .setInputData(androidx.work.workDataOf("owner" to vault.owner(uid))).build()
    }
    @Test fun savedPunchSurvivesReopenAndLostReplyIsReplayedOnlyOnce() = runBlocking {
        val captured = queue.capture(uid, "demo-unit", android.os.SystemClock.elapsedRealtime(), "journey_start")
        val raw = database.timeOffline().list(vault.owner(uid)).single()
        assertFalse(raw.sealed.decodeToString().contains("journey_start"))
        database.close(); open()
        assertEquals(captured.id, queue.ready(uid).single().second.attemptId)
        assertTrue(queue.ready("other-account").isEmpty())
        val accepted = mutableMapOf<String, MarkingResponse>()
        val attempts = mutableListOf<String>()
        var loseReply = true
        val api = object : ApiService by DemoApi() {
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                attempts += request.attemptId
                val replay = accepted.containsKey(request.attemptId)
                val result = accepted.getOrPut(request.attemptId) {
                    MarkingResponse("recorded", "demo-receipt", "available",
                        marking = RecordedMarking(1, request.offline!!.markedAt, request.executionUnitId), pilot = true)
                }
                if (loseReply) { loseReply = false; throw IOException("reply lost after commit") }
                return result.copy(status = if (replay) "replayed" else "recorded")
            }
        }
        assertEquals(ListenableWorker.Result.retry(), worker(api).doWork())
        assertEquals("READY", database.timeOffline().list(vault.owner(uid)).single().state)
        database.close(); open()
        assertEquals(ListenableWorker.Result.success(), worker(api).doWork())
        assertEquals(listOf(captured.id, captured.id), attempts)
        assertEquals(1, accepted.size)
        assertTrue(queue.ready(uid).isEmpty())
        assertEquals("CONFIRMED", database.timeOffline().list(vault.owner(uid)).single().state)
    }
    @Test fun blockedPunchIsRetainedAndStopsOnlyItsOwnSignedChain() = runBlocking {
        val first = queue.capture(uid, "demo-unit", android.os.SystemClock.elapsedRealtime(), "journey_start")
        queue.capture(uid, "demo-unit", android.os.SystemClock.elapsedRealtime(), "break_start")
        queue.failed(uid, first.id, AppFailure(ErrorCategory.PERMISSION, false, "rejected"))
        assertTrue(queue.ready(uid).isEmpty())
        database.close(); open()
        assertTrue(queue.ready(uid).isEmpty())
        val rows = database.timeOffline().list(vault.owner(uid))
        assertEquals(2, rows.size); assertEquals("BLOCKED", rows.first().state)
        assertEquals("READY", rows.last().state)
    }
}
