package com.coalaone.go.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import com.coalaone.go.BuildConfig
import com.coalaone.go.domain.Rules
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable fun ScheduleScreen(vm: ModulesViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    LaunchedEffect(Unit) { vm.schedule() }
    val dates = Rules.week(state.day)
    val units = state.schedules.values.flatMap { it.units }.distinctBy { it.id }
    val selected = units.firstOrNull { it.id == state.selectedScheduleUnit } ?: units.firstOrNull()
    var selectedDay by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    val day = dates.firstOrNull { it.toString() == selectedDay } ?: dates.firstOrNull { it == state.day } ?: dates.first()
    Page("Escala", feedback, onBack, onRefresh = { vm.refreshSchedule() }) {
        val today = LocalDate.now(); val pt = java.util.Locale.forLanguageTag("pt-BR")
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton({ vm.schedule(state.day.minusWeeks(1)) }, enabled = !feedback.busy) { Text("‹ Anterior") }
            Text("${dates.first().format(DateTimeFormatter.ofPattern("dd/MM"))} a ${dates.last().format(DateTimeFormatter.ofPattern("dd/MM"))}", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            TextButton({ vm.schedule(state.day.plusWeeks(1)) }, enabled = !feedback.busy) { Text("Próxima ›") }
        }
        if (today !in dates) TextButton({ selectedDay = today.toString(); vm.schedule(today) }, enabled = !feedback.busy) { Text("Voltar para hoje") }
        // The seven days always fit the width; nothing is hidden behind a horizontal scroll.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            dates.forEach { date ->
                val active = date == day; val isToday = date == today
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(if (active) Tokens.accent else Color.White).border(1.dp, if (active) Tokens.accent else if (isToday) Tokens.pink else Tokens.border, RoundedCornerShape(12.dp))
                    .selectable(active, role = Role.Tab) { selectedDay = date.toString() }.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(date.format(DateTimeFormatter.ofPattern("EEE", pt)).take(3), color = if (active) Color.White else Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    Text(date.format(DateTimeFormatter.ofPattern("dd")), color = if (active) Color.White else Tokens.ink, style = MaterialTheme.typography.titleMedium)
                    Text(if (isToday) "hoje" else " ", color = if (active) Color.White else Tokens.accent, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
                }
            }
        }
        if (units.size > 1) Choices("Unidade", units.map { it.id to it.name }, selected?.id.orEmpty(), !feedback.busy) { vm.scheduleFilter(it, state.onlyMine) }
        Choices("Visualização", listOf("team" to "Equipe", "mine" to "Só minha"), if (state.onlyMine) "mine" else "team") { vm.scheduleFilter(selected?.id.orEmpty(), it == "mine") }
        if (units.isEmpty() && !feedback.busy) EmptyState("Nenhuma escala publicada", "Não há escala publicada para esta semana.")
        else {
            val month = state.schedules[day.toString().take(7)]
            val unit = month?.units?.firstOrNull { it.id == selected?.id }
            val shifts = unit?.shifts.orEmpty().filter { it.date == day.toString() && (!state.onlyMine || unit?.people?.getOrNull(it.person)?.isMe == true) }
            SectionLabel(day.format(DateTimeFormatter.ofPattern("EEEE, dd 'de' MMMM", pt)) + (selected?.name?.let { " · $it" } ?: ""))
            if (month?.published == false) EmptyState("Escala não publicada", "A escala deste mês ainda não foi publicada.")
            else if (shifts.isEmpty()) EmptyState(if (state.onlyMine) "Você não tem turno neste dia" else "Nenhum turno neste dia")
            else CardBlock { shifts.forEachIndexed { index, shift ->
                val person = unit?.people?.getOrNull(shift.person)
                if (index > 0) HorizontalDivider(color = Tokens.border)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (person?.avatarUrl?.startsWith("https://") == true) ProductPhoto(person.avatarUrl, person.name, 40)
                    else Box(Modifier.size(40.dp).background(Tokens.soft, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { Text(profileInitials(person?.name.orEmpty()), style = MaterialTheme.typography.titleMedium) }
                    Column(Modifier.weight(1f)) {
                        Text("${person?.name.orEmpty()}${if (person?.isMe == true) " · você" else ""}", style = MaterialTheme.typography.titleMedium)
                        person?.role?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        if (shift.type == "day_off") Text("Folga", color = Tokens.muted, style = MaterialTheme.typography.titleMedium)
                        else { Text("${shift.startTime}–${shift.endTime}", style = MaterialTheme.typography.titleMedium); Text(shift.shiftName, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                    }
                }
            } }
        }
    }
}
@Composable fun GoalsScreen(vm: ModulesViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var selectedGoal by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable { mutableStateOf("days") }
    LaunchedEffect(Unit) { vm.goalUnits() }
    val goals = state.goals?.goals.orEmpty()
    val goal = goals.firstOrNull { it.id == selectedGoal } ?: goals.firstOrNull()
    Page("Metas", feedback, onBack, header = {
        TopBar("Metas", busy = feedback.busy, onBack = onBack)
        Spacer(Modifier.height(10.dp))
        goal?.let { target ->
            Text(target.typeLabel, color = Tokens.onDark2)
            Text(moneyValue(target.summary.currentValue), color = Tokens.onDark, style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(14.dp))
            AnimatedProgress((target.summary.percentOfTarget / 100).toFloat())
            Spacer(Modifier.height(8.dp))
            Text("${percentText(target.summary.percentOfTarget)} da meta · ${target.summary.remainingDays} dias restantes", color = Tokens.onDark2, style = MaterialTheme.typography.bodySmall)
        }
    }) {
        Choices("Unidade", state.goalUnits.map { it.id to it.name }, state.goals?.kioskId.orEmpty(), !feedback.busy) { selectedGoal = ""; vm.goals(it) }
        Choices("Meta", goals.map { it.id to "${it.typeLabel} · ${shortDate(it.startDate) ?: it.startDate} a ${shortDate(it.endDate) ?: it.endDate}" }, goal?.id.orEmpty()) { selectedGoal = it }
        if (state.goals != null && goals.isEmpty()) EmptyState("Nenhuma meta ativa", "Esta unidade não tem meta em andamento.")
        goal?.let { target ->
            CardBlock {
                target.summary.levels.forEach { level ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(level.label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        Text(moneyValue(level.amount) + if (level.reached) " · alcançada" else "", color = if (level.reached) Tokens.ok else Tokens.ink)
                    }
                }
                target.summary.nextLevel?.let { Text("Faltam ${moneyValue(it.remaining)} para alcançar ${it.label.lowercase()}", color = Tokens.accent, style = MaterialTheme.typography.titleMedium) }
                val stats = listOfNotNull("Dias" to "${target.summary.elapsedDays} de ${target.summary.totalDays}", target.summary.projection?.let { "Projeção" to moneyValue(it) }, target.summary.neededDaily?.let { "Necessário por dia" to moneyValue(it) }, target.summary.dailyTarget?.let { "Meta diária" to moneyValue(it) })
                stats.chunked(2).forEach { pair -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { pair.forEach { (label, value) -> StatBox(label, value, Modifier.weight(1f)) }; if (pair.size == 1) Spacer(Modifier.weight(1f)) } }
            }
            Choices("Resultados", listOf("days" to "Dias", "team" to "Equipe", "prize" to "Prêmio"), tab) { tab = it }
            if (tab == "days") CardBlock { Text("Resultado por dia", style = MaterialTheme.typography.titleMedium); target.days.forEach { row -> Row(Modifier.fillMaxWidth()) { Text(shortDate(row.date) ?: row.date, modifier = Modifier.weight(1f)); Text(moneyValue(row.value) + if (row.reachedDailyTarget == true) " · meta do dia" else "", color = if (row.reachedDailyTarget == true) Tokens.ok else Tokens.ink) } } }
            if (tab == "team") CardBlock { Text("Resultado da equipe", style = MaterialTheme.typography.titleMedium); target.team.forEach { member ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { ProductPhoto(member.avatarUrl, member.name, 36); Column { Text("${member.name}${if (member.isMe) " · você" else ""} · ${member.role}"); Text("${moneyValue(member.currentValue)} / ${moneyValue(member.targetValue)} · ${percentText(member.percent)}"); member.prize?.let { Text("Prêmio: ${moneyValue(it)}") } } }
                AnimatedProgress((member.percent / 100).toFloat(), duration = 1000)
            } }
            if (tab == "prize") target.prize?.let { prize -> CardBlock {
                Text("Prêmio · ${prize.methodName}", style = MaterialTheme.typography.titleMedium)
                prize.tiers.forEach { tier -> Text("${tier.label}: a partir de ${moneyValue(tier.fromAmount)} · ${moneyValue(tier.fixedBonusAmount)} + ${percentText(tier.excessPercent)}${if (tier.reached) " · alcançado" else ""}") }
                prize.nextTier?.let { Text("Faltam ${moneyValue(it.remaining)} para ${it.label}") }
                Text("Equipe: ${moneyValue(prize.totalTeamBonus)} · liderança: ${moneyValue(prize.leadershipBonus)}")
                prize.message?.let { Text(it) }
            } }
            if (tab == "prize" && target.prize == null) EmptyState("Nenhum prêmio informado para esta meta")
        }
    }
}
@Composable fun SignageScreen(vm: ModulesViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var unitId by rememberSaveable { mutableStateOf("") }; var screenId by rememberSaveable { mutableStateOf("") }
    var orientation by rememberSaveable { mutableStateOf("landscape") }; var code by rememberSaveable { mutableStateOf("") }
    var pairing by rememberSaveable { mutableStateOf(false) }; var scanning by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.signage() }
    val unit = state.signage?.units?.firstOrNull { it.id == unitId }
    Page("Signage", feedback, onBack, onRefresh = { vm.signage() }) {
        state.paired?.let { Text("${it.screen.name} conectada em ${it.screen.kioskName}", color = Tokens.ok) }
        state.signage?.units.orEmpty().forEach { row -> CardBlock {
            Text(row.name, style = MaterialTheme.typography.titleMedium)
            row.screens.forEach { screen -> Row(Modifier.fillMaxWidth()) {
                Text("${screen.name} · ${when (screen.orientation) { "landscape" -> "horizontal"; "portrait" -> "vertical"; else -> "orientação pendente" }}", modifier = Modifier.weight(1f))
                Text(if (screen.connected) "Conectada" else "Desconectada", color = if (screen.connected) Tokens.ok else Tokens.muted)
            } }
            Action("Conectar monitor em ${row.name}", feedback.busy, secondary = true) { unitId = row.id; screenId = ""; pairing = true }
        } }
        if (pairing && unit != null) CardBlock {
            Text("Conectar monitor · ${unit.name}", style = MaterialTheme.typography.titleMedium)
            Choices("Orientação", listOf("landscape" to "Horizontal", "portrait" to "Vertical"), orientation, !feedback.busy) { orientation = it }
            Choices("Tela", (if (!unit.full) listOf("" to "Nova: ${unit.nextScreenName}") else emptyList()) + unit.screens.map { it.id to "Substituir ${it.name}" }, screenId, !feedback.busy) { screenId = it }
            if (unit.full && screenId.isEmpty()) Text("Limite de telas alcançado; escolha uma tela existente.", color = Tokens.warning)
            Text("No URL Launcher do monitor, abra ${BuildConfig.API_BASE_URL.trimEnd('/')}/app e leia o QR apresentado.")
            Field("Código do monitor", code, !feedback.busy) { code = it.uppercase().take(32) }
            Action("Ler QR code", feedback.busy, secondary = true) { scanning = true }
            if (scanning) Dialog(onDismissRequest = { scanning = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
                Column(Modifier.fillMaxSize().background(Tokens.dark).safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text("Aponte para o QR do monitor", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
                    QrScanner({ scanned -> code = scanned; scanning = false }, { scanning = false }, Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(20.dp)), dark = true)
                }
            }
            if (screenId.isNotEmpty()) Text("O novo monitor substituirá a conexão da tela escolhida.", color = Tokens.warning)
            Action("Confirmar conexão", feedback.busy, enabled = Rules.pairingCode(code) != null && (!unit.full || screenId.isNotEmpty())) { vm.pair(unitId, screenId.ifBlank { null }, orientation, code); pairing = false }
            TextButton({ pairing = false }) { Text("Voltar para as telas") }
        }
        if (state.signage?.units?.isEmpty() == true) EmptyState("Nenhuma unidade disponível", "Seu perfil não tem unidade liberada para Signage.")
    }
}
