package com.coalaone.go

import androidx.compose.ui.text.AnnotatedString
import com.coalaone.go.data.AbsenceOption
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.ui.TIME_INPUT_HINT
import com.coalaone.go.ui.TimeInputTransformation
import com.coalaone.go.ui.formattedTimeInput
import com.coalaone.go.ui.timeInputDigits
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TimeInputTest {
    @Test fun typingAndDeletingAcrossTheSeparator() {
        listOf("" to "", "1" to "1", "13" to "13", "135" to "13:5", "1350" to "13:50",
            "135" to "13:5", "13" to "13", "1" to "1", "" to "").forEach { (raw, expected) ->
            assertEquals(expected, formattedTimeInput(raw))
            assertEquals(expected, TimeInputTransformation.filter(AnnotatedString(raw)).text.text)
        }
    }

    @Test fun pastingAndEditingPreserveDigitsAndLeadingZero() {
        assertEquals("07:30", formattedTimeInput("07:30"))
        assertEquals("13:50", formattedTimeInput("1350"))
        assertEquals("13:50", formattedTimeInput("13:50"))
        assertEquals("13:50", formattedTimeInput("13:50abc999"))
        val digits = timeInputDigits("13:50")
        assertEquals("13:0", formattedTimeInput(digits.removeRange(2, 3)))
        assertEquals("12:50", formattedTimeInput(digits.replaceRange(1, 2, "2")))
    }

    @Test fun cursorOffsetsStayValidAndRoundTripAtEveryDigitBoundary() {
        listOf("", "1", "13", "135", "1350").forEach { raw ->
            val result = TimeInputTransformation.filter(AnnotatedString(raw))
            val mapping = result.offsetMapping
            (0..raw.length).forEach { offset ->
                val visual = mapping.originalToTransformed(offset)
                assertTrue(visual in 0..result.text.length)
                assertEquals(offset, mapping.transformedToOriginal(visual))
            }
            (0..result.text.length).forEach { visual ->
                assertTrue(mapping.transformedToOriginal(visual) in 0..raw.length)
            }
            if (raw.length > 2) {
                assertEquals(2, mapping.transformedToOriginal(2))
                assertEquals(2, mapping.transformedToOriginal(3))
            }
        }
    }

    @Test fun formattedInputReachesAdjustmentContractAndInvalidTimesRemainRejected() {
        val today = LocalDate.of(2026, 10, 27)
        val request = TimeRules.adjustmentRequest("attempt", today.toString(), "correct", "receipt",
            formattedTimeInput("1350"), "unit", "Horário informado incorretamente.", today)
        assertEquals("13:50", request.operations.single().newTime)
        listOf("2999", "2400", "2360", "135").forEach { raw ->
            assertThrows(IllegalArgumentException::class.java) {
                TimeRules.adjustmentRequest("attempt", today.toString(), "include", null,
                    formattedTimeInput(raw), "unit", "Esqueci de registrar o ponto.", today)
            }
        }
    }

    @Test fun hintTeachesTheLeadingZeroThatTheFieldDoesNotAddByItself() {
        assertEquals("Use 4 dígitos, com zero: 0840 = 08:40", TIME_INPUT_HINT)
        assertEquals("08:40", formattedTimeInput("0840"))
        // Sem o zero, os dois primeiros dígitos continuam sendo a hora: nada é completado automaticamente.
        assertEquals("84:0", formattedTimeInput("840"))
    }

    @Test fun absenceByHourReceivesTheSameFormattedTimes() {
        val type = AbsenceOption("type-1", "Consulta", listOf("day", "hour"))
        val period = TimeRules.absencePeriod(type, "hour", "2026-10-27", "2026-10-27", formattedTimeInput("0840"), formattedTimeInput("1130"))
        assertEquals("08:40", period.startTime)
        assertEquals("11:30", period.endTime)
        // Sem o zero continua recusado, como no ajuste: nada é completado em silêncio.
        assertThrows(IllegalArgumentException::class.java) {
            TimeRules.absencePeriod(type, "hour", "2026-10-27", "2026-10-27", formattedTimeInput("840"), formattedTimeInput("1130"))
        }
    }
}
