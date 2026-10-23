package com.coalaone.go.location

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker class JourneyLocationWorker @AssistedInject constructor(@Assisted context: Context,
    @Assisted params: WorkerParameters, private val queue: JourneyLocationQueue) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        repeat(10) { if (!queue.sync()) return Result.success() }
        Result.retry()
    } catch (_: Exception) { Result.retry() }
}
