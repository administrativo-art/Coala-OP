package com.coalaone.go.ui

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.progressSemantics
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlin.math.sin

val LocalMotionEnabled = staticCompositionLocalOf { true }

@Composable internal fun SystemMotion(content: @Composable () -> Unit) {
    val resolver = LocalContext.current.contentResolver
    fun enabled() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    var motion by remember(resolver) { mutableStateOf(enabled()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { motion = enabled() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    CompositionLocalProvider(LocalMotionEnabled provides motion, content = content)
}

/** No ticker is created when Android or a test requests reduced motion. */
@Composable internal fun motionPhase(label: String, duration: Int, reverse: Boolean = false): Float {
    if (!LocalMotionEnabled.current) return 0.5f
    val transition = rememberInfiniteTransition(label = label)
    val phase by transition.animateFloat(0f, 1f,
        infiniteRepeatable(tween(duration, easing = if (reverse) FastOutSlowInEasing else LinearEasing),
            if (reverse) RepeatMode.Reverse else RepeatMode.Restart), label = label)
    return phase
}

@Composable fun Aurora(content: @Composable BoxScope.() -> Unit) {
    val a = motionPhase("aurora rose", 14000, true)
    val b = motionPhase("aurora indigo", 17000, true)
    val c = motionPhase("aurora pink", 12000, true)
    val d = motionPhase("aurora lower", 19000, true)
    Box(Modifier.fillMaxSize().background(Tokens.dark)) {
        Canvas(Modifier.matchParentSize()) {
            fun glow(color: Color, x: Float, y: Float, radius: Float, opacity: Float) {
                val center = Offset(x, y)
                drawCircle(Brush.radialGradient(listOf(color.copy(alpha = opacity), color.copy(alpha = opacity * .35f), Color.Transparent), center, radius), radius, center)
            }
            // Radial gradients provide a soft edge on API 26, without RenderEffect/API 31.
            glow(Tokens.accent, size.width - 40.dp.toPx() + a * 60.dp.toPx(), 45.dp.toPx() + a * 30.dp.toPx(), (160 + a * 35).dp.toPx(), .38f)
            glow(Tokens.indigo, -30.dp.toPx() - b * 30.dp.toPx(), 280.dp.toPx() + b * 20.dp.toPx(), (155 - b * 15).dp.toPx(), .32f)
            glow(Tokens.pink, size.width + c * 30.dp.toPx(), size.height - 180.dp.toPx() - c * 25.dp.toPx(), 145.dp.toPx(), .22f)
            glow(Tokens.indigo, 80.dp.toPx() + (1 - d) * 60.dp.toPx(), size.height + 10.dp.toPx(), 150.dp.toPx(), .25f)
        }
        content()
    }
}

@Composable fun AnimatedProgress(value: Float, modifier: Modifier = Modifier, duration: Int = 1200, height: Int = 8, track: Color = Tokens.border, fill: Brush = Brush.horizontalGradient(listOf(Tokens.accent, Tokens.indigo))) {
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    val progress by animateFloatAsState(if (entered || !LocalMotionEnabled.current) value.coerceIn(0f, 1f) else 0f,
        if (LocalMotionEnabled.current) tween(duration, easing = CubicBezierEasing(.2f, .8f, .2f, 1f)) else snap(), label = "progress")
    Canvas(modifier.fillMaxWidth().height(height.dp).progressSemantics(progress)) {
        drawRoundRect(track, cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height))
        if (progress > 0) drawRoundRect(fill, size = Size(size.width * progress, size.height), cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height))
    }
}

/** Code-native illustrations: no bitmap, network request or animation dependency. */
@Composable fun ModuleIcon(kind: String, modifier: Modifier = Modifier) {
    val duration = when (kind) { "purchase", "biometric" -> 2400; "receive" -> 3600; "schedule" -> 3000; "goals" -> 2400; else -> 2600 }
    val phase = motionPhase("module $kind", duration)
    val receiptBob = if (kind == "purchase") motionPhase("receipt bob", 3200) else 0f
    val animated = LocalMotionEnabled.current
    Canvas(modifier.size(44.dp)) {
        val unit = size.minDimension / 44f
        withTransform({ scale(unit, unit, Offset.Zero) }) {
            val stroke = Stroke(2f, cap = StrokeCap.Round, join = StrokeJoin.Round)
            fun line(x: Float, y: Float, x2: Float, y2: Float, color: Color = Tokens.accent) = drawLine(color, Offset(x, y), Offset(x2, y2), 2f, StrokeCap.Round)
            when (kind) {
                "purchase" -> {
                    val bob = if (animated) (1 - kotlin.math.cos(receiptBob * Math.PI.toFloat() * 2)) * -2 else 0f
                    withTransform({ translate(0f, bob) }) {
                        drawRoundRect(Color.White, Offset(11f, 5f), Size(23f, 33f), androidx.compose.ui.geometry.CornerRadius(3f))
                        drawRoundRect(Tokens.accent, Offset(11f, 5f), Size(23f, 33f), androidx.compose.ui.geometry.CornerRadius(3f), style = stroke)
                        line(17f, 13f, 27f, 13f); line(17f, 20f, 27f, 20f); line(17f, 27f, 23f, 27f)
                        val scan = if (animated) 10 + (1 - kotlin.math.cos(phase * Math.PI.toFloat() * 2)) * 11 else 22f
                        line(6f, scan, 38f, scan, Tokens.pink)
                        val rise = if (!animated) 0f else when { phase < .2f -> 8 * (1 - phase / .2f); phase < .8f -> 0f; else -> -6 * (phase - .8f) / .2f }
                        val alpha = if (!animated) 1f else when { phase < .2f -> phase / .2f; phase < .8f -> 1f; else -> (1 - phase) / .2f }
                        withTransform({ translate(0f, rise) }) {
                            drawCircle(Tokens.okBg.copy(alpha = alpha), 7f, Offset(33f, 34f)); line(29f, 34f, 32f, 37f, Tokens.ok.copy(alpha = alpha)); line(32f, 37f, 37f, 31f, Tokens.ok.copy(alpha = alpha))
                        }
                    }
                }
                "receive" -> {
                    val drive = if (animated) when { phase < .45f -> -12 + phase / .45f * 12; phase < .55f -> 0f; else -> (phase - .55f) / .45f * 14 } else 0f
                    withTransform({ translate(drive, 0f) }) {
                        drawRoundRect(Tokens.accentSoft, Offset(4f, 12f), Size(23f, 19f), androidx.compose.ui.geometry.CornerRadius(2f), style = Fill)
                        drawRect(Tokens.accent, Offset(4f, 12f), Size(23f, 19f), style = stroke)
                        drawPath(Path().apply { moveTo(27f, 18f); lineTo(34f, 18f); lineTo(40f, 26f); lineTo(40f, 31f); lineTo(27f, 31f); close() }, Tokens.accent, style = stroke)
                        drawCircle(Tokens.dark, 4f, Offset(12f, 33f)); drawCircle(Tokens.dark, 4f, Offset(33f, 33f))
                    }
                }
                "goals" -> repeat(3) { i ->
                    val growth = if (animated) .55f + .45f * (1 - kotlin.math.cos((phase - i * .08f) * 2 * Math.PI).toFloat()) / 2 else 1f
                    val h = (12 + i * 8) * growth
                    drawRoundRect(listOf(Tokens.pink, Tokens.accent, Tokens.indigo)[i], Offset(8f + i * 10, 36 - h), Size(6f, h), androidx.compose.ui.geometry.CornerRadius(2f))
                }
                "schedule" -> {
                    drawRoundRect(Tokens.indigo, Offset(6f, 9f), Size(32f, 29f), androidx.compose.ui.geometry.CornerRadius(4f), style = stroke)
                    line(6f, 17f, 38f, 17f, Tokens.indigo); line(14f, 5f, 14f, 12f, Tokens.indigo); line(30f, 5f, 30f, 12f, Tokens.indigo)
                    val x = if (!animated || phase < .33f) 28f else 21f
                    val y = if (animated && phase >= .66f) 24f else 29f
                    drawCircle(Tokens.accent, 3f, Offset(x, y))
                }
                "signage" -> {
                    drawRoundRect(Tokens.indigo, Offset(4f, 7f), Size(36f, 25f), androidx.compose.ui.geometry.CornerRadius(3f), style = stroke)
                    line(22f, 32f, 22f, 38f, Tokens.indigo); line(14f, 38f, 30f, 38f, Tokens.indigo)
                }
                "biometric" -> {
                    val pulse = if (animated) 1f + .15f * sin(phase * 2 * Math.PI.toFloat()) else 1f
                    if (animated) drawCircle(Tokens.pink.copy(alpha = .5f * (1 - phase)), 20f * (1 + .5f * phase), Offset(22f, 22f), style = Stroke(1f))
                    withTransform({ scale(pulse, pulse, Offset(22f, 22f)) }) {
                        for (i in 0..3) drawArc(Tokens.pink.copy(alpha = 1 - i * .12f), 190f, 300f, false, Offset(8f + i * 3, 7f + i * 3), Size(28f - i * 6, 32f - i * 6), style = stroke)
                        line(22f, 20f, 22f, 36f, Tokens.pink)
                    }
                }
                else -> {
                    val bob = if (animated) sin(phase * 2 * Math.PI.toFloat()) * -3 else 0f
                    withTransform({ translate(0f, bob) }) {
                        drawPath(Path().apply { moveTo(8f, 14f); lineTo(22f, 7f); lineTo(36f, 14f); lineTo(36f, 31f); lineTo(22f, 38f); lineTo(8f, 31f); close() }, Tokens.indigo, style = stroke)
                        line(8f, 14f, 22f, 21f, Tokens.indigo); line(22f, 21f, 36f, 14f, Tokens.indigo); line(22f, 21f, 22f, 38f, Tokens.indigo)
                    }
                }
            }
        }
    }
}
