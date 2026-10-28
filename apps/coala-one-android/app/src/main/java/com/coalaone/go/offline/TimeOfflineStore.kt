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
import androidx.room.withTransaction
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

private const val MAX_PENDING_MARKINGS = 20
data class CapturedOfflineMarking(val id: String, val markedAt: String, val workDate: String)
@Serializable data class LocalTimeCycle(val id: String, val permitId: String, val startedElapsedRealtimeMs: Long,
    val startedAt: String, val expiresAt: String, val origin: String, val status: String = "active",
    val lastElapsedRealtimeMs: Long, val receiptId: String? = null,
    val pendingReceiptId: String? = null, val pendingElapsedRealtimeMs: Long? = null, val serverConfirmed: Boolean = false) {
    fun dto() = OfflineCycle(id, startedAt, expiresAt)
}

interface TimeOfflineQueue {
    fun observe(uid: String): Flow<List<TimeMarkingRow>>
    suspend fun permitRequest(uid: String, workDate: String, elapsedRealtimeMs: Long, scope: String): OfflinePermitRequest?
    suspend fun savePermit(uid: String, permit: OfflinePermit)
    suspend fun permit(uid: String): OfflinePermit?
    suspend fun cachedOptions(uid: String, elapsedRealtimeMs: Long): TimeOptions?
    suspend fun unavailableReason(uid: String, elapsedRealtimeMs: Long): String =
        "Este aparelho ainda não recebeu autorização para ponto sem internet. Conecte-o e abra Ponto para verificar a autorização."
    suspend fun capture(uid: String, executionUnitId: String, elapsedRealtimeMs: Long, declaredPurpose: String): CapturedOfflineMarking
    suspend fun ready(uid: String): List<Pair<TimeMarkingRow, MarkingRequest>>
    suspend fun synced(uid: String, id: String)
    suspend fun failed(uid: String, id: String, failure: AppFailure)
    suspend fun hasPending(uid: String): Boolean = false
    suspend fun beginOnline(uid: String, request: MarkingRequest, scope: String) {}
    suspend fun discardUnrecordedOnline(uid: String, id: String) {}
    suspend fun cycleRefreshRequest(uid: String, workDate: String, elapsedRealtimeMs: Long, scope: String): OfflinePermitRequest? = null
    suspend fun handoffCycleAction(uid: String, scope: String, elapsedRealtimeMs: Long): OfflineCycleAction? = null
    suspend fun closeCycleAction(uid: String, elapsedRealtimeMs: Long): OfflineCycleAction? = null
    suspend fun confirmCycle(uid: String, response: OfflineCycleResponse) {}
    suspend fun confirmed(uid: String, id: String, request: MarkingRequest, response: MarkingResponse) { synced(uid, id) }
}

