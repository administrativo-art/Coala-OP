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
import com.coalaone.go.offline.Vault
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Encrypted, owner-isolated buffer for the optional journey trail. Coordinates never enter logs or preferences. */
@Singleton class JourneyLocationQueue @Inject constructor(@ApplicationContext private val context: Context,
    private val auth: AuthGateway, private val vault: Vault, private val repository: ApiRepository,
    private val controller: JourneyLocationController) {
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
        WorkManager.getInstance(context).enqueueUniqueWork("coala-journey-location-${vault.owner(uid)}",
            ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<JourneyLocationWorker>()
                .setInitialDelay(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }
    suspend fun sync(): Boolean = withContext(Dispatchers.IO) {
        val uid = auth.current?.uid ?: return@withContext false
        val directory = folder(uid)
        val files = directory.listFiles()?.sortedBy { it.lastModified() }?.take(50).orEmpty()
        if (files.isEmpty()) return@withContext false
        val decoded = files.mapNotNull { file -> runCatching {
            file to Json.decodeFromString<JourneyLocationEvent>(vault.open(uid, file.nameWithoutExtension, file.readBytes()).decodeToString())
        }.getOrNull() }
        val first = decoded.firstOrNull()?.second ?: return@withContext false
        val selected = decoded.filter { (_, event) -> event.sessionId == first.sessionId && event.workDate == first.workDate }.take(50)
        val response = repository.api.journeyLocation(JourneyLocationBatch(selected.map { it.second }))
        val accepted = response.acceptedEventIds.toSet()
        files.filter { it.nameWithoutExtension in accepted }.forEach(File::delete)
        if (response.stopRequested) {
            directory.listFiles().orEmpty().forEach { file ->
                val belongsToSession = runCatching {
                    Json.decodeFromString<JourneyLocationEvent>(vault.open(uid, file.nameWithoutExtension, file.readBytes()).decodeToString()).sessionId == first.sessionId
                }.getOrDefault(false)
                if (belongsToSession) file.delete()
            }
            controller.stopFromServer()
        }
        folder(uid).listFiles()?.isNotEmpty() == true
    }
}
