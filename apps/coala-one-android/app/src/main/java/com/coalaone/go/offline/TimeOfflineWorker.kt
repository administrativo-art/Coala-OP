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
    private val repository: ApiRepository) {
    private val mutex = Mutex()
    suspend fun syncWithResult(uid: String): TimeOfflineSyncResult = mutex.withLock {
        if (auth.current?.uid != uid) return@withLock TimeOfflineSyncResult(false, emptyList())
        val confirmed = mutableListOf<SyncedOfflineMarking>()
        for ((row, request) in queue.ready(uid)) {
            if (auth.current?.uid != uid) return@withLock TimeOfflineSyncResult(false, confirmed)
            try {
                val response = repository.api.mark(request)
                queue.synced(uid, row.id)
                confirmed += SyncedOfflineMarking(request, response)
            }
            catch (cause: CancellationException) { throw cause }
            catch (cause: Exception) {
                val failure = Errors.classify(cause)
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
        return if (sync.sync(uid)) Result.success() else Result.retry()
    }
}

fun interface TimeOfflineWorkScheduler { fun schedule(uid: String) }
@Singleton class TimeOfflineScheduler @Inject constructor(@ApplicationContext private val context: Context, private val vault: Vault) : TimeOfflineWorkScheduler {
    override fun schedule(uid: String) {
        val request = OneTimeWorkRequestBuilder<TimeOfflineWorker>().setInputData(workDataOf("owner" to vault.owner(uid)))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        // APPEND_OR_REPLACE preserves a capture scheduled while a previous worker is already running.
        WorkManager.getInstance(context).enqueueUniqueWork("coala-time-offline-${vault.owner(uid)}", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
}
