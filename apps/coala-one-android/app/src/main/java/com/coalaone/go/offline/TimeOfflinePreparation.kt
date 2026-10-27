package com.coalaone.go.offline

import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.data.ApiRepository
import com.coalaone.go.data.DeveloperViewAsSelectionStore
import com.coalaone.go.data.TimeOptions
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

internal const val TIME_OFFLINE_RENEW_AFTER_MS = 6 * 60 * 60 * 1000L

/** A silent, shared renewal path for the screen and background worker. Never prepares another person's device. */
@Singleton class TimeOfflinePreparation @Inject constructor(private val auth: AuthGateway,
    private val queue: TimeOfflineQueue, private val repository: ApiRepository,
    private val viewAs: DeveloperViewAsSelectionStore) {
    private val mutex = Mutex()
    suspend fun prepare(uid: String, options: TimeOptions? = null,
        elapsed: Long = android.os.SystemClock.elapsedRealtime()) = mutex.withLock {
        if (auth.current?.uid != uid || viewAs.current() != null) return@withLock
        // An existing permit avoids a new server read at every app launch/network callback.
        if (options == null) {
            val permit = queue.permit(uid)
            if (permit != null && queue.cachedOptions(uid, elapsed) != null
                && elapsed - permit.anchorElapsedRealtimeMs < TIME_OFFLINE_RENEW_AFTER_MS) return@withLock
        }
        val current = options ?: repository.api.timeOptions(java.time.LocalDate.now().toString())
        if (!current.eligible || !current.markingEnabled || current.mode !in setOf("pilot", "official")
            || current.officialClock?.available != true) return@withLock
        if (auth.current?.uid != uid || viewAs.current() != null) return@withLock
        val request = queue.permitRequest(uid, current.workDate, elapsed, current.mode) ?: return@withLock
        val permit = repository.api.offlinePermit(request, uid).permit
        if (auth.current?.uid == uid && viewAs.current() == null) queue.savePermit(uid, permit)
    }
}
