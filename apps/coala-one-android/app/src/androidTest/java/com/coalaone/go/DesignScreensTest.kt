package com.coalaone.go

import android.graphics.Bitmap
import android.view.WindowManager
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.core.view.WindowCompat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real native screens with simulation data only. Screenshots stay on the emulator. */
@RunWith(AndroidJUnit4::class)
class DesignScreensTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun snapshot(name: String) {
        compose.waitForIdle()
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val directory = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ?.let(::File) ?: compose.activity.getExternalFilesDir(null)!!
        directory.mkdirs()
        File(directory, "design-$name.png").outputStream().use {
            image.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun captureNativeScreensAndExerciseGoalTabsAndScheduleDays() {
        // Test-only window: the production activity retains FLAG_SECURE unchanged.
        compose.activityRule.scenario.onActivity { it.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
        snapshot("login")
        val login = compose.onNodeWithText("Entrar no Coala Go").assertIsNotEnabled().captureToImage()
        assertTrue("Disabled CTA must remain visible on the dark surface", login.toPixelMap()[login.width / 2, login.height / 4].red > .2f)
        compose.runOnIdle { assertFalse(WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).isAppearanceLightStatusBars) }
        compose.onNodeWithText("Explorar simulação").performScrollTo().performClick()
        compose.onNodeWithText("Heucilene Ribeiro", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Compra local").assertExists()
        snapshot("home")
        compose.runOnIdle { assertFalse(WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).isAppearanceLightStatusBars) }
        compose.onNodeWithText("Metas").performScrollTo().performClick()
        // Goals open straight on a unit; the header shows it with "Trocar unidade".
        compose.onNodeWithText("Trocar unidade").assertExists()
        compose.onNodeWithText("MINHA PARTE").assertExists()
        compose.onNodeWithText("HOJE NA UNIDADE").assertExists()
        snapshot("goals-days")
        compose.onNodeWithText("Resultado da unidade por dia").performScrollTo().assertExists()
        compose.onNodeWithText("Equipe", useUnmergedTree = true).performScrollTo().performClick()
        compose.onNodeWithText("Resultado da equipe").assertExists()
        compose.onNodeWithText("Prêmio", useUnmergedTree = true).performScrollTo().performClick()
        snapshot("goals")
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.onNodeWithText("Escala").performScrollTo().performClick()
        compose.onNodeWithText("Heucilene Ribeiro", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Só a minha").performScrollTo().performClick()
        snapshot("schedule")
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.onNodeWithText("Compra local").performScrollTo().performClick()
        snapshot("purchase")
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.onNodeWithText("Contagem de estoque").performScrollTo().performClick()
        compose.onNodeWithText("Unidade de simulação").assertExists()
        snapshot("count-units")
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        snapshot("count")
        compose.onNodeWithText("Salvar e sair").performClick()
        compose.onNodeWithText("Recebimento").performScrollTo().performClick()
        compose.onNodeWithText("Unidade de simulação").assertExists()
        snapshot("receipt-list")
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        snapshot("receipt")
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.onNodeWithContentDescription("Voltar").performClick()
        // Signage: unit -> panel of the unit -> four-step walkthrough -> connected.
        compose.onNodeWithText("Signage").performScrollTo().performClick()
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        snapshot("signage-unit")
        compose.onNodeWithText("Adicionar tela").performClick()
        compose.onNodeWithText("Abra o URL Launcher do monitor").assertIsDisplayed()
        snapshot("signage-step1")
        compose.onNodeWithText("Próximo").performClick()
        compose.onNodeWithText("Próximo").performClick()
        compose.onNodeWithText("Próximo").performClick()
        compose.onNodeWithContentDescription("Ou digite o código que aparece abaixo do QR").performTextInput("COALA-SIGNAGE:ABCD2345")
        snapshot("signage-step4")
        compose.onNodeWithText("Confirmar conexão").assertIsEnabled().performClick()
        compose.onNodeWithText("Tela 2 conectada em Unidade de simulação.").assertIsDisplayed()
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.onNodeWithContentDescription("Abrir perfil: foto, versão e sair").performClick()
        compose.onNodeWithText("Heucilene Ribeiro").assertIsDisplayed()
        compose.onNodeWithText("Sair da conta").performScrollTo().assertExists()
        snapshot("profile")
    }
}
