package com.coalaone.go

import com.coalaone.go.data.OfflinePermit
import com.coalaone.go.data.OfflinePermitUnit
import com.coalaone.go.domain.TimeOfflineRules
import org.junit.Assert.*
import org.junit.Test

class OfflinePermitAvailabilityTest {
    private val permit = OfflinePermit("permit", "installation", "key", "tee", 273, 1000,
        "2026-10-27T12:00:00Z", "2026-10-27T12:00:00Z", "2026-10-28T00:00:00Z",
        listOf(OfflinePermitUnit("unit", "Unidade", "America/Belem")), "pilot")
    @Test fun missingRestartExpiredAndInvalidPermitsExplainWhyCaptureIsUnavailable() {
        assertNull(TimeOfflineRules.permitIssue(permit, 273, 2000))
        assertTrue(TimeOfflineRules.permitIssue(null, 273, 2000)!!.contains("ainda não recebeu autorização"))
        assertTrue(TimeOfflineRules.permitIssue(permit, 274, 2000)!!.contains("reiniciado"))
        assertTrue(TimeOfflineRules.permitIssue(permit, 273, 1000 + 12 * 60 * 60 * 1000L + 1)!!.contains("venceu"))
        assertTrue(TimeOfflineRules.permitIssue(permit.copy(expiresAt = "2026-10-27T12:00:01Z"), 273, 3000)!!.contains("venceu"))
        assertNotNull(TimeOfflineRules.permitIssue(permit, 273, 999))
        assertNotNull(TimeOfflineRules.permitIssue(permit.copy(anchorInstant = "invalid"), 273, 2000))
        assertNotNull(TimeOfflineRules.permitIssue(permit.copy(scope = "unknown"), 273, 2000))
    }
}
