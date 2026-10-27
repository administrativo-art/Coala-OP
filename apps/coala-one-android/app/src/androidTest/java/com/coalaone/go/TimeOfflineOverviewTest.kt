package com.coalaone.go

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coalaone.go.ui.*
import com.coalaone.go.domain.DayPunch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TimeOfflineOverviewTest {
    @get:Rule val compose = createComposeRule()
    @Test fun unavailableDataNeverBecomesNoShiftOrNoPunch() {
        compose.setContent { CoalaTheme { TimeDayOverview(TimeState(), null,
            listOf(DayPunch("08:01", 1, "old-receipt", "available")), true) {} } }
        compose.onNodeWithText("Escala indisponível. Conecte para consultar.").assertExists()
        compose.onNodeWithText("Batidas não consultadas. Os registros já feitos continuam no servidor.").assertExists()
        compose.onNodeWithText("Sem turno na escala de hoje").assertDoesNotExist()
        compose.onNodeWithText("Nenhuma batida hoje.").assertDoesNotExist()
        compose.onNodeWithText("08:01").assertDoesNotExist()
    }
}
