package com.coalaone.go

import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class RulesTest {
    @Test fun quantitiesAndCentsRetainDecimalPrecision() {
        assertEquals(1234.567, Rules.quantity("1.234,567"), 0.000001)
        assertEquals("0,3", Rules.quantityText(0.1 + 0.2))
        assertEquals(123456L, Rules.cents("1.234,56"))
        assertNull(Rules.cents("1,234"))
        assertEquals(0.0, Rules.quantity("-1"), 0.0)
    }
    @Test fun mergePrefersNewerServerAndFiltersUnknownLots() {
        val session = countSession()
        val older = StoredCountDraft(Instant.parse("2026-10-01T12:00:00Z").toEpochMilli(), mapOf("lot" to CountDraft(exit = "2"), "alien" to CountDraft(exit = "3")))
        assertEquals("", Rules.merge(session, older).getValue("lot").exit)
        val newer = older.copy(savedAt = Instant.parse("2026-10-01T14:00:00Z").toEpochMilli())
        assertEquals("2", Rules.merge(session, newer).getValue("lot").exit)
        assertFalse(Rules.merge(session, newer).containsKey("alien"))
        assertEquals("2", Rules.merge(session.copy(updatedAt = null), newer).getValue("lot").exit)
        assertEquals("", Rules.merge(session, null).getValue("lot").exit)
        assertEquals("", Rules.merge(session.copy(updatedAt = null), newer.copy(drafts = mapOf("alien" to CountDraft(exit = "3")))).getValue("lot").exit)
        assertEquals("2", Rules.merge(session.copy(updatedAt = null), newer.copy(savedAt = 0)).getValue("lot").exit)
    }
    @Test fun untouchedLotsDoNotTravelAndNegativeStockIsRejected() {
        val session = countSession()
        assertTrue(Rules.countRequest(session, mapOf("lot" to CountDraft()), false).entries.isEmpty())
        val request = Rules.countRequest(session, mapOf("lot" to CountDraft(exit = "2", entry = "1")), true)
        assertEquals(2.0, request.entries.single().exitQuantity, 0.0)
        assertThrows(IllegalArgumentException::class.java) { Rules.countRequest(session, mapOf("lot" to CountDraft(exit = "13")), true) }
        assertThrows(IllegalArgumentException::class.java) { Rules.countRequest(session, mapOf("lot" to CountDraft(exit = "1", reason = "SAIDA_DESCARTE_OUTROS")), true) }
    }
    @Test fun receiptRequiresEveryLotAndExplainedDivergence() {
        val activity = Reposition("a", "CD", "unit", "Unidade", "2026-10-01", rows = listOf(RepositionRow("base", "lot", "Leite", "L1", 12.0)))
        assertThrows(IllegalArgumentException::class.java) { Rules.receipt(activity, emptyMap()) }
        assertThrows(IllegalArgumentException::class.java) { Rules.receipt(activity, mapOf("base:lot" to ("11" to ""))) }
        assertEquals(0.0, Rules.receipt(activity, mapOf("base:lot" to ("0" to "Não chegou"))).rows.single().receivedQuantity, 0.0)
    }
    @Test fun uploadLimitsAndFundingAreValidatedBeforePersistence() {
        Rules.validateUpload(pending())
        assertThrows(IllegalArgumentException::class.java) { Rules.validateUpload(pending().copy(receipts = emptyList())) }
        assertThrows(IllegalArgumentException::class.java) { Rules.validateUpload(pending().copy(fundingSource = "company_payment")) }
        assertThrows(IllegalArgumentException::class.java) { Rules.validateUpload(pending().copy(receipts = pending().receipts + pending().receipts)) }
        assertThrows(IllegalArgumentException::class.java) { Rules.validateUpload(pending().copy(note = "a".repeat(241))) }
    }
    @Test fun confirmationPreservesTotalsAndPaymentContract() {
        Rules.validatePurchase(purchase())
        assertThrows(IllegalArgumentException::class.java) { Rules.validatePurchase(purchase().copy(totalCents = 5001)) }
        assertThrows(IllegalArgumentException::class.java) { Rules.validatePurchase(purchase().copy(fundingSource = "company_payment")) }
        assertThrows(IllegalArgumentException::class.java) { Rules.validatePurchase(purchase().copy(companyPaymentMethod = "pix")) }
        assertThrows(IllegalArgumentException::class.java) { Rules.validatePurchase(purchase().copy(purchaseDate = "2026-02-30")) }
    }
    @Test fun signageCodeAndWeekMatchLegacyContract() {
        assertEquals("ABCDEFGH", Rules.pairingCode("COALA-SIGNAGE:abcdefgh"))
        assertNull(Rules.pairingCode("COALA-SIGNAGE:ABCD0FGH"))
        val week = Rules.week(LocalDate.of(2026, 11, 1))
        assertEquals("2026-10-26", week.first().toString())
        assertEquals("2026-11-01", week.last().toString())
    }
    @Test fun updatesRequireValidInstalledCodeAndMinimumVersion() {
        val release = Release(5, "v", 4, "/app/a.apk")
        assertTrue(Rules.updateRequired(release, 3))
        assertFalse(Rules.updateRequired(release, 0))
        assertFalse(Rules.updateRequired(null, 3))
        assertFalse(Rules.updateRequired(release, 4))
    }
}
