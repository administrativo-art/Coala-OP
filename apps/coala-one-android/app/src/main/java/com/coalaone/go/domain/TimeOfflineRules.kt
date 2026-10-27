package com.coalaone.go.domain

import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object TimeOfflineRules {
    fun permitIssue(permit: com.coalaone.go.data.OfflinePermit?, bootCount: Int, elapsedRealtimeMs: Long): String? {
        if (permit == null) return "Este aparelho ainda não recebeu autorização para ponto sem internet. Conecte-o e abra Ponto para verificar a autorização."
        if (bootCount < 0 || permit.bootCount != bootCount) return "O aparelho foi reiniciado. Conecte-o e abra Ponto para renovar a autorização."
        if (elapsedRealtimeMs < permit.anchorElapsedRealtimeMs) return "A hora segura do aparelho não pôde ser confirmada. Conecte-o para renovar a autorização."
        val elapsed = elapsedRealtimeMs - permit.anchorElapsedRealtimeMs
        val anchor = runCatching { Instant.parse(permit.anchorInstant) }.getOrNull()
        val expires = runCatching { Instant.parse(permit.expiresAt) }.getOrNull()
        if (anchor == null || expires == null || permit.units.isEmpty() || permit.scope !in setOf("pilot", "official"))
            return "A autorização local não pôde ser validada. Conecte-o e abra Ponto para renovar."
        if (elapsed > 12 * 60 * 60 * 1000L || anchor.plusMillis(elapsed).isAfter(expires))
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
        scope: String = "official") =
        listOf(if (scope == "pilot") "coala-rep-p-pilot-offline-v1" else "coala-rep-p-offline-v1",
            permitId, attemptId, executionUnitId, deviceKeyId, elapsedRealtimeMs.toString(),
            bootCount.toString(), sequence.toString(), previousLocalHash.orEmpty(), markedAt).joinToString("\n")
    fun hash(canonical: String) = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
