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
        compose.onNodeWithText("Compra local").assertExists()
        snapshot("home")
        compose.runOnIdle { assertTrue(WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).isAppearanceLightStatusBars) }
        compose.onNodeWithText("Metas").performScrollTo().performClick()
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        compose.onNodeWithText("Resultados").performScrollTo().assertExists()
        compose.onNodeWithText("Equipe", useUnmergedTree = true).performScrollTo().performClick()
        compose.onNodeWithText("Resultado da equipe").assertExists()
        compose.onNodeWithText("Prêmio", useUnmergedTree = true).performScrollTo().performClick()
        snapshot("goals")
        compose.onNodeWithText("← Voltar").performClick()
        compose.onNodeWithText("Escala").performScrollTo().performClick()
        compose.onNodeWithText("Só minha").performScrollTo().performClick()
        snapshot("schedule")
        compose.onNodeWithText("← Voltar").performClick()
        compose.onNodeWithText("Compra local").performScrollTo().performClick()
        snapshot("purchase")
        compose.onNodeWithText("← Voltar").performClick()
        compose.onNodeWithText("Contagem de estoque").performScrollTo().performClick()
        compose.onNodeWithText("Contar Unidade de simulação").performScrollTo().performClick()
        snapshot("count")
        compose.onNodeWithText("Salvar e sair").performClick()
        compose.onNodeWithText("Recebimento de reposição").performScrollTo().performClick()
        compose.onNodeWithText("Conferir recebimento").performScrollTo().performClick()
        snapshot("receipt")
    }
}
