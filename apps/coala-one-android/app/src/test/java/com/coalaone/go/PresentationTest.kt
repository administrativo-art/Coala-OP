package com.coalaone.go

import com.coalaone.go.ui.profileInitials
import com.coalaone.go.ui.unitInitials
import com.coalaone.go.ui.personColor
import com.coalaone.go.ui.homeRoleSubtitle
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Test

class PresentationTest {
    @Test fun homeSubtitleUsesProfileRoleAndNeutralFallback() {
        assertEquals("Atendente", homeRoleSubtitle(" Atendente "))
        assertEquals("Gerente", homeRoleSubtitle("Gerente"))
        assertEquals("Equipe Coala", homeRoleSubtitle(null))
        assertEquals("Equipe Coala", homeRoleSubtitle("  "))
    }
    @Test fun avatarUsesLettersInsteadOfPunctuation() {
        assertEquals("AS", profileInitials("Ana (simulação)"))
        assertEquals("AM", profileInitials(" Ana   Maria "))
        assertEquals("CG", profileInitials("🐨 Coala Go"))
        assertEquals("H", profileInitials("  ! "))
    }
    @Test fun unitBadgeSkipsGenericWordsAndUsesTwoLetters() {
        assertEquals("TR", unitInitials("Unidade Tirirical"))
        assertEquals("TR", unitInitials("Tirirical"))
        assertEquals("JP", unitInitials("Quiosque João Paulo"))
        assertEquals("MT", unitInitials("Matriz"))
        assertEquals("CD", unitInitials("Centro de distribuição"))
        assertEquals("SM", unitInitials("Unidade de simulação"))
        assertEquals("UN", unitInitials("Unidade"))
        assertEquals("?", unitInitials("  ! "))
    }
    @Test fun registeredPersonColourIsParsedOnlyFromPlainHex() {
        assertEquals(Color(0xFFBDB2FF), personColor("#BDB2FF"))
        assertEquals(Color(0xFFBDB2FF), personColor(" #bdb2ff "))
        listOf(null, "", "red", "#fff", "#BDB2FF80").forEach { assertNull(personColor(it)) }
    }
}
