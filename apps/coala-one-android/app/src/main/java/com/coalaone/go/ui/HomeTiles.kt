package com.coalaone.go.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

fun profileInitials(name: String): String = name.trim().split(Regex("\\s+"))
    .mapNotNull { word -> word.firstOrNull { it.isLetter() } }.take(2)
    .joinToString("") { it.uppercaseChar().toString() }.ifBlank { "H" }

/** Keep people recognizable without letting long legal names dominate compact app layouts. */
fun personDisplayName(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter(String::isNotBlank)
    return when (words.size) {
        0 -> ""
        1 -> words.first()
        else -> "${words.first()} ${words.last()}"
    }
}

/** Remove technical scope from schedule labels while preserving the useful shift and role. */
fun scheduleShiftDisplayName(name: String): String {
    val parts = name.split('|', limit = 2).map(String::trim).filter(String::isNotBlank)
    if (parts.size < 2) return name.trim()
    val detail = parts.last().removePrefix("Turno - ").split(" - ")
        .firstOrNull { it.isNotBlank() && '/' !in it }.orEmpty()
    return listOf(parts.first(), detail).filter(String::isNotBlank).joinToString(" · ")
}

private val genericUnitWords = setOf("unidade", "quiosque", "loja", "coala", "de", "da", "do", "das", "dos", "e")

fun homeRoleSubtitle(role: String?): String = role?.trim()?.takeIf(String::isNotEmpty) ?: "Equipe Coala"
/**
 * Two-letter badge for a unit: generic words are skipped, two significant words give their
 * initials ("João Paulo" -> JP) and a single one gives its first letter plus the next consonant
 * ("Unidade Tirirical" -> TR).
 */
fun unitInitials(name: String): String {
    val plain = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
    val words = plain.split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotBlank() }
    val significant = words.filter { it.lowercase() !in genericUnitWords }.ifEmpty { words }
    val letters = when {
        significant.isEmpty() -> ""
        significant.size >= 2 -> "${significant[0].first()}${significant[1].first()}"
        else -> significant[0].let { word -> "${word.first()}${word.drop(1).firstOrNull { it.isLetterOrDigit() && it.lowercaseChar() !in "aeiou" } ?: word.drop(1).firstOrNull() ?: ""}" }
    }
    return letters.uppercase().ifBlank { "?" }
}
/** Fallback tones for people without a registered colour; they follow the position in the list. */
private val personTones = listOf(Color(0xFFDB2777), Color(0xFF7C3AED), Color(0xFF0B76B7), Color(0xFF059669), Color(0xFFD97706))
/** The colour the schedule editor gave the person ("#RRGGBB"), or null when it is not a plain hex. */
fun personColor(hex: String?): Color? = hex?.trim()?.takeIf { Regex("#[0-9a-fA-F]{6}").matches(it) }?.let { Color(0xFF000000 or it.drop(1).toLong(16)) }
/** Photo when the profile has one, initials otherwise; either way ringed in the person's colour. */
@Composable fun PersonBadge(name: String, url: String?, index: Int, hex: String? = null, size: Int = 42) {
    val color = personColor(hex) ?: personTones[Math.floorMod(index, personTones.size)]
    // Registered colours are often pastel: the ring and tint use the colour, the letters stay dark.
    Box(Modifier.size(size.dp).clip(CircleShape).background(color.copy(alpha = .22f)).border(2.5.dp, color, CircleShape), contentAlignment = Alignment.Center) {
        if (url?.startsWith("https://") == true) Box(Modifier.padding(3.dp).clip(CircleShape)) { ProductPhoto(url, name, size - 6) }
        else Text(profileInitials(personDisplayName(name)), color = Tokens.ink, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable fun ProfileAvatar(name: String, url: String?, onClick: () -> Unit) {
    Box(Modifier.size(58.dp).clickable(role = Role.Button, onClickLabel = "Abrir perfil: foto, versão e sair", onClick = onClick)) {
        Box(Modifier.size(54.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Tokens.pink, Tokens.indigo))), contentAlignment = Alignment.Center) {
            if (url.isNullOrBlank()) Text(profileInitials(personDisplayName(name)), color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 18.sp))
            else Box(Modifier.padding(2.dp).clip(CircleShape)) { ProductPhoto(url, "Foto de perfil", 50) }
        }
        // Pencil badge of the prototype: the avatar opens the profile, where the photo is changed.
        Box(Modifier.align(Alignment.BottomEnd).size(22.dp).background(Tokens.dark, CircleShape).border(1.dp, Tokens.onDark.copy(alpha = .2f), CircleShape), contentAlignment = Alignment.Center) { Text("✎", color = Tokens.onDark, style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, letterSpacing = 0.sp)) }
    }
}

@Composable fun HomeTile(title: String, route: String, modifier: Modifier = Modifier, pending: Int = 0, badge: String? = null,
    badgeWarm: Boolean = false, subtitle: String? = null, onClick: () -> Unit) {
    val visibleBadge = badge ?: pending.takeIf { it > 0 }?.let { if (it == 1) "1 nota" else "$it notas" }
    Card(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(20.dp), border = BorderStroke(1.dp, Tokens.border),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp), colors = CardDefaults.cardColors(containerColor = Tokens.surface)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Box(Modifier.size(44.dp).background(Tokens.soft, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) { ModuleIcon(route, Modifier.size(34.dp)) }
                Spacer(Modifier.weight(1f))
                // Status of the module at a glance, as in the prototype.
                visibleBadge?.let { StatusChip(it, if (badgeWarm) Tokens.warning else Tokens.info, if (badgeWarm) Tokens.warningBg else Tokens.infoBg) }
            }
            Text(title, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
            Text(subtitle ?: when (route) { "purchase" -> "Notas e compras da unidade"; "count" -> "Saídas e sobras do turno"; "receive" -> "O que chegou da reposição"; "schedule" -> "Turnos, folgas e trocas"; "goals" -> "O que falta e o placar da equipe"; "time" -> "Bater ponto e ver registros"; "requests" -> "Ausências, trocas e benefícios"; else -> "Conecte os monitores" }, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp))
        }
    }
}
