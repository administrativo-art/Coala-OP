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

fun profileInitials(name: String): String = name.trim().split(Regex("\\s+"))
    .mapNotNull { word -> word.firstOrNull { it.isLetter() } }.take(2)
    .joinToString("") { it.uppercaseChar().toString() }.ifBlank { "H" }

@Composable fun ProfileAvatar(name: String, url: String?, onClick: () -> Unit) {
    Box(Modifier.size(54.dp).clip(CircleShape).background(Tokens.dark)
        .border(2.dp, Brush.linearGradient(listOf(Tokens.pink, Tokens.indigo)), CircleShape)
        .clickable(role = Role.Button, onClickLabel = "Abrir perfil", onClick = onClick), contentAlignment = Alignment.Center) {
        if (url.isNullOrBlank()) Text(profileInitials(name), color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
        else ProductPhoto(url, "Foto de perfil", 50)
    }
}

@Composable fun HomeTile(title: String, route: String, modifier: Modifier = Modifier, pending: Int = 0, onClick: () -> Unit) {
    val hero = route == "purchase"
    Card(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(if (hero) 22.dp else 20.dp),
        border = BorderStroke(1.dp, if (hero) Tokens.pink.copy(alpha = .4f) else Tokens.border),
        colors = CardDefaults.cardColors(containerColor = Color.White)) {
        if (hero) Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                Text("Envie notas e comprovantes", color = Tokens.muted, style = MaterialTheme.typography.bodyMedium)
                if (pending > 0) Text("$pending pendentes", color = Tokens.accent, style = MaterialTheme.typography.labelLarge)
                Text("Registrar compra →", color = Tokens.accent, style = MaterialTheme.typography.labelLarge)
            }
            Box(Modifier.background(Tokens.accentSoft, RoundedCornerShape(18.dp)).padding(12.dp)) { ModuleIcon(route, Modifier.size(72.dp)) }
        } else Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.background(Tokens.soft, RoundedCornerShape(14.dp)).padding(4.dp)) { ModuleIcon(route) }
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(when (route) { "count" -> "Confira os insumos"; "receive" -> "Confira a entrega"; "schedule" -> "Seu time e seus turnos"; "goals" -> "Acompanhe os resultados"; else -> "Conecte os monitores" }, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
