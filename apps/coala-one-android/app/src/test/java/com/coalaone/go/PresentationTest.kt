package com.coalaone.go

import com.coalaone.go.ui.profileInitials
import org.junit.Assert.assertEquals
import org.junit.Test

class PresentationTest {
    @Test fun avatarUsesLettersInsteadOfPunctuation() {
        assertEquals("AS", profileInitials("Ana (simulação)"))
        assertEquals("AM", profileInitials(" Ana   Maria "))
        assertEquals("CG", profileInitials("🐨 Coala Go"))
        assertEquals("H", profileInitials("  ! "))
    }
}
