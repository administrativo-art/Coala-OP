package com.coalaone.go.location

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.data.ApiRepository
import com.coalaone.go.data.JourneyLocationBatch
import com.coalaone.go.data.JourneyLocationEvent
import com.coalaone.go.data.Errors
import com.coalaone.go.offline.Vault
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.SerializationException
import java.io.File
import java.util.concurrent.TimeUnit
import javax.crypto.AEADBadTagException
import javax.inject.Inject
import javax.inject.Singleton

/** Encrypted, owner-isolated buffer for the optional journey trail. Coordinates never enter logs or preferences. */
@Singleton class JourneyLocationQueue @Inject constructor(@ApplicationContext private val context: Context,
    private val auth: AuthGateway, private val vault: Vault, private val repository: ApiRepository,
    private val controller: JourneyLocationController, private val leaseStore: JourneyLocationLeaseStore) {
    private fun folder(uid: String) = File(context.noBackupFilesDir, "journey-location/${vault.owner(uid)}").apply { mkdirs() }
    suspend fun enqueue(event: JourneyLocationEvent) = withContext(Dispatchers.IO) {
        val uid = auth.current?.uid ?: return@withContext
        val directory = folder(uid)
        val rows = directory.listFiles()?.sortedBy { it.lastModified() }.orEmpty()
        if (rows.size >= 500) {
            if (event.eventType == "sample") return@withContext
            val oldestSample = rows.firstOrNull { file -> runCatching {
                Json.decodeFromString<JourneyLocationEvent>(vault.open(uid, file.nameWithoutExtension, file.readBytes()).decodeToString()).eventType == "sample"
            }.getOrDefault(false) }
            if (oldestSample?.delete() != true) return@withContext
        }
        val target = File(directory, "${event.eventId}.bin")
        if (!target.exists()) target.writeBytes(vault.seal(uid, event.eventId, Json.encodeToString(event).toByteArray()))
        val request = OneTimeWorkRequestBuilder<JourneyLocationWorker>()
            .setInitialDelay(if (event.eventType == "stop") 0 else 15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniqueWork("coala-journey-location-${vault.owner(uid)}",
            if (event.eventType == "stop") ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, request)
    }
    suspend fun sync(): Boolean = withContext(Dispatchers.IO) {
        val uid = auth.current?.uid ?: return@withContext false
        val directory = folder(uid)
        val files = directory.listFiles()?.sortedBy { it.lastModified() }?.take(50).orEmpty()
        if (files.isEmpty()) return@withContext false
        val decoded = files.mapNotNull { file -> try {
            file to Json.decodeFromString<JourneyLocationEvent>(vault.open(uid, file.nameWithoutExtension, file.readBytes()).decodeToString())
        } catch (cause: Exception) {
            if (cause is SerializationException || cause is IllegalArgumentException || cause is AEADBadTagException) {
                file.delete(); null
            } else throw cause
        } }
        val first = decoded.firstOrNull()?.second
            ?: return@withContext folder(uid).listFiles()?.isNotEmpty() == true
        val selected = decoded.filter { (_, event) -> event.sessionId == first.sessionId && event.workDate == first.workDate }.take(50)
        val terminalCodes = setOf("DP_JOURNEY_LOCATION_DISABLED", "DP_JOURNEY_LOCATION_NOT_CONFIGURED",
            "DP_JOURNEY_LOCATION_POLICY_INACTIVE", "DP_JOURNEY_LOCATION_LEASE_INVALID",
            "DP_JOURNEY_LOCATION_JOURNEY_INACTIVE", "DP_JOURNEY_LOCATION_INPUT_INVALID",
            "DP_JOURNEY_LOCATION_EVENT_CONFLICT", "DP_JOURNEY_LOCATION_SCHEDULE_INCOMPLETE",
            "DP_JOURNEY_LOCATION_SCHEDULE_INVALID", "DP_JOURNEY_LOCATION_SEQUENCE_INVALID",
            "DP_JOURNEY_LOCATION_SESSION_INVALID", "DP_JOURNEY_LOCATION_TIME_INVALID",
            "DP_JOURNEY_LOCATION_TIME_ZONE_MISSING", "DP_JOURNEY_LOCATION_UNIT_MISMATCH",
            "DP_JOURNEY_LOCATION_RATE_INVALID", "DP_JOURNEY_LOCATION_SESSION_LIMIT")
        val lease = try {
            leaseStore.valid(first.sessionId, first.workDate, first.executionUnitId)
        } catch (cause: Exception) {
            if (Errors.serverCode(cause) in terminalCodes) {
                discardSession(uid, directory, first.sessionId)
                leaseStore.clear(first.sessionId)
                controller.stopFromServer(first.sessionId)
                return@withContext false
            }
            throw cause
        }
        val response = try {
            repository.api.journeyLocation(JourneyLocationBatch(lease.leaseToken, selected.map { it.second }))
        } catch (cause: Exception) {
            if (Errors.serverCode(cause) in terminalCodes) {
                discardSession(uid, directory, first.sessionId)
                leaseStore.clear(first.sessionId)
                controller.stopFromServer(first.sessionId)
                return@withContext false
            }
            throw cause
        }
        val accepted = response.acceptedEventIds.toSet()
        files.filter { it.nameWithoutExtension in accepted }.forEach(File::delete)
        if (selected.any { (file, event) -> file.nameWithoutExtension in accepted && event.eventType == "stop" }) {
            leaseStore.clear(first.sessionId)
        }
        if (response.stopRequested) {
            discardSession(uid, directory, first.sessionId)
            leaseStore.clear(first.sessionId)
            controller.stopFromServer(first.sessionId)
        }
        folder(uid).listFiles()?.isNotEmpty() == true
    }

    private fun discardSession(uid: String, directory: File, sessionId: String) {
        directory.listFiles().orEmpty().forEach { file ->
            val belongsToSession = runCatching {
                Json.decodeFromString<JourneyLocationEvent>(vault.open(uid, file.nameWithoutExtension, file.readBytes()).decodeToString()).sessionId == sessionId
            }.getOrDefault(false)
            if (belongsToSession) file.delete()
        }
    }
}