@Singleton class TimeOfflineStore @Inject constructor(private val database: TimeOfflineDatabase, private val vault: Vault,
    private val identity: TimeDeviceIdentity, private val json: Json) : TimeOfflineQueue {
    private val mutex = Mutex()
    private fun owner(uid: String) = vault.owner(uid)
    private suspend fun cycle(uid: String): LocalTimeCycle? {
        val row = database.timeOffline().cycle(owner(uid)) ?: return null
        return json.decodeFromString<LocalTimeCycle>(vault.open(uid, "time-cycle:${row.cycleId}", row.sealed).decodeToString())
    }
    private suspend fun saveCycle(uid: String, value: LocalTimeCycle) {
        val sealed = vault.seal(uid, "time-cycle:${value.id}", json.encodeToString(value).toByteArray())
        database.timeOffline().cycle(TimeCycleRow(owner(uid), value.id, sealed))
    }
    override fun observe(uid: String) = database.timeOffline().observe(owner(uid))
    override suspend fun permitRequest(uid: String, workDate: String, elapsedRealtimeMs: Long, scope: String): OfflinePermitRequest? {
        val key = identity.key(uid); val bootCount = identity.bootCount()
        require(bootCount >= 0) { "O aparelho não informou sua sequência de inicialização." }
        val current = permit(uid)
        val cycle = cycle(uid)
        if (cycle != null && cycle.pendingReceiptId == null && cycle.status == "active" && current?.permitId == cycle.permitId
            && (Instant.parse(cycle.expiresAt).isAfter(Instant.parse(current.anchorInstant).plusMillis(elapsedRealtimeMs - current.anchorElapsedRealtimeMs))
                || hasPending(uid))) return null
        if (cycle == null && current?.protocolVersion == 2 && current.scope == scope && current.deviceKeyId == key.keyId && current.bootCount == bootCount
            && TimeOfflineRules.permitIssue(current, bootCount, elapsedRealtimeMs) == null
            && elapsedRealtimeMs >= current.anchorElapsedRealtimeMs
            && elapsedRealtimeMs - current.anchorElapsedRealtimeMs < TIME_OFFLINE_RENEW_AFTER_MS) return null
        return OfflinePermitRequest(UUID.randomUUID().toString(), workDate, identity.installationId(), key.keyId,
            key.publicKey, key.security, bootCount, elapsedRealtimeMs, protocolVersion = 2)
    }
    override suspend fun savePermit(uid: String, permit: OfflinePermit) = withContext(Dispatchers.IO) { mutex.withLock {
        require(permit.deviceKeyId == identity.key(uid).keyId && permit.bootCount == identity.bootCount())
        if (permit.protocolVersion == 2 && this@TimeOfflineStore.permit(uid)?.permitId != permit.permitId) {
            require(!hasPending(uid)) { "Aguarde o envio das batidas pendentes antes de renovar o preparo." }
        }
        val currentCycle = cycle(uid)
        if (currentCycle != null && currentCycle.permitId != permit.permitId) {
            require(!hasPending(uid)) { "Envie as batidas pendentes antes de renovar o preparo." }
            require(currentCycle.status == "closed" || !Instant.parse(permit.issuedAt).isBefore(Instant.parse(currentCycle.expiresAt))) {
                "O ciclo aberto conserva sua autorização e prazo original."
            }
        }
        val sealed = vault.seal(uid, "time-permit:${permit.permitId}", json.encodeToString(permit).toByteArray())
        database.withTransaction {
            database.timeOffline().permit(TimePermitRow(owner(uid), permit.permitId, Instant.parse(permit.expiresAt).toEpochMilli(), sealed))
            if (currentCycle != null && currentCycle.permitId != permit.permitId) database.timeOffline().clearCycle(owner(uid))
            permit.cycle?.let { remote ->
                require(remote.permitId == permit.permitId && remote.startedElapsedRealtimeMs != null)
                if (currentCycle != null && currentCycle.serverConfirmed && currentCycle.id == remote.id)
                    require(Instant.parse(currentCycle.expiresAt) == Instant.parse(remote.expiresAt))
                saveCycle(uid, LocalTimeCycle(remote.id, permit.permitId, remote.startedElapsedRealtimeMs,
                    remote.startedAt, remote.expiresAt, "server", status = remote.status,
                    lastElapsedRealtimeMs = remote.lastElapsedRealtimeMs ?: permit.anchorElapsedRealtimeMs,
                    receiptId = remote.lastReceiptId, serverConfirmed = true))
            }
            database.timeOffline().removeOldConfirmed(owner(uid), permit.permitId)
        }
    } }
    override suspend fun permit(uid: String): OfflinePermit? = withContext(Dispatchers.IO) {
        val row = database.timeOffline().permit(owner(uid)) ?: return@withContext null
        runCatching { json.decodeFromString<OfflinePermit>(vault.open(uid, "time-permit:${row.permitId}", row.sealed).decodeToString()) }.getOrNull()
    }
    override suspend fun cachedOptions(uid: String, elapsedRealtimeMs: Long): TimeOptions? {
        if (database.timeOffline().onlinePendingCount(owner(uid)) > 0) return null
        val permit = permit(uid) ?: return null
        val cycle = cycle(uid)
        if (cycle?.status == "closed" || cycle?.origin == "online" && cycle.pendingReceiptId != null) return null
        if (TimeOfflineRules.permitIssue(permit, identity.bootCount(), elapsedRealtimeMs, cycle?.dto()) != null) return null
        if (runCatching { identity.key(uid).keyId }.getOrNull() != permit.deviceKeyId) return null
        val first = permit.units.firstOrNull() ?: return null
        val markedAt = TimeOfflineRules.markedAt(permit.anchorInstant, permit.anchorElapsedRealtimeMs, elapsedRealtimeMs, first.timeZone)
        val instant = Instant.parse(permit.anchorInstant).plusMillis(elapsedRealtimeMs - permit.anchorElapsedRealtimeMs)
        return TimeOptions(markedAt.take(10), true, true,
            permit.units.map { ExecutionUnit(it.id, it.name, timeZone = it.timeZone) },
            OfficialClock(true, instant.toString(), first.timeZone), mode = permit.scope)
    }
    override suspend fun unavailableReason(uid: String, elapsedRealtimeMs: Long): String {
        if (database.timeOffline().onlinePendingCount(owner(uid)) > 0) return "Há uma batida aguardando confirmação. Conecte o aparelho para confirmar o envio."
        val current = permit(uid)
        val cycle = cycle(uid)
        if (cycle?.status == "closed") return "Ciclo encerrado. Conecte o aparelho para preparar o próximo."
        if (cycle?.origin == "online" && cycle.pendingReceiptId != null) return "O ponto está registrado. Conecte o aparelho para confirmar o preparo deste ciclo."
        TimeOfflineRules.permitIssue(current, identity.bootCount(), elapsedRealtimeMs, cycle?.dto())?.let { return it }
        if (runCatching { identity.key(uid).keyId }.getOrNull() != current?.deviceKeyId)
            return "A chave segura desta autorização não está mais disponível. Conecte-o para renovar."
        return "A autorização local não pôde ser recuperada. Conecte-o e tente novamente."
    }
    override suspend fun capture(uid: String, executionUnitId: String, elapsedRealtimeMs: Long, declaredPurpose: String) = withContext(Dispatchers.IO) { mutex.withLock {
        require(database.timeOffline().onlinePendingCount(owner(uid)) == 0) { "Confirme o envio anterior antes de registrar sem internet." }
        val permit = permit(uid) ?: error("Conecte o aparelho antes de usar o ponto offline.")
        val currentCycle = cycle(uid)
        require(currentCycle?.status != "closed") { "Conecte o aparelho para preparar o próximo ciclo." }
        require(currentCycle?.origin != "online" || currentCycle.pendingReceiptId == null) { "Confirme o preparo do ciclo com internet." }
        val bootCount = identity.bootCount()
        val issue = TimeOfflineRules.permitIssue(permit, bootCount, elapsedRealtimeMs, currentCycle?.dto())
        require(issue == null) { issue.orEmpty() }
        require(identity.key(uid).keyId == permit.deviceKeyId) { "A chave segura desta autorização mudou. Conecte-o para renovar." }
        require(bootCount >= 0 && permit.bootCount == bootCount) { "O aparelho foi reiniciado. Conecte-o antes de registrar outro ponto." }
        require(elapsedRealtimeMs >= permit.anchorElapsedRealtimeMs) { "A hora segura do aparelho não pôde ser confirmada." }
        val elapsed = elapsedRealtimeMs - permit.anchorElapsedRealtimeMs
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
        val activeCycle = if (permit.protocolVersion == 2) currentCycle ?: Instant.parse(permit.anchorInstant).plusMillis(elapsed).let {
            LocalTimeCycle(attemptId, permit.permitId, elapsedRealtimeMs, it.toString(), it.plusMillis(TimeOfflineRules.CYCLE_MS).toString(),
                "offline", lastElapsedRealtimeMs = elapsedRealtimeMs)
        } else null
        val cycleEvidence = activeCycle?.let { OfflineCycleEvidence(it.id, it.startedElapsedRealtimeMs) }
        val canonical = TimeOfflineRules.canonical(permit.permitId, attemptId, executionUnitId, permit.deviceKeyId,
            elapsedRealtimeMs, bootCount, sequence, previousHash, markedAt, permit.scope, cycleEvidence)
        val hash = TimeOfflineRules.hash(canonical)
        val evidence = OfflineMarkingEvidence(permit.permitId, permit.deviceKeyId, elapsedRealtimeMs, bootCount,
            sequence, previousHash, markedAt, hash, identity.sign(uid, canonical), permit.scope, cycleEvidence)
        val request = MarkingRequest(attemptId, workDate, executionUnitId, declaredPurpose = declaredPurpose, offline = evidence)
        val sealed = vault.seal(uid, "time-marking:$attemptId", json.encodeToString(request).toByteArray())
        database.withTransaction {
            database.timeOffline().insert(TimeMarkingRow(owner(uid), attemptId, permit.permitId, sequence,
                System.currentTimeMillis(), sealed = sealed))
            activeCycle?.let { saveCycle(uid, it.copy(lastElapsedRealtimeMs = elapsedRealtimeMs, receiptId = null)) }
        }
        CapturedOfflineMarking(attemptId, markedAt, workDate)
    } }
    override suspend fun ready(uid: String) = withContext(Dispatchers.IO) {
        // A blocked member stops its signed chain across worker retries too.
        val blockedPermits = mutableSetOf<String>()
        database.timeOffline().list(owner(uid)).filter { it.state != "CONFIRMED" }.mapNotNull { row ->
            if (row.state != "READY") { blockedPermits += row.permitId; null }
            else if (row.permitId in blockedPermits) null
            else row to json.decodeFromString<MarkingRequest>(vault.open(uid, "time-marking:${row.id}", row.sealed).decodeToString())
        }
    }
    override suspend fun synced(uid: String, id: String) = database.timeOffline().state(owner(uid), id, "CONFIRMED")
    override suspend fun failed(uid: String, id: String, failure: AppFailure) = database.timeOffline().state(owner(uid), id,
        if (failure.retryable) "READY" else "BLOCKED", failure.message?.take(300))

    override suspend fun hasPending(uid: String) = database.timeOffline().pendingCount(owner(uid)) > 0
    override suspend fun cycleRefreshRequest(uid: String, workDate: String, elapsedRealtimeMs: Long, scope: String): OfflinePermitRequest? {
        if (permit(uid)?.protocolVersion != 2 || hasPending(uid)) return null
        val key = identity.key(uid)
        return OfflinePermitRequest(UUID.randomUUID().toString(), workDate, identity.installationId(), key.keyId,
            key.publicKey, key.security, identity.bootCount(), elapsedRealtimeMs, protocolVersion = 2)
    }
    private suspend fun action(uid: String, action: String, current: LocalTimeCycle, receiptId: String, elapsed: Long): OfflineCycleAction {
        val permit = permit(uid) ?: error("Preparo não encontrado.")
        require(permit.permitId == current.permitId && identity.key(uid).keyId == permit.deviceKeyId)
        val last = database.timeOffline().listPermit(owner(uid), permit.permitId).lastOrNull()?.sequence ?: 0
        val input = OfflineCycleAction(action, permit.scope, permit.permitId, current.id, current.startedElapsedRealtimeMs,
            elapsed, permit.bootCount, permit.deviceKeyId, receiptId, last, "")
        return input.copy(signature = identity.sign(uid, TimeOfflineRules.canonicalAction(input)))
    }
    override suspend fun beginOnline(uid: String, request: MarkingRequest, scope: String) = mutex.withLock {
        require(request.offline == null && scope in setOf("official", "pilot") && request.onlineScope == scope)
        val existing = database.timeOffline().marking(owner(uid), request.attemptId)
        val serialized = json.encodeToString(request)
        if (existing != null) {
            require(vault.open(uid, "time-marking:${request.attemptId}", existing.sealed).decodeToString() == serialized)
        } else {
            val sealed = vault.seal(uid, "time-marking:${request.attemptId}", serialized.toByteArray())
            database.timeOffline().insert(TimeMarkingRow(owner(uid), request.attemptId,
                "online:$scope:${request.attemptId}", 0, System.currentTimeMillis(), sealed = sealed))
        }
    }
    override suspend fun discardUnrecordedOnline(uid: String, id: String) = mutex.withLock {
        database.timeOffline().discardUnrecordedOnline(owner(uid), id)
    }
    override suspend fun confirmCycle(uid: String, response: OfflineCycleResponse) = mutex.withLock {
        val current = cycle(uid) ?: error("Ciclo local não encontrado.")
        require(response.cycle.id == current.id && response.status in setOf("active", "closed"))
        require(kotlin.math.abs(Instant.parse(response.cycle.startedAt).toEpochMilli() - Instant.parse(current.startedAt).toEpochMilli()) <= 30_000)
        if (current.serverConfirmed || current.origin == "offline") require(Instant.parse(response.cycle.startedAt) == Instant.parse(current.startedAt)
            && Instant.parse(response.cycle.expiresAt) == Instant.parse(current.expiresAt))
        require(Instant.parse(response.cycle.expiresAt).toEpochMilli() - Instant.parse(response.cycle.startedAt).toEpochMilli() == TimeOfflineRules.CYCLE_MS)
        saveCycle(uid, current.copy(startedAt = response.cycle.startedAt, expiresAt = response.cycle.expiresAt,
            status = response.status, pendingReceiptId = null, pendingElapsedRealtimeMs = null, serverConfirmed = true))
    }
    override suspend fun confirmed(uid: String, id: String, request: MarkingRequest, response: MarkingResponse) = mutex.withLock {
        require(response.status in setOf("recorded", "replayed") && response.receiptId.isNotBlank()
            && response.marking.executionUnitId == request.executionUnitId)
        database.withTransaction {
            val current = cycle(uid)
            val evidence = request.offline
            val permit = permit(uid)
            val remote = response.offlineCycle
            if (evidence == null && permit?.protocolVersion == 2 && permit.scope == (if (response.pilot) "pilot" else "official")) {
                if (remote?.permitId == permit.permitId && remote.startedElapsedRealtimeMs != null) {
                    if (current?.serverConfirmed == true && current.id == remote.id)
                        require(Instant.parse(current.expiresAt) == Instant.parse(remote.expiresAt))
                    saveCycle(uid, LocalTimeCycle(remote.id, permit.permitId, remote.startedElapsedRealtimeMs,
                        remote.startedAt, remote.expiresAt, "server", status = remote.status,
                        lastElapsedRealtimeMs = remote.lastElapsedRealtimeMs ?: maxOf(permit.anchorElapsedRealtimeMs, current?.lastElapsedRealtimeMs ?: 0),
                        receiptId = remote.lastReceiptId ?: response.receiptId, serverConfirmed = true))
                } else {
                    // A missing auxiliary response never undoes a confirmed fiscal original, but blocks
                    // offline capture until issuance recovers the server's already-fixed first instant.
                    val instant = Instant.parse(permit.anchorInstant)
                    saveCycle(uid, current?.copy(origin = "online", pendingReceiptId = response.receiptId)
                        ?: LocalTimeCycle(request.attemptId, permit.permitId, permit.anchorElapsedRealtimeMs,
                            instant.toString(), instant.plusMillis(TimeOfflineRules.CYCLE_MS).toString(), "online",
                            lastElapsedRealtimeMs = permit.anchorElapsedRealtimeMs, pendingReceiptId = response.receiptId))
                }
            } else if (current != null && evidence != null && current.id == evidence.cycle?.id
                && evidence.elapsedRealtimeMs >= current.lastElapsedRealtimeMs) {
                saveCycle(uid, current.copy(receiptId = response.receiptId, lastElapsedRealtimeMs = evidence.elapsedRealtimeMs, serverConfirmed = true))
            }
            database.timeOffline().state(owner(uid), id, "CONFIRMED")
        }
    }
    override suspend fun closeCycleAction(uid: String, elapsedRealtimeMs: Long): OfflineCycleAction? = mutex.withLock {
        val permit = permit(uid) ?: return@withLock null
        if (permit.protocolVersion != 2) return@withLock null
        val current = cycle(uid) ?: error("Não há ciclo iniciado neste aparelho.")
        require(!hasPending(uid) && current.pendingReceiptId == null) { "Envie e confirme todas as batidas antes de encerrar o ciclo." }
        action(uid, "close", current, current.receiptId ?: error("A última batida ainda não foi confirmada."),
            maxOf(elapsedRealtimeMs, current.lastElapsedRealtimeMs))
    }
    override suspend fun handoffCycleAction(uid: String, scope: String, elapsedRealtimeMs: Long): OfflineCycleAction? {
        val permit = permit(uid) ?: return null
        if (permit.scope == scope || permit.protocolVersion != 2) return null
        val current = cycle(uid) ?: return null
        if (current.status == "closed") return null
        return closeCycleAction(uid, elapsedRealtimeMs)
    }
}
