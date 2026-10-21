package com.coalaone.go.offline

import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeOfflineRules
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private const val MAX_PENDING_MARKINGS = 20
data class CapturedOfflineMarking(val id: String, val markedAt: String, val workDate: String)

interface TimeOfflineQueue {
    fun observe(uid: String): Flow<List<TimeMarkingRow>>
    suspend fun permitRequest(uid: String, workDate: String, elapsedRealtimeMs: Long): OfflinePermitRequest?
    suspend fun savePermit(uid: String, permit: OfflinePermit)
    suspend fun permit(uid: String): OfflinePermit?
    suspend fun cachedOptions(uid: String, elapsedRealtimeMs: Long): TimeOptions?
    suspend fun capture(uid: String, executionUnitId: String, elapsedRealtimeMs: Long): CapturedOfflineMarking
    suspend fun ready(uid: String): List<Pair<TimeMarkingRow, MarkingRequest>>
    suspend fun synced(uid: String, id: String)
    suspend fun failed(uid: String, id: String, failure: AppFailure)
}

@Singleton class TimeOfflineStore @Inject constructor(private val database: TimeOfflineDatabase, private val vault: Vault,
    private val identity: TimeDeviceIdentity, private val json: Json) : TimeOfflineQueue {
    private val mutex = Mutex()
    private fun owner(uid: String) = vault.owner(uid)
    override fun observe(uid: String) = database.timeOffline().observe(owner(uid))
    override suspend fun permitRequest(uid: String, workDate: String, elapsedRealtimeMs: Long): OfflinePermitRequest? {
        val key = identity.key(uid); val bootCount = identity.bootCount()
        require(bootCount >= 0) { "O aparelho não informou sua sequência de inicialização." }
        val current = permit(uid)
        if (current != null && current.deviceKeyId == key.keyId && current.bootCount == bootCount
            && elapsedRealtimeMs >= current.anchorElapsedRealtimeMs
            && elapsedRealtimeMs - current.anchorElapsedRealtimeMs < 10 * 60 * 60 * 1000L) return null
        return OfflinePermitRequest(UUID.randomUUID().toString(), workDate, identity.installationId(), key.keyId,
            key.publicKey, key.security, bootCount, elapsedRealtimeMs)
    }
    override suspend fun savePermit(uid: String, permit: OfflinePermit) = withContext(Dispatchers.IO) { mutex.withLock {
        require(permit.deviceKeyId == identity.key(uid).keyId && permit.bootCount == identity.bootCount())
        val sealed = vault.seal(uid, "time-permit:${permit.permitId}", json.encodeToString(permit).toByteArray())
        database.timeOffline().permit(TimePermitRow(owner(uid), permit.permitId, Instant.parse(permit.expiresAt).toEpochMilli(), sealed))
        database.timeOffline().removeOldConfirmed(owner(uid), permit.permitId)
    } }
    override suspend fun permit(uid: String): OfflinePermit? = withContext(Dispatchers.IO) {
        val row = database.timeOffline().permit(owner(uid)) ?: return@withContext null
        runCatching { json.decodeFromString<OfflinePermit>(vault.open(uid, "time-permit:${row.permitId}", row.sealed).decodeToString()) }.getOrNull()
    }
    override suspend fun cachedOptions(uid: String, elapsedRealtimeMs: Long): TimeOptions? {
        val permit = permit(uid) ?: return null
        if (permit.bootCount != identity.bootCount() || elapsedRealtimeMs < permit.anchorElapsedRealtimeMs
            || elapsedRealtimeMs - permit.anchorElapsedRealtimeMs > 12 * 60 * 60 * 1000L) return null
        val first = permit.units.firstOrNull() ?: return null
        val markedAt = TimeOfflineRules.markedAt(permit.anchorInstant, permit.anchorElapsedRealtimeMs, elapsedRealtimeMs, first.timeZone)
        val instant = Instant.parse(permit.anchorInstant).plusMillis(elapsedRealtimeMs - permit.anchorElapsedRealtimeMs)
        return TimeOptions(markedAt.take(10), true, true,
            permit.units.map { ExecutionUnit(it.id, it.name, timeZone = it.timeZone) },
            OfficialClock(true, instant.toString(), first.timeZone))
    }
    override suspend fun capture(uid: String, executionUnitId: String, elapsedRealtimeMs: Long) = withContext(Dispatchers.IO) { mutex.withLock {
        val permit = permit(uid) ?: error("Conecte o aparelho antes de usar o ponto offline.")
        val bootCount = identity.bootCount()
        require(bootCount >= 0 && permit.bootCount == bootCount) { "O aparelho foi reiniciado. Conecte-o antes de registrar outro ponto." }
        require(elapsedRealtimeMs >= permit.anchorElapsedRealtimeMs) { "A hora segura do aparelho não pôde ser confirmada." }
        val elapsed = elapsedRealtimeMs - permit.anchorElapsedRealtimeMs
        require(elapsed <= 12 * 60 * 60 * 1000L) { "A autorização offline venceu. Conecte o aparelho para renovar." }
        val unit = permit.units.firstOrNull { it.id == executionUnitId } ?: error("A unidade não está liberada para o ponto offline.")
        require(database.timeOffline().pendingCount(owner(uid)) < MAX_PENDING_MARKINGS) { "Há 20 marcações aguardando envio. Conecte o aparelho antes de registrar outra." }
        val previous = database.timeOffline().listPermit(owner(uid), permit.permitId).lastOrNull()?.let { row ->
            json.decodeFromString<MarkingRequest>(vault.open(uid, "time-marking:${row.id}", row.sealed).decodeToString())
        }
        val sequence = (previous?.offline?.sequence ?: 0) + 1
        val previousHash = previous?.offline?.localHash
        val markedAt = TimeOfflineRules.markedAt(permit.anchorInstant, permit.anchorElapsedRealtimeMs, elapsedRealtimeMs, unit.timeZone)
        val workDate = markedAt.take(10)
        val attemptId = UUID.randomUUID().toString()
        val canonical = TimeOfflineRules.canonical(permit.permitId, attemptId, executionUnitId, permit.deviceKeyId,
            elapsedRealtimeMs, bootCount, sequence, previousHash, markedAt)
        val hash = TimeOfflineRules.hash(canonical)
        val evidence = OfflineMarkingEvidence(permit.permitId, permit.deviceKeyId, elapsedRealtimeMs, bootCount,
            sequence, previousHash, markedAt, hash, identity.sign(uid, canonical))
        val request = MarkingRequest(attemptId, workDate, executionUnitId, offline = evidence)
        val sealed = vault.seal(uid, "time-marking:$attemptId", json.encodeToString(request).toByteArray())
        database.timeOffline().insert(TimeMarkingRow(owner(uid), attemptId, permit.permitId, sequence,
            System.currentTimeMillis(), sealed = sealed))
        CapturedOfflineMarking(attemptId, markedAt, workDate)
    } }
    override suspend fun ready(uid: String) = withContext(Dispatchers.IO) {
        database.timeOffline().list(owner(uid)).filter { it.state == "READY" }.map { row -> row to
            json.decodeFromString<MarkingRequest>(vault.open(uid, "time-marking:${row.id}", row.sealed).decodeToString()) }
    }
    override suspend fun synced(uid: String, id: String) = database.timeOffline().state(owner(uid), id, "CONFIRMED")
    override suspend fun failed(uid: String, id: String, failure: AppFailure) = database.timeOffline().state(owner(uid), id,
        if (failure.retryable) "READY" else "BLOCKED", failure.message?.take(300))
}
