package com.coalaone.go.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

/** Guide under every time field: the hour always takes two digits, so 08:40 is typed 0840 (no automatic zero). */
internal const val TIME_INPUT_HINT = "Use 4 dígitos, com zero: 0840 = 08:40"

/** Keep only editable digits; the colon is visual so backspace cannot get stuck on it. */
internal fun timeInputDigits(value: String): String = value.filter { it in '0'..'9' }.take(4)

internal fun formattedTimeInput(value: String): String = timeInputDigits(value).let {
    if (it.length > 2) it.take(2) + ":" + it.drop(2) else it
}

internal object TimeInputTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val length = text.length
        val hasColon = length > 2
        return TransformedText(AnnotatedString(formattedTimeInput(text.text)), object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int =
                offset + if (hasColon && offset > 2) 1 else 0

            override fun transformedToOriginal(offset: Int): Int =
                (offset - if (hasColon && offset > 2) 1 else 0).coerceIn(0, length)
        })
    }
}

@Composable internal fun LabeledTimeInput(
    label: String,
    value: String,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    /** Campos lado a lado mostram um guia só, abaixo da linha (`TimeInputHint`), para não quebrar em tela estreita. */
    showHint: Boolean = true,
    onChange: (String) -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        LabeledInput(label, timeInputDigits(value), enabled, placeholder = "00:00",
            keyboardType = KeyboardType.Number, visualTransformation = TimeInputTransformation) {
            onChange(formattedTimeInput(it))
        }
        if (showHint) TimeInputHint()
    }
}

@Composable internal fun TimeInputHint() { Text(TIME_INPUT_HINT, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
