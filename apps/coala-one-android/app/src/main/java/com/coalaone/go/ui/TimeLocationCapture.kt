package com.coalaone.go.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.coalaone.go.data.LocationAttempt
import kotlinx.coroutines.suspendCancellableCoroutine
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.resume

internal fun hasPointLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

internal fun failedLocationAttempt(captureId: String = UUID.randomUUID().toString(), status: String, elapsedMs: Long = 0) =
    LocationAttempt(captureId = captureId, status = status, elapsedMs = elapsedMs.coerceIn(0, 60_000))

/**
 * One fresh foreground reading for one confirmed punch. No last-known position, polling, background
 * service or persistent device cache is used. An imprecise reading is still sent so the server can
 * classify it as inconclusive without blocking the punch.
 */
internal suspend fun capturePointLocation(context: Context, timeoutMs: Long, maxAccuracyMeters: Double): LocationAttempt {
    val captureId = UUID.randomUUID().toString()
    val startedAtMs = SystemClock.elapsedRealtime()
    val startedAtNanos = SystemClock.elapsedRealtimeNanos()
    if (!hasPointLocationPermission(context)) return failedLocationAttempt(captureId, "denied")
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        ?: return failedLocationAttempt(captureId, "unsupported")
    return suspendCancellableCoroutine { continuation ->
        val handler = Handler(Looper.getMainLooper())
        val listeners = mutableListOf<LocationListener>()
        var best: Location? = null
        var finished = false
        fun elapsed() = (SystemClock.elapsedRealtime() - startedAtMs).coerceIn(0, 60_000)
        fun attempt(location: Location) = LocationAttempt(captureId = captureId, status = "captured", elapsedMs = elapsed(),
            capturedAt = Instant.ofEpochMilli(location.time).toString(), latitude = location.latitude,
            longitude = location.longitude, accuracyMeters = location.accuracy.toDouble())
        fun finish(value: LocationAttempt) {
            if (finished) return
            finished = true
            listeners.forEach(manager::removeUpdates)
            handler.removeCallbacksAndMessages(null)
            if (continuation.isActive) continuation.resume(value)
        }
        val timeout = Runnable { finish(best?.let(::attempt) ?: failedLocationAttempt(captureId, "timeout", elapsed())) }
        continuation.invokeOnCancellation {
            handler.post { if (!finished) { finished = true; listeners.forEach(manager::removeUpdates); handler.removeCallbacksAndMessages(null) } }
        }
        try {
            val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                .filter { manager.isProviderEnabled(it) }
            if (providers.isEmpty()) { finish(failedLocationAttempt(captureId, "unavailable", elapsed())); return@suspendCancellableCoroutine }
            providers.forEach { provider ->
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        // Some providers first emit a cached point; only a reading made for this tap is accepted.
                        if (location.elapsedRealtimeNanos + 1_000_000_000L < startedAtNanos) return
                        if (best == null || location.accuracy < best!!.accuracy) best = location
                        if (location.hasAccuracy() && location.accuracy <= maxAccuracyMeters) finish(attempt(location))
                    }
                    override fun onProviderDisabled(provider: String) = Unit
                    override fun onProviderEnabled(provider: String) = Unit
                    @Deprecated("Deprecated by Android") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
                }
                listeners += listener
                manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
            }
            handler.postDelayed(timeout, timeoutMs.coerceIn(2_000, 30_000))
        } catch (_: SecurityException) {
            finish(failedLocationAttempt(captureId, "denied", elapsed()))
        } catch (_: Exception) {
            finish(failedLocationAttempt(captureId, "error", elapsed()))
        }
    }
}
