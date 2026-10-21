package com.coalaone.go.domain

import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

object TimeOfflineRules {
    private val fiscalTimestamp = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:00xx")
    fun markedAt(anchorInstant: String, anchorElapsedRealtimeMs: Long, elapsedRealtimeMs: Long, timeZone: String): String {
        require(elapsedRealtimeMs >= anchorElapsedRealtimeMs)
        return fiscalTimestamp.format(Instant.parse(anchorInstant).plusMillis(elapsedRealtimeMs - anchorElapsedRealtimeMs).atZone(ZoneId.of(timeZone)))
    }
    fun canonical(permitId: String, attemptId: String, executionUnitId: String, deviceKeyId: String,
        elapsedRealtimeMs: Long, bootCount: Int, sequence: Int, previousLocalHash: String?, markedAt: String) =
        listOf("coala-rep-p-offline-v1", permitId, attemptId, executionUnitId, deviceKeyId, elapsedRealtimeMs.toString(),
            bootCount.toString(), sequence.toString(), previousLocalHash.orEmpty(), markedAt).joinToString("\n")
    fun hash(canonical: String) = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
