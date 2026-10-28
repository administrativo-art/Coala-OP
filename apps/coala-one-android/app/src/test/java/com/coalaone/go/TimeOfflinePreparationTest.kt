package com.coalaone.go

import com.coalaone.go.data.*
import com.coalaone.go.offline.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class TimeOfflinePreparationTest {
    private val auth = TestAuth()
    private val permit = OfflinePermit("permit", "installation", "key", "tee", 273, 1000,
        "2026-10-27T12:00:00Z", "2026-10-27T12:00:00Z", "2026-10-29T12:00:00Z",
        listOf(OfflinePermitUnit("unit", "Unidade", "America/Belem")), "pilot", protocolVersion = 2,
        preparationExpiresAt = "2026-10-28T12:00:00Z")
    private val options = TimeOptions("2026-10-27", true, true, listOf(ExecutionUnit("unit", "Unidade")),
        OfficialClock(true, "2026-10-27T12:00:00Z", "America/Belem"), mode = "pilot")
    private fun queue() = MemoryTimeOfflineQueue().also {
        it.permitRequestValue = OfflinePermitRequest("request", "2026-10-27", "installation", "key", "public-key", "tee", 273, 1000)
    }
    @Test fun openingTheAppPreparesThePermitAndReusesItWithoutNewServerReads() = runTest {
        val queue = queue(); var reads = 0; var issued = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions { reads++; return options }
            override suspend fun offlinePermit(request: OfflinePermitRequest, expectedOwner: String?): OfflinePermitResponse { issued++; return OfflinePermitResponse(permit) }
        }
        val preparation = TimeOfflinePreparation(auth, queue, repository(auth, api), InMemoryDeveloperViewAsStore())
        preparation.prepare("test-owner", elapsed = 1000)
        assertEquals(permit, queue.savedPermit)
        queue.cachedOptionsValue = options
        preparation.prepare("test-owner", elapsed = 2000)
        assertEquals(1, reads); assertEquals(1, issued)
        preparation.prepare("test-owner", elapsed = 1000 + 6 * 60 * 60 * 1000L)
        assertEquals(2, reads); assertEquals(2, issued)
    }
    @Test fun wrongOwnerViewAsAndExplicitServerBlocksNeverIssuePermits() = runTest {
        val queue = queue(); var requests = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun offlinePermit(request: OfflinePermitRequest, expectedOwner: String?): OfflinePermitResponse { requests++; return OfflinePermitResponse(permit) }
        }
        val viewAs = InMemoryDeveloperViewAsStore()
        val preparation = TimeOfflinePreparation(auth, queue, repository(auth, api), viewAs)
        preparation.prepare("someone-else", options, 1000)
        viewAs.select("someone-else")
        preparation.prepare("test-owner", options, 1000)
        viewAs.clear()
        for (blocked in listOf(options.copy(eligible = false), options.copy(markingEnabled = false),
            options.copy(mode = "disabled"), options.copy(officialClock = OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE"))))
            preparation.prepare("test-owner", blocked, 1000)
        assertEquals(0, requests); assertNull(queue.savedPermit)
    }
    @Test fun changingAccountsDuringIssuanceNeverSavesForTheNewAccount() = runTest {
        val queue = queue()
        val api = object : ApiService by DemoApi() {
            override suspend fun offlinePermit(request: OfflinePermitRequest, expectedOwner: String?): OfflinePermitResponse {
                auth.mutable.value = com.coalaone.go.auth.Identity("other", null)
                return OfflinePermitResponse(permit)
            }
        }
        TimeOfflinePreparation(auth, queue, repository(auth, api), InMemoryDeveloperViewAsStore())
            .prepare("test-owner", options, 1000)
        assertNull(queue.savedPermit)
    }
}
