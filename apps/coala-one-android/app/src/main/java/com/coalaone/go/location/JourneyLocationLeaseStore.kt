package com.coalaone.go.location

import android.content.Context
import com.coalaone.go.data.ApiRepository
import com.coalaone.go.data.JourneyLocationLease
import com.coalaone.go.data.JourneyLocationLeaseRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/** Short-lived capability bound to the signed-in user/session. Corporate-device status is intentionally absent. */
@Singleton class JourneyLocationLeaseStore @Inject constructor(@ApplicationContext context: Context,
    private val repository: ApiRepository) {
    private val prefs = context.getSharedPreferences("journey-location-lease", Context.MODE_PRIVATE)
    @Volatile private var memoryToken: String? = null
    @Volatile private var memorySessionId: String? = null
    @Volatile private var memoryExpiresAt: Instant? = null

    suspend fun valid(sessionId: String, workDate: String, unitId: String): JourneyLocationLease {
        val token = memoryToken
        val expiresAt = memoryExpiresAt
        if (memorySessionId == sessionId && token != null && expiresAt != null
            && expiresAt.isAfter(Instant.now().plusSeconds(90))) {
            return JourneyLocationLease(token, expiresAt.toString(), com.coalaone.go.data.JourneyLocationLeaseConfig(
                prefs.getLong("movingMinSeconds", 120), prefs.getFloat("movingMinMeters", 120f),
                prefs.getLong("stationaryMaxSeconds", 900), prefs.getFloat("maxAccuracyMeters", 150f)))
        }
        val lease = repository.api.journeyLocationLease(JourneyLocationLeaseRequest(sessionId, workDate, unitId))
        memorySessionId = sessionId; memoryToken = lease.leaseToken; memoryExpiresAt = Instant.parse(lease.expiresAt)
        prefs.edit().putLong("movingMinSeconds", lease.config.movingMinSeconds).putFloat("movingMinMeters", lease.config.movingMinMeters)
            .putLong("stationaryMaxSeconds", lease.config.stationaryMaxSeconds).putFloat("maxAccuracyMeters", lease.config.maxAccuracyMeters).apply()
        return lease
    }

    fun clear(sessionId: String? = null) {
        if (sessionId == null || memorySessionId == sessionId) {
            memorySessionId = null; memoryToken = null; memoryExpiresAt = null; prefs.edit().clear().apply()
        }
    }
}
