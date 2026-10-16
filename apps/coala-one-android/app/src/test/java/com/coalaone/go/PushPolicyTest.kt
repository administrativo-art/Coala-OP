package com.coalaone.go

import com.coalaone.go.push.PushPolicy
import org.junit.Assert.*
import org.junit.Test

class PushPolicyTest {
    @Test fun eventDeduplicationIsBoundToTheAccountWithoutStoringItsIdentity() {
        val alice = PushPolicy.eventKey("alice", "event")
        assertEquals(alice, PushPolicy.eventKey("alice", "event"))
        assertNotEquals(alice, PushPolicy.eventKey("bob", "event"))
        assertTrue(alice.matches(Regex("[a-f0-9]{64}")))
    }

    @Test fun blockedNotificationsOpenSettingsAlsoBeforeAndroid13() {
        assertTrue(PushPolicy.requiresSystemSettings(32, false, false))
        assertTrue(PushPolicy.requiresSystemSettings(33, false, true))
        assertFalse(PushPolicy.requiresSystemSettings(33, false, false))
        assertFalse(PushPolicy.requiresSystemSettings(32, true, true))
        assertFalse(PushPolicy.requiresSystemSettings(33, true, true))
    }

    private val id = "4ea3866e-0bd2-43a4-9de5-11b720e0e5b4"
    private val payload = mapOf("recipientId" to "alice", "eventId" to id,
        "path" to "https://op.coalashakes.com/dashboard/collaborator/requests")

    @Test fun onlyOwnConsentedUnseenEventsWithSafePathsAreAccepted() {
        assertTrue(PushPolicy.accept(payload, "alice", true, true, emptySet()))
        assertFalse(PushPolicy.accept(payload, "bob", true, true, emptySet()))
        assertFalse(PushPolicy.accept(payload, "alice", false, true, emptySet()))
        assertFalse(PushPolicy.accept(payload, "alice", true, false, emptySet()))
        assertFalse(PushPolicy.accept(payload, "alice", true, true, setOf(id)))
        assertFalse(PushPolicy.accept(payload + ("eventId" to "wrong"), "alice", true, true, emptySet()))
    }

    @Test fun routeIsRestrictedToTrustedHostAndKnownWebPaths() {
        assertNotNull(PushPolicy.safePath("https://op.coalashakes.com/dashboard/dp/requests"))
        for (url in listOf("http://op.coalashakes.com/dashboard", "https://evil.example/dashboard",
            "https://op.coalashakes.com.evil.example/dashboard", "https://op.coalashakes.com/dashboard?token=x",
            "https://op.coalashakes.com/dashboard/%2e%2e/admin", "https://op.coalashakes.com/admin")) assertNull(PushPolicy.safePath(url))
    }
}
