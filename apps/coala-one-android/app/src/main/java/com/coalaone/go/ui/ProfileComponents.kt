package com.coalaone.go.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Icons of the profile lists, drawn like the rest of the app (no icon library). */
enum class ProfileIcon { Shield, Bell, Phone, Person, Camera, Gallery, Settings }

private fun DrawScope.drawProfileIcon(icon: ProfileIcon, tint: Color) {
    val stroke = Stroke(1.9.dp.toPx(), cap = StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round)
    val w = size.width; val h = size.height
    when (icon) {
        ProfileIcon.Shield -> drawPath(androidx.compose.ui.graphics.Path().apply {
            moveTo(w * .5f, h * .08f); lineTo(w * .88f, h * .24f); lineTo(w * .88f, h * .5f)
            cubicTo(w * .88f, h * .74f, w * .7f, h * .88f, w * .5f, h * .96f)
            cubicTo(w * .3f, h * .88f, w * .12f, h * .74f, w * .12f, h * .5f); lineTo(w * .12f, h * .24f); close()
        }, tint, style = stroke)
        ProfileIcon.Bell -> {
            drawPath(androidx.compose.ui.graphics.Path().apply {
                moveTo(w * .2f, h * .74f); cubicTo(w * .26f, h * .66f, w * .28f, h * .54f, w * .28f, h * .42f)
                cubicTo(w * .28f, h * .22f, w * .72f, h * .22f, w * .72f, h * .42f)
                cubicTo(w * .72f, h * .54f, w * .74f, h * .66f, w * .8f, h * .74f); close()
            }, tint, style = stroke)
            drawLine(tint, Offset(w * .42f, h * .88f), Offset(w * .58f, h * .88f), stroke.width, StrokeCap.Round)
        }
        ProfileIcon.Phone -> {
            drawRoundRect(tint, Offset(w * .27f, h * .08f), Size(w * .46f, h * .84f), androidx.compose.ui.geometry.CornerRadius(w * .1f), style = stroke)
            drawLine(tint, Offset(w * .44f, h * .8f), Offset(w * .56f, h * .8f), stroke.width, StrokeCap.Round)
        }
        ProfileIcon.Person -> {
            drawCircle(tint, w * .17f, Offset(w * .5f, h * .34f), style = stroke)
            drawArc(tint, 200f, 140f, false, Offset(w * .22f, h * .56f), Size(w * .56f, h * .5f), style = stroke)
        }
        ProfileIcon.Camera -> {
            drawRoundRect(tint, Offset(w * .1f, h * .26f), Size(w * .8f, h * .6f), androidx.compose.ui.geometry.CornerRadius(w * .1f), style = stroke)
            drawCircle(tint, w * .17f, Offset(w * .5f, h * .56f), style = stroke)
            drawLine(tint, Offset(w * .34f, h * .26f), Offset(w * .4f, h * .14f), stroke.width, StrokeCap.Round)
            drawLine(tint, Offset(w * .4f, h * .14f), Offset(w * .6f, h * .14f), stroke.width, StrokeCap.Round)
            drawLine(tint, Offset(w * .6f, h * .14f), Offset(w * .66f, h * .26f), stroke.width, StrokeCap.Round)
        }
        ProfileIcon.Gallery -> {
            drawRoundRect(tint, Offset(w * .1f, h * .16f), Size(w * .8f, h * .68f), androidx.compose.ui.geometry.CornerRadius(w * .1f), style = stroke)
            drawCircle(tint, w * .07f, Offset(w * .34f, h * .38f), style = stroke)
            drawLine(tint, Offset(w * .14f, h * .78f), Offset(w * .44f, h * .52f), stroke.width, StrokeCap.Round)
            drawLine(tint, Offset(w * .44f, h * .52f), Offset(w * .86f, h * .78f), stroke.width, StrokeCap.Round)
        }
        ProfileIcon.Settings -> {
            drawCircle(tint, w * .14f, Offset(w * .5f, h * .5f), style = stroke)
            drawLine(tint, Offset(w * .5f, h * .08f), Offset(w * .5f, h * .26f), stroke.width, StrokeCap.Round)
            drawLine(tint, Offset(w * .5f, h * .74f), Offset(w * .5f, h * .92f), stroke.width, StrokeCap.Round)
            drawLine(tint, Offset(w * .08f, h * .5f), Offset(w * .26f, h * .5f), stroke.width, StrokeCap.Round)
            drawLine(tint, Offset(w * .74f, h * .5f), Offset(w * .92f, h * .5f), stroke.width, StrokeCap.Round)
        }
    }
}

@Composable fun ProfileIconTile(icon: ProfileIcon, size: Int = 32) {
    Box(Modifier.size(size.dp).background(Tokens.accentSoft, RoundedCornerShape((size * .31f).dp)), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size((size * .54f).dp)) { drawProfileIcon(icon, Tokens.wine) }
    }
}

