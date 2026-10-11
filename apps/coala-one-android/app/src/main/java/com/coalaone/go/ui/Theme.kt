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
}
@Composable fun CoalaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Tokens.accent, secondary = Tokens.indigo, background = Tokens.page, surface = Color.White, onSurface = Tokens.ink, error = Tokens.danger, outline = Tokens.fieldBorder), typography = Typography(
        headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp),
        titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp),
        titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 15.sp),
        bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 17.sp),
        labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 14.sp)
    ), content = content)
}
@Composable fun Brand() {
    val cycle = rememberInfiniteTransition(label = "brand")
    val phase by cycle.animateFloat(0f, 1f, infiniteRepeatable(tween(6000, easing = LinearEasing)), label = "gradient")
    val brush = Brush.linearGradient(listOf(Tokens.pink, Tokens.accent, Color(0xFF93B4FF), Tokens.pink), start = Offset(-phase * 180, 0f), end = Offset((1 - phase) * 180, 0f), tileMode = TileMode.Repeated)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(buildAnnotatedString { withStyle(SpanStyle(color = Tokens.onDark)) { append("Coala ") }; withStyle(SpanStyle(brush = brush)) { append("Go") } }, style = MaterialTheme.typography.headlineLarge.copy(fontSize = 42.sp, lineHeight = 55.sp), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
        Text(buildAnnotatedString { withStyle(SpanStyle(brush = brush, fontWeight = FontWeight.Bold)) { append("Acredite em você") }; withStyle(SpanStyle(color = Tokens.onDark2)) { append(", humano") } }, style = TextStyle(brush = brush, fontSize = 17.sp, lineHeight = 24.sp), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
    }
}
