package com.coalaone.go.offline

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.data.ApiRepository
import com.coalaone.go.data.Errors
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

data class SyncedOfflineMarking(val request: com.coalaone.go.data.MarkingRequest, val response: com.coalaone.go.data.MarkingResponse)
data class TimeOfflineSyncResult(val complete: Boolean, val confirmed: List<SyncedOfflineMarking>)

@Singleton class TimeOfflineSync @Inject constructor(private val auth: AuthGateway, private val queue: TimeOfflineQueue,
    private val repository: ApiRepository,
    private val viewAs: com.coalaone.go.data.DeveloperViewAsSelectionStore = com.coalaone.go.data.InMemoryDeveloperViewAsStore()) {
    private val mutex = Mutex()
    suspend fun syncWithResult(uid: String): TimeOfflineSyncResult = mutex.withLock {
        if (auth.current?.uid != uid || viewAs.current() != null) return@withLock TimeOfflineSyncResult(false, emptyList())
        val confirmed = mutableListOf<SyncedOfflineMarking>()
        for ((row, request) in queue.ready(uid)) {
            if (auth.current?.uid != uid || viewAs.current() != null) return@withLock TimeOfflineSyncResult(false, confirmed)
            try {
                if (row.sequence == 0) require(request.onlineScope == (if (row.permitId.startsWith("online:pilot:")) "pilot" else "official")) { "O escopo protegido desta tentativa não confere." }
                val response = repository.api.mark(request, uid)
                if (auth.current?.uid != uid || viewAs.current() != null)
                    return@withLock TimeOfflineSyncResult(false, confirmed)
                check(response.status in setOf("recorded", "replayed") && response.receiptId.isNotBlank()
                    && response.receiptStatus in setOf("available", "pending")
                    && response.marking.executionUnitId == request.executionUnitId
                    && response.pilot == (if (request.offline != null) request.offline.scope == "pilot" else row.permitId.startsWith("online:pilot:"))) { "A resposta não confirmou esta batida." }
                queue.confirmed(uid, row.id, request, response)
                confirmed += SyncedOfflineMarking(request, response)
            }
            catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) {
                if (auth.current?.uid != uid || viewAs.current() != null)
                    return@withLock TimeOfflineSyncResult(false, confirmed)
                val classified = Errors.classify(cause)
                // A login can be restored; it does not invalidate a previously saved punch.
                val failure = if (classified.category == com.coalaone.go.data.ErrorCategory.AUTHENTICATION)
                    com.coalaone.go.data.AppFailure(classified.category, true, classified.message.orEmpty(), classified.code)
                    else classified
                queue.failed(uid, row.id, failure)
                // A corrente assinada é estritamente sequencial. Não envie as sucessoras enquanto esta
                // marcação não tiver sido aceita ou saneada, para não bloqueá-las artificialmente.
                return@withLock TimeOfflineSyncResult(!failure.retryable, confirmed)
            }
        }
        TimeOfflineSyncResult(true, confirmed)
    }
    suspend fun sync(uid: String): Boolean = syncWithResult(uid).complete
}

@HiltWorker class TimeOfflineWorker @AssistedInject constructor(@Assisted context: Context, @Assisted params: WorkerParameters,
    private val sync: TimeOfflineSync, private val auth: AuthGateway, private val vault: Vault) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val expectedOwner = inputData.getString("owner") ?: return Result.failure()
        val uid = auth.current?.uid ?: return Result.success()
        if (vault.owner(uid) != expectedOwner) return Result.success()
        return try { if (sync.sync(uid)) Result.success() else Result.retry() }
        catch (cause: CancellationException) { throw cause }
        catch (_: Exception) { Result.retry() }
    }
}

@HiltWorker class TimeOfflinePreparationWorker @AssistedInject constructor(@Assisted context: Context,
    @Assisted params: WorkerParameters, private val preparation: TimeOfflinePreparation,
    private val scheduler: TimeOfflineScheduler, private val auth: AuthGateway, private val vault: Vault,
    private val viewAs: com.coalaone.go.data.DeveloperViewAsSelectionStore) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val owner = inputData.getString("owner") ?: return Result.failure()
        val uid = auth.current?.uid ?: return Result.retry()
        if (vault.owner(uid) != owner) return Result.success()
        if (viewAs.current() != null) return Result.retry()
        // Re-arm persisted punches even if the process died between Room insert and scheduling.
        scheduler.schedule(uid)
        return try { preparation.prepare(uid); Result.success() }
        catch (cause: CancellationException) { throw cause }
        catch (cause: Exception) { if (Errors.classify(cause).retryable) Result.retry() else Result.success() }
    }
}

fun interface TimeOfflineWorkScheduler {
    fun schedule(uid: String)
    fun prepare(uid: String) {}
}
@Singleton class TimeOfflineScheduler @Inject constructor(@ApplicationContext private val context: Context, private val vault: Vault) : TimeOfflineWorkScheduler {
    override fun prepare(uid: String) {
        val owner = vault.owner(uid)
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val manager = WorkManager.getInstance(context)
        manager.enqueueUniqueWork("coala-time-prepare-$owner", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<TimeOfflinePreparationWorker>().setInputData(workDataOf("owner" to owner))
                .setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
        manager.enqueueUniquePeriodicWork("coala-time-renew-$owner", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<TimeOfflinePreparationWorker>(4, TimeUnit.HOURS)
                .setInputData(workDataOf("owner" to owner)).setConstraints(constraints).build())
        schedule(uid)
    }
    override fun schedule(uid: String) {
        val request = OneTimeWorkRequestBuilder<TimeOfflineWorker>().setInputData(workDataOf("owner" to vault.owner(uid)))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        // APPEND_OR_REPLACE preserves a capture scheduled while a previous worker is already running.
        WorkManager.getInstance(context).enqueueUniqueWork("coala-time-offline-${vault.owner(uid)}", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
}
