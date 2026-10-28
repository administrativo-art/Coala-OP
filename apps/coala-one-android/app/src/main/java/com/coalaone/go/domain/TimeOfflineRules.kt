package com.coalaone.go.domain

import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object TimeOfflineRules {
    const val PREPARATION_MS = 24 * 60 * 60 * 1000L
    const val CYCLE_MS = 24 * 60 * 60 * 1000L
    fun permitIssue(permit: com.coalaone.go.data.OfflinePermit?, bootCount: Int, elapsedRealtimeMs: Long,
        cycle: com.coalaone.go.data.OfflineCycle? = null): String? {
        if (permit == null) return "Este aparelho ainda não recebeu autorização para ponto sem internet. Conecte-o e abra Ponto para verificar a autorização."
        if (bootCount < 0 || permit.bootCount != bootCount) return "O aparelho foi reiniciado. Conecte-o e abra Ponto para renovar a autorização."
        if (elapsedRealtimeMs < permit.anchorElapsedRealtimeMs) return "A hora segura do aparelho não pôde ser confirmada. Conecte-o para renovar a autorização."
        val elapsed = elapsedRealtimeMs - permit.anchorElapsedRealtimeMs
        val anchor = runCatching { Instant.parse(permit.anchorInstant) }.getOrNull()
        val expires = runCatching { Instant.parse(permit.expiresAt) }.getOrNull()
        if (anchor == null || expires == null || permit.units.isEmpty() || permit.scope !in setOf("pilot", "official"))
            return "A autorização local não pôde ser validada. Conecte-o e abra Ponto para renovar."
        val deadline = if (permit.protocolVersion == 2) {
            runCatching { Instant.parse(cycle?.expiresAt ?: permit.preparationExpiresAt) }.getOrNull()
                ?: return "O preparo do aparelho não pôde ser validado. Conecte-o novamente."
        } else expires
        val maximum = if (permit.protocolVersion == 2) PREPARATION_MS + (if (cycle == null) 0 else CYCLE_MS) else 12 * 60 * 60 * 1000L
        if (elapsed > maximum || anchor.plusMillis(elapsed).isAfter(deadline))
            return "A autorização para ponto sem internet venceu. Conecte-o e abra Ponto para renovar."
        return null
    }
    private val fiscalTimestamp = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:00xx")
    fun markedAt(anchorInstant: String, anchorElapsedRealtimeMs: Long, elapsedRealtimeMs: Long, timeZone: String): String {
        require(elapsedRealtimeMs >= anchorElapsedRealtimeMs)
        return fiscalTimestamp.format(Instant.parse(anchorInstant).plusMillis(elapsedRealtimeMs - anchorElapsedRealtimeMs).atZone(ZoneId.of(timeZone)))
    }
    fun canonical(permitId: String, attemptId: String, executionUnitId: String, deviceKeyId: String,
        elapsedRealtimeMs: Long, bootCount: Int, sequence: Int, previousLocalHash: String?, markedAt: String,
        scope: String = "official", cycle: com.coalaone.go.data.OfflineCycleEvidence? = null) =
        (listOf("coala-rep-p${if (scope == "pilot") "-pilot" else ""}-offline-v${if (cycle == null) 1 else 2}",
            permitId, attemptId, executionUnitId, deviceKeyId, elapsedRealtimeMs.toString(),
            bootCount.toString(), sequence.toString(), previousLocalHash.orEmpty(), markedAt)
            + (cycle?.let { listOf(it.id, it.startedElapsedRealtimeMs.toString()) } ?: emptyList())).joinToString("\n")
    fun canonicalAction(action: com.coalaone.go.data.OfflineCycleAction) = listOf(
        "coala-rep-p-${action.scope}-cycle-v2", action.action, action.permitId, action.cycleId,
        action.startedElapsedRealtimeMs.toString(), action.elapsedRealtimeMs.toString(), action.bootCount.toString(),
        action.deviceKeyId, action.receiptId, action.lastSequence.toString()).joinToString("\n")
    fun hash(canonical: String) = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
