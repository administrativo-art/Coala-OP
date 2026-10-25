package com.coalaone.go

import com.coalaone.go.data.*
import com.coalaone.go.domain.CropSquare
import com.coalaone.go.domain.PhotoCrop
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
        Rules.validateUpload(pending().copy(fundingSource = "company_payment"))
        assertThrows(IllegalArgumentException::class.java) { Rules.validateUpload(pending().copy(paymentProofs = pending().receipts)) }
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
        val pilotRelease = Release(26, "0.3.21", 26, "/app/CoalaGo.apk")
        assertTrue(Rules.updateRequired(pilotRelease, 25))
        assertFalse(Rules.updateRequired(pilotRelease, 26))
    }
    @Test fun profilePhotoFramingStaysInsideThePhoto() {
        // A landscape photo at zoom 1 shows its centred square; dragging right reveals the left edge and stops there.
        assertEquals(CropSquare(500, 0, 1000), PhotoCrop.square(2000, 1000, 1f, 500f, 0f, 0f))
        assertEquals(CropSquare(0, 0, 1000), PhotoCrop.square(2000, 1000, 1f, 500f, 9999f, 9999f))
        assertEquals(CropSquare(1000, 0, 1000), PhotoCrop.square(2000, 1000, 1f, 500f, -9999f, 0f))
        // Zoom 2 halves the square and frees the vertical drag: 100 frame pixels are 100 photo pixels here.
        assertEquals(CropSquare(750, 250, 500), PhotoCrop.square(2000, 1000, 2f, 500f, 0f, 0f))
        assertEquals(CropSquare(650, 350, 500), PhotoCrop.square(2000, 1000, 2f, 500f, 100f, -100f))
        assertEquals(250f to 0f, PhotoCrop.clamp(2000, 1000, 1f, 500f, 400f, 400f))
        assertEquals(PhotoCrop.MAX_ZOOM, PhotoCrop.zoom(99f), 0f); assertEquals(PhotoCrop.MIN_ZOOM, PhotoCrop.zoom(.2f), 0f)
        // A tiny photo never yields an empty or out-of-bounds square.
        assertEquals(CropSquare(1, 0, 1), PhotoCrop.square(3, 1, 5f, 900f, 0f, 0f))
    }
    @Test fun allUnitsChoiceAppearsOnlyWithSeveralUnits() {
        val one = listOf("a" to "Centro"); val two = one + ("b" to "Orla")
        assertEquals(one, Rules.unitChoices(one)); assertEquals(emptyList<Pair<String, String>>(), Rules.unitChoices(emptyList()))
        assertEquals(listOf(Rules.ALL_UNITS to "Todas as unidades") + two, Rules.unitChoices(two))
    }
    @Test fun purchaseFiltersFollowOrganizationAndGroup() {
        val units = listOf(
            UnitRef("a", "Centro", "g1", "Quiosques", "o1", "Coala"),
            UnitRef("b", "Orla", "g1", "Quiosques", "o1", "Coala"),
            UnitRef("c", "CD", "g2", "Abastecimento", "o2", "Logística"),
            UnitRef("d", "Legada"),
            UnitRef("e", "Shopping", "g3", "Shoppings", "o1", "Coala"),
        )
        val withdrawals = units.take(4).mapIndexed { index, unit -> Withdrawal(index.toString().repeat(64), unit.id, unit.name, "2026-10-01", amountCents = 100L + index) } +
            Withdrawal("9".repeat(64), "z", "Fora do contexto", "2026-10-01", amountCents = 1)
        assertEquals(listOf("a", "b"), Rules.filterWithdrawals(withdrawals, units, "o1", "g1").map { it.unitId })
        assertEquals(listOf("d"), Rules.filterWithdrawals(withdrawals, units, Rules.NO_ORGANIZATION, Rules.NO_GROUP).map { it.unitId })
        // A unit the context does not know only shows with no filter.
        assertEquals(5, Rules.filterWithdrawals(withdrawals, units, Rules.ALL_UNITS, Rules.ALL_UNITS).size)
        assertEquals(listOf(Rules.ALL_UNITS to "Todas as organizações", "o1" to "Coala", "o2" to "Logística", Rules.NO_ORGANIZATION to "Sem organização"), Rules.purchaseOrganizationChoices(units))
        // A group with nothing pending is still offered; the filter labels carry no counts.
        assertEquals(listOf(Rules.ALL_UNITS to "Todos", "g1" to "Quiosques", "g3" to "Shoppings"), Rules.purchaseGroupChoices(units, "o1"))
        // Only units with withdrawals become cards, each with its count, by name.
        assertEquals(listOf(Triple("c", "CD", 1), Triple("a", "Centro", 1), Triple("z", "Fora do contexto", 1), Triple("d", "Legada", 1), Triple("b", "Orla", 1)), Rules.purchaseUnitCards(withdrawals))
        assertEquals(listOf(Triple("a", "Centro", 2)), Rules.purchaseUnitCards(withdrawals.take(1) + withdrawals.first().copy(sourceId = "8".repeat(64))))
        assertEquals("o2" to "g2", Rules.purchaseScope(units, "c")); assertNull(Rules.purchaseScope(units, "z"))
        assertTrue(Rules.inPurchaseScope(units, "e", "o1", Rules.ALL_UNITS))
        assertEquals("o1" to "g3", Rules.restorePurchaseScope(units, "o1", "g3"))
        assertEquals("o1" to Rules.ALL_UNITS, Rules.restorePurchaseScope(units, "o1", "g2"))
        assertEquals(Rules.ALL_UNITS to Rules.ALL_UNITS, Rules.restorePurchaseScope(units, "gone", "g1"))
    }
}