/** Gradient ring of the home avatar, scaled up; the camera badge is shown only when the photo can be changed. */
@Composable fun ProfileHero(name: String, role: String?, email: String?, avatarUrl: String?, onEditPhoto: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        val description = if (onEditPhoto != null) "Alterar foto de perfil" else "Foto de perfil"
        Box(Modifier.size(96.dp).semantics { contentDescription = description }
            .then(if (onEditPhoto != null) Modifier.clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Alterar foto de perfil", onClick = onEditPhoto) else Modifier)) {
            Box(Modifier.size(92.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Tokens.pink, Tokens.indigo))), contentAlignment = Alignment.Center) {
                if (avatarUrl.isNullOrBlank()) Text(profileInitials(personDisplayName(name)), color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 30.sp))
                else Box(Modifier.padding(3.dp).clip(CircleShape)) { ProductPhoto(avatarUrl, "Foto de perfil", 86) }
            }
            if (onEditPhoto != null) Box(Modifier.align(Alignment.BottomEnd).size(32.dp).background(Tokens.accent, CircleShape).border(3.dp, Tokens.dark, CircleShape), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(15.dp)) { drawProfileIcon(ProfileIcon.Camera, Color.White) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(personDisplayName(name), color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 22.sp), maxLines = 2)
        role?.takeIf(String::isNotBlank)?.let { Text(it, color = Tokens.onDark2, style = MaterialTheme.typography.bodyMedium) }
        email?.takeIf(String::isNotBlank)?.let { Text(it, color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp)) }
    }
}

@Composable fun SettingsGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title.uppercase(java.util.Locale.forLanguageTag("pt-BR")), color = Tokens.muted, modifier = Modifier.padding(start = 6.dp, top = 6.dp),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.ExtraBold))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Tokens.surface).border(1.dp, Tokens.border, RoundedCornerShape(18.dp))) { content() }
    }
}

/** One line of a settings list. [onClick] makes the whole row tappable; [trailing] holds a switch, tag or chevron. */
@Composable fun SettingsRow(icon: ProfileIcon, title: String, subtitle: String?, divider: Boolean = true, onClick: (() -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    if (divider) Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.border))
    Row(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier).heightIn(min = 60.dp).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        ProfileIconTile(icon)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp))
            subtitle?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp)) }
        }
        trailing()
    }
}

@Composable fun SettingsSwitch(checked: Boolean, enabled: Boolean = true, label: String, onChange: (Boolean) -> Unit) {
    Switch(checked, onChange, enabled = enabled, modifier = Modifier.semantics { contentDescription = label },
        colors = SwitchDefaults.colors(checkedTrackColor = Tokens.accent, checkedThumbColor = Color.White, uncheckedTrackColor = Tokens.fieldBorder, uncheckedThumbColor = Color.White, uncheckedBorderColor = Color.Transparent))
}

@Composable fun SettingsTag(text: String, warm: Boolean = false) {
    StatusChip(text, if (warm) Tokens.warning else Tokens.ok, if (warm) Tokens.warningBg else Tokens.okBg)
}

/** Tall sheet over the dimmed profile: current photo up front and the two ways to change it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PhotoSheet(name: String, avatarUrl: String?, error: String?, onDismiss: () -> Unit, onPhotograph: () -> Unit, onPickFile: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Tokens.surface) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(116.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Tokens.pink, Tokens.indigo))), contentAlignment = Alignment.Center) {
                if (avatarUrl.isNullOrBlank()) Text(profileInitials(personDisplayName(name)), color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 34.sp))
                else Box(Modifier.padding(3.dp).clip(CircleShape)) { ProductPhoto(avatarUrl, "Foto de perfil atual", 110) }
            }
            Text("Foto de perfil", style = MaterialTheme.typography.titleLarge.copy(fontSize = 18.sp))
            Text("Como os colegas veem você", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PhotoSheetAction("Tirar foto", ProfileIcon.Camera, primary = true, Modifier.weight(1f), onPhotograph)
                PhotoSheetAction("Galeria", ProfileIcon.Gallery, primary = false, Modifier.weight(1f), onPickFile)
            }
            error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
            androidx.compose.material3.TextButton(onDismiss) { Text("Cancelar", color = Tokens.muted) }
        }
    }
}

@Composable private fun PhotoSheetAction(label: String, icon: ProfileIcon, primary: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Tokens.soft).border(1.dp, Tokens.border, RoundedCornerShape(16.dp))
        .clickable(role = Role.Button, onClick = onClick).padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(44.dp).background(if (primary) Tokens.accent else Tokens.accentSoft, CircleShape), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(22.dp)) { drawProfileIcon(icon, if (primary) Color.White else Tokens.wine) }
        }
        Text(label, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
    }
}

/** Banner shown above the lists only when a newer version exists. */
@Composable fun UpdateBanner(versionName: String, busy: Boolean, onUpdate: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Tokens.accent).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text("Nova versão $versionName", color = Color.White, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
            Text("Toque para baixar e instalar", color = Color.White.copy(alpha = .9f), style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp))
        }
        Box(Modifier.clip(RoundedCornerShape(10.dp)).background(Color.White).clickable(enabled = !busy, role = Role.Button, onClick = onUpdate).padding(horizontal = 12.dp, vertical = 9.dp)) {
            Text(if (busy) "Baixando…" else "Atualizar", color = Tokens.accent, style = MaterialTheme.typography.titleMedium.copy(fontSize = 13.sp))
        }
    }
}
