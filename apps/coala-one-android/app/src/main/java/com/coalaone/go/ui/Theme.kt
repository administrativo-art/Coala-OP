package com.coalaone.go.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalDensity
import com.coalaone.go.R
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Tokens {
    val page = Color(0xFFF0EEE9); val dark = Color(0xFF15151C); val ink = Color(0xFF1A1B1F)
    val muted = Color(0xFF5F646C); val border = Color(0xFFE3DFD6); val fieldBorder = Color(0xFFDCD9D1)
    val accent = Color(0xFFD13670); val pink = Color(0xFFF08BB1); val indigo = Color(0xFF5B5BD6)
    val soft = Color(0xFFFAF9F6); val accentSoft = Color(0xFFFBE7EF); val onDark = Color(0xFFF3F2EE)
    val onDark2 = Color(0xFFC8C7D0); val danger = Color(0xFFBE123C); val dangerBg = Color(0xFFFFE4E8)
    val ok = Color(0xFF147337); val okBg = Color(0xFFE8F5EE); val warning = Color(0xFFC2410C)
    // Prototype palette: wine for text links, quieter greys on dark, status tints.
    val wine = Color(0xFFA6325B); val onDark3 = Color(0xFFA9A8B3); val onDark4 = Color(0xFF8E8D99)
    val warningBg = Color(0xFFFFF1E6); val info = Color(0xFF1D4ED8); val infoBg = Color(0xFFEEF3FE)
    val okBorder = Color(0xFFBFE3CC); val okInk = Color(0xFF14532D); val amberBg = Color(0xFFFFF7E6); val amberInk = Color(0xFF6B4500); val amberBorder = Color(0xFFF5D9A3)
    val track = Color(0xFF34343F); val greyBg = Color(0xFFECEAE5); val segment = Color(0xFFE6E3DC); val faint = Color(0xFF6E737A); val changedBg = Color(0xFFFFF8FA); val problemBg = Color(0xFFFFF5F6)
}
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val InterfaceFont = FontFamily(listOf(400, 500, 600, 700, 800, 900).map { weight ->
    Font(R.font.inter_tight, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
})
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val CodeFont = FontFamily(Font(R.font.jetbrains_mono, variationSettings = FontVariation.Settings(FontVariation.weight(500))))
@Composable fun CoalaTheme(content: @Composable () -> Unit) {
    SystemMotion { MaterialTheme(colorScheme = lightColorScheme(primary = Tokens.accent, secondary = Tokens.indigo, background = Tokens.page, surface = Color.White, onSurface = Tokens.ink, error = Tokens.danger, outline = Tokens.fieldBorder), typography = Typography(
        headlineLarge = TextStyle(fontFamily = InterfaceFont, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, lineHeight = 36.sp),
        titleLarge = TextStyle(fontFamily = InterfaceFont, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, lineHeight = 28.sp),
        titleMedium = TextStyle(fontFamily = InterfaceFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, lineHeight = 21.sp),
        bodyLarge = TextStyle(fontFamily = InterfaceFont, fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = TextStyle(fontFamily = InterfaceFont, fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontFamily = InterfaceFont, fontSize = 12.sp, lineHeight = 17.sp),
        labelSmall = TextStyle(fontFamily = InterfaceFont, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp),
        labelLarge = TextStyle(fontFamily = InterfaceFont, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
    ), content = content) }
}
@Composable fun Brand(compact: Boolean = false) {
    val phase = motionPhase("brand gradient", 6000)
    val shine = motionPhase("slogan shine", 4500)
    val span = with(LocalDensity.current) { 180.dp.toPx() }
    val brush = Brush.linearGradient(listOf(Tokens.pink, Tokens.accent, Color(0xFF93B4FF), Tokens.pink), start = Offset(-phase * span, 0f), end = Offset((1 - phase) * span, 0f), tileMode = TileMode.Repeated)
    val sweep = when { shine < .35f -> 1f; shine < .75f -> 1 - (shine - .35f) / .4f; else -> 0f }
    val shineBrush = Brush.linearGradient(0f to Tokens.pink, .4f to Tokens.pink, .5f to Tokens.onDark, .6f to Tokens.pink, 1f to Tokens.pink, start = Offset((sweep - 1) * span * 2.5f, 0f), end = Offset(sweep * span * 2.5f, 0f))
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(buildAnnotatedString { withStyle(SpanStyle(color = Tokens.onDark)) { append("Coala ") }; withStyle(SpanStyle(brush = brush)) { append("Go") } }, style = MaterialTheme.typography.headlineLarge.copy(fontSize = if (compact) 20.sp else 40.sp, lineHeight = if (compact) 28.sp else 52.sp, textAlign = TextAlign.Center), modifier = Modifier.padding(vertical = 4.dp))
        if (!compact) Text(buildAnnotatedString { withStyle(SpanStyle(brush = shineBrush, fontWeight = FontWeight.Bold)) { append("Acredite em você") }; withStyle(SpanStyle(color = Tokens.onDark2)) { append(", humano") } }, style = TextStyle(fontFamily = InterfaceFont, fontSize = 16.sp, lineHeight = 24.sp, textAlign = TextAlign.Center), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
    }
}
