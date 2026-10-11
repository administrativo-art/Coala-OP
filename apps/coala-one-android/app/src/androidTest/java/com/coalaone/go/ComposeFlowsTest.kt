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
        compose.onNodeWithText("Mostrar").performClick()
        assertEquals("senha-local", renderedPassword())
        compose.onNodeWithText("Ocultar").performClick()
        assertNotEquals("senha-local", renderedPassword())
    }
    @Test fun simulatedStockCountCompletesAndCancellationRequiresConfirmation() {
        compose.onNodeWithText("Explorar simulação").performScrollTo().performClick()
        compose.onNodeWithText("Contagem de estoque").performScrollTo().performClick()
        compose.onNodeWithText("Contar Unidade de simulação").performScrollTo().performClick()
        compose.onNodeWithText("Saída (caixa)").performScrollTo().performTextInput("1")
        compose.onNodeWithText("Próxima etapa").performClick()
        compose.onNodeWithText("Concluir contagem").performClick()
        compose.onNodeWithText("Concluir a contagem e aplicar os ajustes?").assertIsDisplayed()
        compose.onNodeWithText("Concluir contagem").performClick()
        compose.onNodeWithText("Contagem concluída.").assertIsDisplayed()
        compose.onNodeWithText("Contar Unidade de simulação").performScrollTo().performClick()
        compose.onNodeWithText("Cancelar contagem").performClick()
        compose.onNodeWithText("Cancelar esta contagem? Os ajustes ainda não chegaram ao estoque.").assertIsDisplayed()
        compose.onNodeWithText("Cancelar contagem").performClick()
        compose.onNodeWithText("Contagem cancelada. O estoque não foi alterado.").assertIsDisplayed()
    }
    @Test fun receiptDivergenceIsBlockedThenExplainedAndConfirmed() {
        compose.onNodeWithText("Explorar simulação").performScrollTo().performClick()
        compose.onNodeWithText("Recebimento de reposição").performScrollTo().performClick()
        compose.onNodeWithText("Conferir recebimento").performScrollTo().performClick()
        compose.onAllNodesWithText("Recebido").onFirst().performScrollTo().performTextReplacement("0")
        compose.onNodeWithText("Confirmar recebimento").performClick()
        compose.onNodeWithText("Confirmar recebimento").performClick()
        compose.onNodeWithText("Explique a divergência no lote SIM-001.").assertExists()
        compose.onNodeWithText("Explique a divergência (obrigatório)").performScrollTo().performTextInput("Não chegou")
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
            compose.onNodeWithText("Registrar compra por sangria fora da lista").performScrollTo().performClick()
            compose.onNodeWithText("Escolher arquivo").performScrollTo().performClick()
            compose.waitUntil(10_000) { compose.onAllNodes(hasText("Nota 1:", substring = true)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Enviar documentos e revisar").performClick()
            compose.onNodeWithText("Total (R$)").performScrollTo().apply { performTextReplacement(""); performTextInput("12,50"); assertTextContains("12,50") }
            compose.onNodeWithText("2 · Pagamento e classificação").performScrollTo().performClick()
            compose.onNodeWithText("Insumos").performScrollTo().performClick()
            compose.onNode(hasText("3 · Itens", substring = true)).performScrollTo().performClick()
            compose.onNodeWithText("Descrição").assertExists()
            compose.onNodeWithText("Total do item (R$)").performScrollTo().apply { performTextReplacement(""); performTextInput("12,50"); assertTextContains("12,50") }
            compose.onNodeWithText("Confirmar compra").performClick()
            compose.onNodeWithText("Confirmar esta compra e os dados revisados?").assertIsDisplayed()
            compose.onNodeWithText("Confirmar compra").performClick()
            compose.onNodeWithText("Compra confirmada.").assertExists()
        } finally { Intents.release(); file.delete() }
    }
}
