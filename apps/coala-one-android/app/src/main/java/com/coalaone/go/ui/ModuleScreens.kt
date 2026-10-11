package com.coalaone.go.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
    Page("Escala", feedback, onBack) {
        Action("Atualizar escala", feedback.busy, secondary = true) { vm.refreshSchedule() }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton({ vm.schedule(state.day.minusWeeks(1)) }, enabled = !feedback.busy) { Text("← Semana") }
            TextButton({ vm.schedule(LocalDate.now()) }, enabled = !feedback.busy) { Text("Hoje") }
            TextButton({ vm.schedule(state.day.plusWeeks(1)) }, enabled = !feedback.busy) { Text("Semana →") }
        }
        Choices("Unidade", units.map { it.id to it.name }, selected?.id.orEmpty(), !feedback.busy) { vm.scheduleFilter(it, state.onlyMine) }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            dates.forEach { date -> FilterChip(day == date, { selectedDay = date.toString() }, label = { Text(date.format(DateTimeFormatter.ofPattern("EEE\ndd", java.util.Locale.forLanguageTag("pt-BR")))) }) }
        }
        Choices("Visualização", listOf("team" to "Equipe", "mine" to "Só minha"), if (state.onlyMine) "mine" else "team") { vm.scheduleFilter(selected?.id.orEmpty(), it == "mine") }
        if (units.isEmpty() && !feedback.busy) Text("Nenhuma escala publicada para este período.")
        listOf(day).forEach { date -> CardBlock {
            Text(date.format(DateTimeFormatter.ofPattern("EEE, dd/MM", java.util.Locale.forLanguageTag("pt-BR"))), style = MaterialTheme.typography.titleMedium)
            val month = state.schedules[date.toString().take(7)]
            val unit = month?.units?.firstOrNull { it.id == selected?.id }
            if (month?.published == false) Text("Escala não publicada.")
            val shifts = unit?.shifts.orEmpty().filter { it.date == date.toString() && (!state.onlyMine || unit?.people?.getOrNull(it.person)?.isMe == true) }
            if (shifts.isEmpty()) Text("Nenhum turno disponível.")
            shifts.forEach { shift ->
                val person = unit?.people?.getOrNull(shift.person)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { if (person?.avatarUrl?.startsWith("https://") == true) ProductPhoto(person.avatarUrl, person.name, 36); Column {
                    Text("${person?.name.orEmpty()}${if (person?.isMe == true) " · você" else ""}")
                    Text(if (shift.type == "day_off") "Folga" else "${shift.startTime}–${shift.endTime} · ${shift.shiftName}")
                    person?.role?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                } }
            }
        } }
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
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Metas", color = Tokens.onDark, style = MaterialTheme.typography.titleLarge)
            TextButton(onBack, enabled = !feedback.busy) { Text("← Voltar", color = Tokens.pink) }
        }
        goal?.let { target ->
            Text(target.typeLabel, color = Tokens.onDark2)
            Text(moneyValue(target.summary.currentValue), color = Tokens.onDark, style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(14.dp))
            AnimatedProgress((target.summary.percentOfTarget / 100).toFloat())
            Spacer(Modifier.height(8.dp))
            Text("${target.summary.percentOfTarget}% da meta · ${target.summary.remainingDays} dias restantes", color = Tokens.onDark2, style = MaterialTheme.typography.bodySmall)
        }
    }) {
        Choices("Unidade", state.goalUnits.map { it.id to it.name }, state.goals?.kioskId.orEmpty(), !feedback.busy) { selectedGoal = ""; vm.goals(it) }
        Choices("Meta", goals.map { it.id to "${it.typeLabel} · ${it.startDate} a ${it.endDate}" }, goal?.id.orEmpty()) { selectedGoal = it }
        if (state.goals != null && goals.isEmpty()) Text("Nenhuma meta ativa nesta unidade.")
        goal?.let { target ->
            CardBlock {
                target.summary.levels.forEach { Text("${it.label}: ${moneyValue(it.amount)}${if (it.reached) " · alcançada" else ""}") }
                target.summary.nextLevel?.let { Text("Faltam ${moneyValue(it.remaining)} para ${it.label}") }
                Text("${target.summary.elapsedDays}/${target.summary.totalDays} dias · ${target.summary.remainingDays} restantes")
                target.summary.projection?.let { Text("Projeção: ${moneyValue(it)}") }
                target.summary.neededDaily?.let { Text("Necessário por dia: ${moneyValue(it)}") }
                target.summary.dailyTarget?.let { Text("Meta diária: ${moneyValue(it)}") }
            }
            Choices("Resultados", listOf("days" to "Dias", "team" to "Equipe", "prize" to "Prêmio"), tab) { tab = it }
            if (tab == "days") CardBlock { Text("Resultado por dia", style = MaterialTheme.typography.titleMedium); target.days.forEach { Text("${it.date} · ${moneyValue(it.value)}${if (it.reachedDailyTarget == true) " · meta diária alcançada" else ""}") } }
            if (tab == "team") CardBlock { Text("Resultado da equipe", style = MaterialTheme.typography.titleMedium); target.team.forEach { member ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { ProductPhoto(member.avatarUrl, member.name, 36); Column { Text("${member.name}${if (member.isMe) " · você" else ""} · ${member.role}"); Text("${moneyValue(member.currentValue)} / ${moneyValue(member.targetValue)} · ${member.percent}%"); member.prize?.let { Text("Prêmio: ${moneyValue(it)}") } } }
                AnimatedProgress((member.percent / 100).toFloat(), duration = 1000)
            } }
            if (tab == "prize") target.prize?.let { prize -> CardBlock {
                Text("Prêmio · ${prize.methodName}", style = MaterialTheme.typography.titleMedium)
                prize.tiers.forEach { tier -> Text("${tier.label}: a partir de ${moneyValue(tier.fromAmount)} · ${moneyValue(tier.fixedBonusAmount)} + ${tier.excessPercent}%${if (tier.reached) " · alcançado" else ""}") }
                prize.nextTier?.let { Text("Faltam ${moneyValue(it.remaining)} para ${it.label}") }
                Text("Equipe: ${moneyValue(prize.totalTeamBonus)} · liderança: ${moneyValue(prize.leadershipBonus)}")
                prize.message?.let { Text(it) }
            } }
            if (tab == "prize" && target.prize == null) Text("Nenhum prêmio informado para esta meta.")
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
    Page("Signage", feedback, onBack) {
        state.paired?.let { Text("${it.screen.name} conectada em ${it.screen.kioskName}", color = Tokens.ok) }
        Action("Atualizar telas", feedback.busy, secondary = true) { vm.signage() }
        state.signage?.units.orEmpty().forEach { row -> CardBlock {
            Text(row.name, style = MaterialTheme.typography.titleMedium)
            row.screens.forEach { screen -> Text("${screen.name} · ${screen.orientation ?: "orientação pendente"} · ${if (screen.connected) "conectada" else "desconectada"}") }
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
            if (scanning) QrScanner({ scanned -> code = scanned; scanning = false }, { scanning = false })
            if (screenId.isNotEmpty()) Text("O novo monitor substituirá a conexão da tela escolhida.", color = Tokens.warning)
            Action("Confirmar conexão", feedback.busy, enabled = Rules.pairingCode(code) != null && (!unit.full || screenId.isNotEmpty())) { vm.pair(unitId, screenId.ifBlank { null }, orientation, code); pairing = false }
            TextButton({ pairing = false }) { Text("Voltar para as telas") }
        }
        if (state.signage?.units?.isEmpty() == true) Text("Nenhuma unidade disponível para Signage.")
    }
}
