package com.coalaone.go.location

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.coalaone.go.R
import com.coalaone.go.data.JourneyLocationEvent
import com.coalaone.go.data.Errors
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

@AndroidEntryPoint class JourneyLocationService : Service(), LocationListener {
    @Inject lateinit var queue: JourneyLocationQueue
    @Inject lateinit var leaseStore: JourneyLocationLeaseStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val handler = Handler(Looper.getMainLooper())
    private var manager: LocationManager? = null
    private var sessionId = ""
    private var workDate = ""
    private var unitId = ""
    private var stopAt = 0L
    private var paused = false
    private var lastAccepted: Location? = null
    private var lastAcceptedAt = 0L
    private var movingMinSeconds = 120L
    private var movingMinMeters = 120f
    private var stationaryMaxSeconds = 900L
    private var maxAccuracyMeters = 150f
    private var pendingLeaseEventType = "resume"
    private val stopRunnable = Runnable { stopTracking("stop") }
    private val leaseRetryRunnable = Runnable { beginWithLease(pendingLeaseEventType) }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); manager = getSystemService(Context.LOCATION_SERVICE) as? LocationManager }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        sessionId = intent?.getStringExtra(EXTRA_SESSION) ?: prefs.getString(EXTRA_SESSION, "").orEmpty()
        workDate = intent?.getStringExtra(EXTRA_DATE) ?: prefs.getString(EXTRA_DATE, "").orEmpty()
        unitId = intent?.getStringExtra(EXTRA_UNIT) ?: prefs.getString(EXTRA_UNIT, "").orEmpty()
        stopAt = intent?.getLongExtra(EXTRA_STOP_AT, 0L)?.takeIf { it > 0 } ?: prefs.getLong(EXTRA_STOP_AT, 0L)
        if (sessionId.isBlank() || workDate.isBlank() || unitId.isBlank() || (stopAt > 0 && System.currentTimeMillis() >= stopAt)) {
            stopTracking("stop"); return START_NOT_STICKY
        }
        val action = intent?.action ?: if (prefs.getBoolean("paused", false)) ACTION_PAUSE else ACTION_RESUME
        when (action) {
            ACTION_ABORT -> { abortTracking(); return START_NOT_STICKY }
            ACTION_STOP -> { stopTracking("stop"); return START_NOT_STICKY }
            ACTION_PAUSE -> { paused = true; removeUpdates(); emit("pause"); persist(); foreground("Acompanhamento pausado durante o intervalo") }
            ACTION_START -> beginWithLease("start")
            else -> beginWithLease("resume")
        }
        scheduleStop()
        return START_STICKY
    }
    private fun beginWithLease(eventType: String) {
        pendingLeaseEventType = eventType
        handler.removeCallbacks(leaseRetryRunnable)
        paused = false; persist(); foreground("Confirmando autorização da jornada…")
        scope.launch {
            runCatching { leaseStore.valid(sessionId, workDate, unitId) }.onSuccess { lease ->
                movingMinSeconds = lease.config.movingMinSeconds; movingMinMeters = lease.config.movingMinMeters
                stationaryMaxSeconds = lease.config.stationaryMaxSeconds; maxAccuracyMeters = lease.config.maxAccuracyMeters
                emit(eventType)
                withContext(Dispatchers.Main.immediate) { foreground("Acompanhamento ativo durante a jornada"); requestUpdates() }
            }.onFailure { cause -> withContext(Dispatchers.Main.immediate) {
                if (Errors.classify(cause).retryable) {
                    foreground("Aguardando conexão para confirmar a jornada…")
                    handler.postDelayed(leaseRetryRunnable, 60_000L)
                } else abortTracking()
            } }
        }
    }
    private fun persist() = getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(EXTRA_SESSION, sessionId)
        .putString(EXTRA_DATE, workDate).putString(EXTRA_UNIT, unitId).putLong(EXTRA_STOP_AT, stopAt).putBoolean("paused", paused).apply()
    private fun foreground(message: String) {
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Acompanhamento da jornada", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Indicador obrigatório enquanto a localização da jornada está ativa"
            setShowBadge(false)
        })
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.coala_icon)
            .setContentTitle("Coala Go · Entre unidades").setContentText(message).setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE).setPriority(NotificationCompat.PRIORITY_LOW).build()
        startForeground(NOTIFICATION_ID, notification)
    }
    private fun requestUpdates() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        runCatching {
            listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { manager?.isProviderEnabled(it) == true }
                .forEach { manager?.requestLocationUpdates(it, 60_000L, 25f, this, Looper.getMainLooper()) }
        }
    }
    private fun removeUpdates() = runCatching { manager?.removeUpdates(this) }.let { Unit }
    private fun scheduleStop() {
        handler.removeCallbacks(stopRunnable)
        if (stopAt > 0) handler.postDelayed(stopRunnable, (stopAt - System.currentTimeMillis()).coerceAtLeast(0).coerceAtMost(18 * 60 * 60 * 1000L))
    }
    private fun event(type: String, location: Location? = null) = JourneyLocationEvent(UUID.randomUUID().toString(), sessionId, workDate, unitId, type,
            location?.time?.let { Instant.ofEpochMilli(it).toString() } ?: Instant.now().toString(), location?.latitude,
            location?.longitude, location?.takeIf { it.hasAccuracy() }?.accuracy?.toDouble())
    private fun emit(type: String, location: Location? = null) {
        val event = event(type, location)
        scope.launch { queue.enqueue(event) }
    }
    private fun stopTracking(type: String) {
        removeUpdates(); handler.removeCallbacksAndMessages(null)
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply()
        if (sessionId.isBlank()) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return }
        val finalEvent = event(type)
        scope.launch {
            queue.enqueue(finalEvent)
            withContext(Dispatchers.Main.immediate) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        }
    }
    /** Terminal server instruction: stop sensors and notification without creating another queued event. */
    private fun abortTracking() {
        removeUpdates(); handler.removeCallbacksAndMessages(null)
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply()
        leaseStore.clear(sessionId)
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onLocationChanged(location: Location) {
        if (paused || (location.hasAccuracy() && location.accuracy > maxAccuracyMeters)) return
        val now = location.time.takeIf { it > 0 } ?: System.currentTimeMillis()
        val elapsedSeconds = if (lastAcceptedAt == 0L) Long.MAX_VALUE else (now - lastAcceptedAt).coerceAtLeast(0) / 1000
        val distance = lastAccepted?.distanceTo(location) ?: Float.MAX_VALUE
        val moving = (location.hasSpeed() && location.speed >= 1.2f) || distance >= movingMinMeters
        if (lastAccepted == null || (moving && elapsedSeconds >= movingMinSeconds) || elapsedSeconds >= stationaryMaxSeconds) {
            lastAccepted = Location(location); lastAcceptedAt = now; emit("sample", location)
        }
    }
    override fun onProviderDisabled(provider: String) = Unit
    override fun onProviderEnabled(provider: String) = Unit
    @Deprecated("Deprecated by Android") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    override fun onDestroy() { removeUpdates(); handler.removeCallbacksAndMessages(null); scope.cancel(); super.onDestroy() }

    companion object {
        const val ACTION_START = "coala.journey.START"; const val ACTION_PAUSE = "coala.journey.PAUSE"
        const val ACTION_RESUME = "coala.journey.RESUME"; const val ACTION_STOP = "coala.journey.STOP"
        const val ACTION_ABORT = "coala.journey.ABORT"
        const val EXTRA_SESSION = "sessionId"; const val EXTRA_DATE = "workDate"; const val EXTRA_UNIT = "unitId"; const val EXTRA_STOP_AT = "stopAt"
        private const val PREFS = "journey-location-state"; private const val CHANNEL = "coala_journey_location"; private const val NOTIFICATION_ID = 1908
    }
}
