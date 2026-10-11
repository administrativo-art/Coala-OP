package com.coalaone.go

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.matcher.IntentMatchers
import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

@RunWith(AndroidJUnit4::class)
class ComposeFlowsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun brandingAndSloganUseRealTextWithoutClipping() {
        for (text in listOf("Coala Go", "Acredite em você, humano")) {
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(text).assertIsDisplayed().performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            assertTrue(layouts.isNotEmpty()); assertFalse(layouts.first().didOverflowWidth); assertFalse(layouts.first().didOverflowHeight)
        }
        compose.onNodeWithText("Senha").performTextInput("senha-local")
        fun renderedPassword(): String {
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText("Senha").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            return layouts.first().layoutInput.text.text
        }
        assertNotEquals("senha-local", renderedPassword())
        compose.onNodeWithContentDescription("Mostrar senha").performClick()
        assertEquals("senha-local", renderedPassword())
        compose.onNodeWithContentDescription("Ocultar senha").performClick()
        assertNotEquals("senha-local", renderedPassword())
    }
    @Test fun simulatedStockCountCompletesAndCancellationRequiresConfirmation() {
        compose.onNodeWithText("Explorar simulação").performScrollTo().performClick()
        compose.onNodeWithText("Contagem de estoque").performScrollTo().performClick()
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        compose.onAllNodesWithContentDescription("Saída do turno").onFirst().performScrollTo().performTextInput("1")
        compose.onNodeWithText("Próximo").performClick()
        compose.onNodeWithText("Concluir contagem").performClick()
        compose.onNode(hasText("Concluir a contagem de", substring = true)).assertIsDisplayed()
        compose.onNodeWithText("Concluir").performClick()
        compose.onNodeWithText("Contagem concluída.").assertIsDisplayed()
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        compose.onNodeWithText("Cancelar contagem").performClick()
        compose.onNodeWithText("Cancelar esta contagem? Os ajustes ainda não chegaram ao estoque.").assertIsDisplayed()
        compose.onNodeWithText("Cancelar contagem").performClick()
        compose.onNodeWithText("Contagem cancelada. O estoque não foi alterado.").assertIsDisplayed()
    }
    @Test fun receiptDivergenceIsBlockedThenExplainedAndConfirmed() {
        compose.onNodeWithText("Explorar simulação").performScrollTo().performClick()
        compose.onNodeWithText("Recebimento").performScrollTo().performClick()
        compose.onNodeWithText("Unidade de simulação").performScrollTo().performClick()
        compose.onAllNodesWithContentDescription("Recebido").onFirst().performScrollTo().performTextReplacement("0")
        compose.onNodeWithText("Confirmar recebimento").performClick()
        compose.onNodeWithText("Confirmar recebimento").performClick()
        compose.onNodeWithText("Explique a divergência no lote SIM-001.").assertExists()
        compose.onNodeWithContentDescription("Explique a divergência (obrigatório)").performScrollTo().performTextInput("Não chegou")
        compose.onNodeWithText("Confirmar recebimento").performClick()
        compose.onNodeWithText("Confirmar recebimento").performClick()
        compose.onNodeWithText("Recebimento registrado. A entrada de estoque será efetivada no Coala One.").assertExists()
    }
    @Test fun simulatedPurchaseSelectsDocumentReviewsDataAndConfirms() {
        val file = File(compose.activity.cacheDir, "capture/instrumented-note.jpg").apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 1)) }
        val uri = FileProvider.getUriForFile(compose.activity, "${compose.activity.packageName}.files", file)
        Intents.init()
        try {
            Intents.intending(IntentMatchers.hasAction(Intent.ACTION_OPEN_DOCUMENT)).respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().setData(uri)))
            compose.onNodeWithText("Explorar simulação").performScrollTo().performClick()
            compose.onNodeWithText("Compra local").performScrollTo().performClick()
            compose.onNodeWithText("Dinheiro do caixa").performScrollTo().performClick()
            compose.onNodeWithText("Arquivo").performScrollTo().performClick()
            compose.waitUntil(10_000) { compose.onAllNodes(hasText("1 DE 2")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Analisar e continuar").performClick()
            compose.onNodeWithText("Total (R$)").performScrollTo().apply { performTextReplacement(""); performTextInput("12,50"); assertTextContains("12,50") }
            compose.onNodeWithText("Pagamento").performScrollTo().performClick()
            compose.onNodeWithText("Insumos").performScrollTo().performClick()
            compose.onNodeWithText("Itens").performScrollTo().performClick()
            compose.onNodeWithText("Descrição").assertExists()
            compose.onNodeWithText("Total do item (R$)").performScrollTo().apply { performTextReplacement(""); performTextInput("12,50"); assertTextContains("12,50") }
            compose.onNodeWithText("Confirmar compra").performClick()
            compose.onNodeWithText("Confirmar esta compra e os dados revisados?").assertIsDisplayed()
            compose.onNodeWithText("Confirmar compra").performClick()
            compose.onNodeWithText("Compra confirmada.").assertExists()
        } finally { Intents.release(); file.delete() }
    }
}
