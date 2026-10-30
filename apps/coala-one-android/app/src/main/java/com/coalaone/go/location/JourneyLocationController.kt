package com.coalaone.go.location

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.coalaone.go.data.OwnMarking
import com.coalaone.go.data.OwnShift
import com.coalaone.go.domain.TimeRules
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton class JourneyLocationController @Inject constructor(@ApplicationContext private val context: Context) {
    private val prefs get() = context.getSharedPreferences("journey-location-controller", Context.MODE_PRIVATE)

    fun afterPunch(shift: OwnShift?, workDate: String, unitId: String?, zoneId: ZoneId, purpose: String,
        policyActive: Boolean, runtimeEnabled: Boolean) {
        if (!eligible(shift, unitId, policyActive, runtimeEnabled)) { stop(); return }
        val desired = nextJourneyTrackingState(prefs.getString("state", null), purpose)
        if (desired == null) stop() else apply(desired, shift!!, workDate, unitId!!, zoneId)
    }

    /** Rebuilds the operational state after an editable classification changed. Ambiguity stops collection. */
    fun reconcile(shift: OwnShift?, workDate: String, unitId: String?, zoneId: ZoneId, markings: List<OwnMarking>,
        policyActive: Boolean, runtimeEnabled: Boolean) {
        if (!eligible(shift, unitId, policyActive, runtimeEnabled)) { stop(); return }
        var desired: String? = null
        val valid = markings.filter { it.workDate == workDate }.sortedBy { TimeRules.markingInstant(it.markedAt) }
            .all { marking ->
                when (marking.classification?.purpose) {
                    "journey_start" -> if (desired == null) { desired = "active"; true } else false
                    "break_start" -> if (desired == "active") { desired = "paused"; true } else false
                    "break_end" -> if (desired == "paused") { desired = "active"; true } else false
                    "journey_end" -> if (desired == "active" || desired == "paused") { desired = "stopped"; true } else false
                    null -> true
                    else -> false
                }
            }
        if (!valid || desired == null) stop() else apply(desired!!, shift!!, workDate, unitId!!, zoneId)
    }

    fun stop() {
        val session = prefs.getString("session", null) ?: return
        val workDate = prefs.getString("date", null) ?: return
        val unitId = prefs.getString("unit", null) ?: return
        dispatch(JourneyLocationService.ACTION_STOP, session, workDate, unitId, prefs.getLong("stopAt", 0L))
        prefs.edit().clear().apply()
    }

    fun isActive() = prefs.getString("session", null) != null

    /** Reconciles an online server decision; a revoked policy or kill switch stops immediately. */
    fun stopIfUnavailable(runtimeEnabled: Boolean, activeUnitIds: Set<String>) {
        val unitId = prefs.getString("unit", null) ?: return
        if (!runtimeEnabled || unitId !in activeUnitIds) stopFromServer()
    }

    /** Terminal response from the server: no final coordinate/control event may be queued again. */
    fun stopFromServer(expectedSessionId: String? = null) {
        val session = prefs.getString("session", null)
        if (expectedSessionId != null && session != expectedSessionId) return
        val workDate = prefs.getString("date", null)
        val unitId = prefs.getString("unit", null)
        val stopAt = prefs.getLong("stopAt", 0L)
        prefs.edit().clear().apply()
        if (session != null && workDate != null && unitId != null) dispatch(JourneyLocationService.ACTION_ABORT, session, workDate, unitId, stopAt)
    }

    private fun eligible(shift: OwnShift?, unitId: String?, policyActive: Boolean, runtimeEnabled: Boolean) =
        runtimeEnabled && shift?.executionUnitPolicy == "free" && shift.locationTrackingPolicy == "workday"
            && policyActive && !unitId.isNullOrBlank()

    private fun apply(desired: String, shift: OwnShift, workDate: String, unitId: String, zoneId: ZoneId) {
        var session = prefs.getString("session", null)?.takeIf { prefs.getString("date", null) == workDate }
        val current = prefs.getString("state", null)
        if (desired == current) return
        if (session == null && desired != "active") return
        val end = shift.endTime?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
        val date = LocalDate.parse(workDate).plusDays(if (shift.overnight) 1 else 0)
        val stopAt = end?.let { date.atTime(it).atZone(zoneId).plusHours(2).toInstant().toEpochMilli() }
            ?: System.currentTimeMillis() + 18 * 60 * 60 * 1000L
        if (session == null) session = UUID.randomUUID().toString()
        val action = when {
            desired == "stopped" -> JourneyLocationService.ACTION_STOP
            current == null -> JourneyLocationService.ACTION_START
            desired == "paused" -> JourneyLocationService.ACTION_PAUSE
            else -> JourneyLocationService.ACTION_RESUME
        }
        dispatch(action, session, workDate, unitId, stopAt)
        if (desired == "stopped") prefs.edit().clear().apply()
        else prefs.edit().putString("session", session).putString("date", workDate).putString("unit", unitId)
            .putString("state", desired).putLong("stopAt", stopAt).apply()
    }

    private fun dispatch(action: String, session: String, workDate: String, unitId: String, stopAt: Long) {
        val intent = Intent(context, JourneyLocationService::class.java).setAction(action)
            .putExtra(JourneyLocationService.EXTRA_SESSION, session).putExtra(JourneyLocationService.EXTRA_DATE, workDate)
            .putExtra(JourneyLocationService.EXTRA_UNIT, unitId).putExtra(JourneyLocationService.EXTRA_STOP_AT, stopAt)
        if (action == JourneyLocationService.ACTION_START || action == JourneyLocationService.ACTION_RESUME) ContextCompat.startForegroundService(context, intent)
        else context.startService(intent)
    }
}

/** Same conservative sequence enforced by the server; an invalid declaration never starts or resumes sensors. */
internal fun nextJourneyTrackingState(current: String?, purpose: String): String? = when {
    current == null && purpose == "journey_start" -> "active"
    current == "active" && purpose == "break_start" -> "paused"
    current == "paused" && purpose == "break_end" -> "active"
    (current == "active" || current == "paused") && purpose == "journey_end" -> "stopped"
    else -> null
}
