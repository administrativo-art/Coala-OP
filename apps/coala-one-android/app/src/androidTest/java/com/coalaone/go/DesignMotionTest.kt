package com.coalaone.go

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coalaone.go.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DesignMotionTest {
    @get:Rule val compose = createComposeRule()

    private fun pixels(image: ImageBitmap): IntArray {
        val map = image.toPixelMap()
        return IntArray(image.width * image.height) { index ->
            map[index % image.width, index / image.width].toArgb()
        }
    }

    @Test fun brandAuroraAndIconsActuallyAnimate() {
        compose.mainClock.autoAdvance = false
        compose.setContent { CoalaTheme { CompositionLocalProvider(LocalMotionEnabled provides true) {
            Box(Modifier.size(320.dp, 500.dp).testTag("scene")) { Aurora {
                Column(Modifier.padding(24.dp)) { Brand(); ModuleIcon("purchase"); ModuleIcon("receive"); ModuleIcon("goals"); ModuleIcon("schedule") }
            } }
        } } }
        compose.mainClock.advanceTimeBy(32)
        val before = pixels(compose.onNodeWithTag("scene").captureToImage())
        compose.mainClock.advanceTimeBy(1500)
        val after = pixels(compose.onNodeWithTag("scene").captureToImage())
        assertFalse("Decorative animations must advance", before.contentEquals(after))
    }

    @Test fun reducedMotionHasNoDecorativeTickerAndShowsFinalProgress() {
        compose.mainClock.autoAdvance = false
        compose.setContent { CoalaTheme { CompositionLocalProvider(LocalMotionEnabled provides false) {
            Box(Modifier.size(320.dp, 500.dp).testTag("scene")) { Aurora {
                Column(Modifier.padding(24.dp)) { Brand(); ModuleIcon("count"); AnimatedProgress(.75f, Modifier.testTag("progress")); Text("Ações continuam disponíveis") }
            } }
        } } }
        compose.mainClock.advanceTimeBy(32)
        val before = pixels(compose.onNodeWithTag("scene").captureToImage())
        compose.mainClock.advanceTimeBy(6000)
        val after = pixels(compose.onNodeWithTag("scene").captureToImage())
        assertArrayEquals(before, after)
        compose.onNodeWithTag("progress").assertRangeInfoEquals(ProgressBarRangeInfo(.75f, 0f..1f))
        compose.onNodeWithText("Ações continuam disponíveis").assertIsDisplayed()
    }

    @Test fun brandingWrapsAtLargeFontScaleInsteadOfClipping() {
        compose.setContent { CoalaTheme {
            CompositionLocalProvider(LocalMotionEnabled provides false, LocalDensity provides Density(1f, 1.6f)) {
                Column(Modifier.width(280.dp).padding(24.dp)) { Brand() }
            }
        } }
        for (text in listOf("Coala Go", "Acredite em você, humano")) {
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(text).assertIsDisplayed().performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertFalse(layouts.single().didOverflowWidth)
            assertFalse(layouts.single().didOverflowHeight)
        }
    }

    @Test fun todaySummaryRequiresADownwardAndUpwardDrag() {
        compose.setContent { CoalaTheme {
            CompositionLocalProvider(LocalMotionEnabled provides false) {
                Column(Modifier.fillMaxWidth()) {
                    TodayHeader(HomeToday(loaded = true, hasSchedule = true, shift = "08:00–16:00", shiftUnit = "Unidade de simulação"), 0) {}
                }
            }
        } }

        val closedHandle = compose.onNodeWithContentDescription("Deslize para baixo para abrir o resumo de hoje")
        closedHandle.assert(SemanticsMatcher.keyNotDefined(SemanticsActions.OnClick))
        closedHandle.performTouchInput { click() }
        compose.onNodeWithText("Seu turno").assertDoesNotExist()

        closedHandle.performTouchInput { swipeDown() }
        compose.onNodeWithText("Seu turno").assertIsDisplayed()

        val openHandle = compose.onNodeWithContentDescription("Deslize para cima para fechar o resumo de hoje")
        openHandle.assert(SemanticsMatcher.keyNotDefined(SemanticsActions.OnClick))
        openHandle.performTouchInput { swipeUp() }
        compose.onNodeWithText("Seu turno").assertDoesNotExist()
    }
}
