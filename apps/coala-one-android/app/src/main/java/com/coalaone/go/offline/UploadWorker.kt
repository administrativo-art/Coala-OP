package com.coalaone.go.offline

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@HiltWorker class UploadWorker @AssistedInject constructor(@Assisted context: Context, @Assisted params: WorkerParameters, private val sync: QueueSync, private val auth: com.coalaone.go.auth.AuthGateway, private val vault: Vault) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val owner = inputData.getString("owner") ?: return Result.failure()
        val uid = auth.current?.uid ?: return Result.success()
        if (vault.owner(uid) != owner) return Result.success()
        return if (sync.sync(uid)) Result.success() else Result.retry()
    }
}
fun interface WorkScheduler { fun schedule(uid: String) }
@Singleton class QueueScheduler @Inject constructor(@ApplicationContext private val context: Context, private val vault: Vault) : WorkScheduler {
    override fun schedule(uid: String) {
        val request = OneTimeWorkRequestBuilder<UploadWorker>().setInputData(workDataOf("owner" to vault.owner(uid))).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("coala-upload-${vault.owner(uid)}", ExistingWorkPolicy.KEEP, request)
    }
}
