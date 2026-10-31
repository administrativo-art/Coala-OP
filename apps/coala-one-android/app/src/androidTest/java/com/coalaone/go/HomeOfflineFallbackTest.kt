package com.coalaone.go

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coalaone.go.data.Modules
import com.coalaone.go.data.OwnShift
import com.coalaone.go.data.Profile
import com.coalaone.go.data.ProfileResponse
import com.coalaone.go.ui.CoalaTheme
import com.coalaone.go.ui.HomeProfile
import com.coalaone.go.ui.HomeToday
import com.coalaone.go.ui.modulesForHome
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HomeOfflineFallbackTest {
    @get:Rule val compose = createComposeRule()

    @Test fun failedProfileRendersPointButNoOtherModule() {
        val profile = HomeProfile("owner", ProfileResponse(Profile("Ana"), Modules(
            localPurchase = true, stockCount = true, schedule = true, timeRecording = true, requests = true,
        )), unavailable = true)
        compose.setContent { CoalaTheme { Column {
            HomeModuleContent(profile.modulesForHome("owner", viewingAnotherUser = false),
                HomeToday(contextKey = "owner", loaded = true, timeMarkingsAvailable = false,
                    timeWorkDate = "2026-10-27", timeShift = OwnShift("2026-10-27", "work", "09:00", "18:00")), 0) {}
        } } }

        compose.onNodeWithText("Ponto").assertExists()
        compose.onNodeWithText("Compra local").assertDoesNotExist()
        compose.onNodeWithText("Contagem de estoque").assertDoesNotExist()
        compose.onNodeWithText("Escala").assertDoesNotExist()
        compose.onNodeWithText("Solicitações").assertDoesNotExist()
        compose.onNodeWithText("Batidas indisponíveis sem conexão").assertExists()
        compose.onNodeWithText("Nenhuma batida hoje").assertDoesNotExist()
        compose.onNodeWithText("Próxima").assertDoesNotExist()
    }

    @Test fun failedViewAsProfileRendersNoPointFallback() {
        val profile = HomeProfile("target", ProfileResponse(Profile("Pessoa visualizada"),
            Modules(timeRecording = true)), unavailable = true)
        compose.setContent { CoalaTheme { Column {
            HomeModuleContent(profile.modulesForHome("target", viewingAnotherUser = true),
                HomeToday(contextKey = "target", loaded = true), 0) {}
        } } }

        compose.onNodeWithText("Ponto").assertDoesNotExist()
    }

    @Test fun viewAsPointSummaryHasNoRecordAction() {
        compose.setContent { CoalaTheme { Column {
            HomeModuleContent(Modules(timeRecording = true), HomeToday(contextKey = "target", loaded = true),
                0, {}, readOnly = true) {}
        } } }

        compose.onNodeWithText("Ponto").assertExists()
        compose.onNodeWithText("Registrar ponto").assertDoesNotExist()
    }
}
