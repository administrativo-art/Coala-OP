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
import kotlinx.coroutines.delay
import java.time.LocalTime

/**
 * Palette of the prototype with a dark counterpart. The dark header, the brand colours and the
 * "on dark" greys are the same in both themes; surfaces, text and status tints follow local civil time.
 */
object Tokens {
    var isDark by mutableStateOf(false)
    private fun pick(light: Long, dark: Long) = Color(if (isDark) dark else light)
    val dark = Color(0xFF15151C); val accent = Color(0xFFD13670); val pink = Color(0xFFF08BB1); val indigo = Color(0xFF5B5BD6)
    val onDark = Color(0xFFF3F2EE); val onDark2 = Color(0xFFC8C7D0); val onDark3 = Color(0xFFA9A8B3); val onDark4 = Color(0xFF8E8D99); val track = Color(0xFF34343F)
    val page get() = pick(0xFFF0EEE9, 0xFF0C0C10); val surface get() = pick(0xFFFFFFFF, 0xFF1C1C24); val raised get() = pick(0xFFFFFFFF, 0xFF34343F)
    val soft get() = pick(0xFFFAF9F6, 0xFF24242E); val greyBg get() = pick(0xFFECEAE5, 0xFF24242E); val segment get() = pick(0xFFE6E3DC, 0xFF1C1C24)
    val ink get() = pick(0xFF1A1B1F, 0xFFF3F2EE); val muted get() = pick(0xFF5F646C, 0xFFA9A8B3); val faint get() = pick(0xFF6E737A, 0xFF8E8D99)
    val border get() = pick(0xFFE3DFD6, 0xFF2E2E3A); val fieldBorder get() = pick(0xFFDCD9D1, 0xFF3F3F4D)
    val accentSoft get() = pick(0xFFFBE7EF, 0xFF3A1826); val wine get() = pick(0xFFA6325B, 0xFFF08BB1)
    val danger get() = pick(0xFFBE123C, 0xFFFF8FA3); val dangerBg get() = pick(0xFFFFE4E8, 0xFF3B1620); val problemBg get() = pick(0xFFFFF5F6, 0xFF2E161B)
    val ok get() = pick(0xFF147337, 0xFF7EE2A8); val okBg get() = pick(0xFFE8F5EE, 0xFF12301F); val okBorder get() = pick(0xFFBFE3CC, 0xFF1F5236); val okInk get() = pick(0xFF14532D, 0xFFB7F0CD)
    val warning get() = pick(0xFFC2410C, 0xFFFDBA74); val warningBg get() = pick(0xFFFFF1E6, 0xFF3A2413)
    val info get() = pick(0xFF1D4ED8, 0xFF93B4FF); val infoBg get() = pick(0xFFEEF3FE, 0xFF17223F)
    val amberBg get() = pick(0xFFFFF7E6, 0xFF33280F); val amberInk get() = pick(0xFF6B4500, 0xFFF5D9A3); val amberBorder get() = pick(0xFFF5D9A3, 0xFF5C4718)
    val changedBg get() = pick(0xFFFFF8FA, 0xFF2A1820)
    // Selected pill / selected day: dark on light, light on dark.
    val pillFill get() = pick(0xFF15151C, 0xFFF3F2EE); val pillInk get() = pick(0xFFFFFFFF, 0xFF15151C); val pillAccent get() = pick(0xFFF08BB1, 0xFFD13670)
}
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val InterfaceFont = FontFamily(listOf(400, 500, 600, 700, 800, 900).map { weight ->
    Font(R.font.inter_tight, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
})
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val CodeFont = FontFamily(Font(R.font.jetbrains_mono, variationSettings = FontVariation.Settings(FontVariation.weight(500))))
fun timeBasedDarkTheme(hour: Int) = hour !in 6..17

@Composable private fun rememberTimeBasedDarkTheme(): Boolean {
    var hour by remember { mutableIntStateOf(LocalTime.now().hour) }
    LaunchedEffect(Unit) {
        while (true) {
            val untilNextMinute = 60_000L - System.currentTimeMillis() % 60_000L
            delay(untilNextMinute)
            hour = LocalTime.now().hour
        }
    }
    return timeBasedDarkTheme(hour)
}

@Composable fun CoalaTheme(content: @Composable () -> Unit) {
    val night = rememberTimeBasedDarkTheme()
    if (Tokens.isDark != night) Tokens.isDark = night
    val scheme = if (night) darkColorScheme(primary = Tokens.accent, onPrimary = Color.White, secondary = Tokens.indigo, background = Tokens.page, onBackground = Tokens.ink, surface = Tokens.surface, onSurface = Tokens.ink, surfaceVariant = Tokens.soft, onSurfaceVariant = Tokens.muted, surfaceContainer = Tokens.surface, surfaceContainerHigh = Tokens.surface, surfaceContainerHighest = Tokens.soft, surfaceContainerLow = Tokens.surface, error = Tokens.danger, outline = Tokens.fieldBorder, outlineVariant = Tokens.border, secondaryContainer = Tokens.accentSoft, onSecondaryContainer = Tokens.ink)
        else lightColorScheme(primary = Tokens.accent, secondary = Tokens.indigo, background = Tokens.page, surface = Color.White, onSurface = Tokens.ink, error = Tokens.danger, outline = Tokens.fieldBorder)
    SystemMotion { MaterialTheme(colorScheme = scheme, typography = Typography(
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
@Composable fun Brand(compact: Boolean = false, small: Boolean = false) {
    val phase = motionPhase("brand gradient", 6000)
    val shine = motionPhase("slogan shine", 4500)
    val span = with(LocalDensity.current) { 180.dp.toPx() }
    val brush = Brush.linearGradient(listOf(Tokens.pink, Tokens.accent, Color(0xFF93B4FF), Tokens.pink), start = Offset(-phase * span, 0f), end = Offset((1 - phase) * span, 0f), tileMode = TileMode.Repeated)
    val sweep = when { shine < .35f -> 1f; shine < .75f -> 1 - (shine - .35f) / .4f; else -> 0f }
    val shineBrush = Brush.linearGradient(0f to Tokens.pink, .4f to Tokens.pink, .5f to Tokens.onDark, .6f to Tokens.pink, 1f to Tokens.pink, start = Offset((sweep - 1) * span * 2.5f, 0f), end = Offset(sweep * span * 2.5f, 0f))
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = if (small) Alignment.Start else Alignment.CenterHorizontally) {
        Text(buildAnnotatedString { withStyle(SpanStyle(color = Tokens.onDark)) { append("Coala ") }; withStyle(SpanStyle(brush = brush)) { append("Go") } }, style = MaterialTheme.typography.headlineLarge.copy(fontSize = if (small) 13.sp else if (compact) 20.sp else 40.sp, lineHeight = if (small) 18.sp else if (compact) 28.sp else 52.sp, textAlign = if (small) TextAlign.Start else TextAlign.Center), modifier = Modifier.padding(vertical = if (small) 0.dp else 4.dp))
        if (!compact) Text(buildAnnotatedString { withStyle(SpanStyle(brush = shineBrush, fontWeight = FontWeight.Bold)) { append("Acredite em você") }; withStyle(SpanStyle(color = Tokens.onDark2)) { append(", humano") } }, style = TextStyle(fontFamily = InterfaceFont, fontSize = 16.sp, lineHeight = 24.sp, textAlign = TextAlign.Center), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
    }
}
