package com.coalaone.go

import com.coalaone.go.location.nextJourneyTrackingState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JourneyLocationTransitionTest {
    @Test fun onlyAValidDeclaredSequenceControlsCollection() {
        assertEquals("active", nextJourneyTrackingState(null, "journey_start"))
        assertEquals("paused", nextJourneyTrackingState("active", "break_start"))
        assertEquals("active", nextJourneyTrackingState("paused", "break_end"))
        assertEquals("stopped", nextJourneyTrackingState("active", "journey_end"))
        assertEquals("stopped", nextJourneyTrackingState("paused", "journey_end"))
    }

    @Test fun divergentClassificationNeverStartsOrResumesCollection() {
        assertNull(nextJourneyTrackingState(null, "break_end"))
        assertNull(nextJourneyTrackingState(null, "journey_end"))
        assertNull(nextJourneyTrackingState("active", "journey_start"))
        assertNull(nextJourneyTrackingState("active", "break_end"))
        assertNull(nextJourneyTrackingState("paused", "journey_start"))
        assertNull(nextJourneyTrackingState("paused", "break_start"))
    }
}
