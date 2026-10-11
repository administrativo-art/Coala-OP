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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.clickable
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import com.coalaone.go.BuildConfig
import com.coalaone.go.domain.Rules
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val ptBR = java.util.Locale.forLanguageTag("pt-BR")
private fun money0(value: Double) = "R$ " + java.text.NumberFormat.getIntegerInstance(ptBR).format(Math.round(value))
@Composable private fun NavSquare(glyph: String, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick), contentAlignment = Alignment.Center) {
        Box(Modifier.size(34.dp).background(Color.White, RoundedCornerShape(10.dp)).border(1.dp, Tokens.fieldBorder, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) { Text(glyph, style = MaterialTheme.typography.titleMedium) }
    }
}
@Composable fun ScheduleScreen(vm: ModulesViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    LaunchedEffect(Unit) { vm.schedule() }
    val dates = Rules.week(state.day)
    val units = state.schedules.values.flatMap { it.units }.distinctBy { it.id }
    val selected = units.firstOrNull { it.id == state.selectedScheduleUnit } ?: units.firstOrNull()
    var selectedDay by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    val day = dates.firstOrNull { it.toString() == selectedDay } ?: dates.firstOrNull { it == state.day } ?: dates.first()
    val today = LocalDate.now()
    // The person's own shift on a date, across every unit they are scheduled in.
    fun mine(date: LocalDate) = state.schedules[date.toString().take(7)]?.units.orEmpty().flatMap { unit -> unit.shifts.filter { it.date == date.toString() && unit.people.getOrNull(it.person)?.isMe == true } }.minByOrNull { it.startTime }
    Page("Escala", feedback, onBack, onRefresh = { vm.refreshSchedule() }) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            NavSquare("‹", "Semana anterior", !feedback.busy) { vm.schedule(state.day.minusWeeks(1)) }
            val sameMonth = dates.first().month == dates.last().month
            Text("${dates.first().dayOfMonth}${if (sameMonth) "" else dates.first().format(DateTimeFormatter.ofPattern(" 'de' MMMM", ptBR))} a ${dates.last().format(DateTimeFormatter.ofPattern("d 'de' MMMM", ptBR))}", style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp), textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            NavSquare("›", "Próxima semana", !feedback.busy) { vm.schedule(state.day.plusWeeks(1)) }
        }
        // The seven days always fit the width; each one carries the hour the person starts, or a dash.
        Row(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            dates.forEach { date ->
                val active = date == day; val own = mine(date)
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(if (active) Tokens.dark else Color.Transparent).selectable(active, role = Role.Tab) { selectedDay = date.toString() }.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(date.format(DateTimeFormatter.ofPattern("EEE", ptBR)).take(3), color = if (active) Tokens.pink else if (date == today) Tokens.wine else Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp))
                    Text("${date.dayOfMonth}", color = if (active) Color.White else Tokens.ink, style = MaterialTheme.typography.titleMedium)
                    Text(when { own == null -> "—"; own.type == "day_off" -> "folga"; else -> own.startTime.take(2) + "h" }, color = if (active) Tokens.onDark2 else if (own == null || own.type == "day_off") Color(0xFFB9B8C2) else Tokens.ink, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp, letterSpacing = 0.sp))
                }
            }
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PillChoice("Equipe", !state.onlyMine) { vm.scheduleFilter(selected?.id.orEmpty(), false) }
            PillChoice("Só a minha", state.onlyMine) { vm.scheduleFilter(selected?.id.orEmpty(), true) }
            Spacer(Modifier.weight(1f))
            if (today !in dates) Text("Hoje", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), modifier = Modifier.clickable(enabled = !feedback.busy, role = Role.Button) { selectedDay = today.toString(); vm.schedule(today) }.padding(8.dp))
        }
        if (units.size > 1 && !state.onlyMine) Choices("Unidade", units.map { it.id to it.name }, selected?.id.orEmpty(), !feedback.busy) { vm.scheduleFilter(it, state.onlyMine) }
        if (units.isEmpty() && !feedback.busy) EmptyState("Nenhuma escala neste período", "Ainda não há escala lançada para esta semana.")
        else {
            val month = state.schedules[day.toString().take(7)]
            // "Só a minha" gathers the person's shifts from every unit; the team view follows the chosen unit.
            val shown = if (state.onlyMine) month?.units.orEmpty() else listOfNotNull(month?.units?.firstOrNull { it.id == selected?.id })
            val rows = shown.flatMap { unit -> unit.shifts.filter { it.date == day.toString() && (!state.onlyMine || unit.people.getOrNull(it.person)?.isMe == true) }.map { unit to it } }.sortedBy { (if (it.second.type == "day_off") "99" else "") + it.second.startTime }
            Text(day.format(DateTimeFormatter.ofPattern("EEEE, d 'de' MMMM", ptBR)).replaceFirstChar { it.titlecase(ptBR) }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
            if (!state.onlyMine && units.size == 1) Text(selected?.name.orEmpty(), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            if (rows.isEmpty()) EmptyState(if (state.onlyMine) "Você não tem turno neste dia" else "Nenhum turno neste dia")
            rows.forEach { (unit, shift) ->
                val person = unit.people.getOrNull(shift.person)
                HorizontalDivider(color = Tokens.border)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PersonBadge(person?.name.orEmpty(), person?.avatarUrl, shift.person, person?.color, 38)
                    Column(Modifier.weight(1f)) {
                        Text("${person?.name.orEmpty()}${if (person?.isMe == true) " · você" else ""}", style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                        Text(if (state.onlyMine && units.size > 1) unit.name else person?.role.orEmpty(), color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    }
                    if (shift.type == "day_off") Text("Folga", color = Tokens.faint, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.5.sp))
                    else Column(horizontalAlignment = Alignment.End) { Text("${shift.startTime}–${shift.endTime}", style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.5.sp)); Text(shift.shiftName, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}
@Composable fun GoalsScreen(vm: ModulesViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var selectedGoal by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable { mutableStateOf("days") }
    LaunchedEffect(Unit) { vm.goalUnits() }
    // The screen opens on the unit last consulted on this phone by this account, or on the first one.
    val preferences = androidx.compose.ui.platform.LocalContext.current.getSharedPreferences("goals", android.content.Context.MODE_PRIVATE)
    val owner = LocalOwner.current
    LaunchedEffect(state.goalUnits, feedback.busy) {
        if (state.goals == null && state.goalUnits.isNotEmpty() && !feedback.busy && feedback.error == null) {
            val saved = preferences.getString("unit:$owner", null)
            vm.goals(state.goalUnits.firstOrNull { it.id == saved }?.id ?: state.goalUnits.first().id)
        }
    }
    val goals = state.goals?.goals.orEmpty()
    val goal = goals.firstOrNull { it.id == selectedGoal } ?: goals.firstOrNull()
    val unitName = state.goalUnits.firstOrNull { it.id == state.goals?.kioskId }?.name.orEmpty()
    Page("Metas", feedback, onBack, header = {
        TopBar("Metas", busy = feedback.busy, onBack = onBack)
        // Units live in the dark header, as pills, like the prototype.
        if (state.goalUnits.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            @OptIn(ExperimentalLayoutApi::class) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                state.goalUnits.forEach { unit ->
                    val on = unit.id == state.goals?.kioskId
                    Text(unit.name, color = if (on) Color.White else Tokens.onDark2, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp),
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) Tokens.pink.copy(alpha = .16f) else Color.Transparent).border(1.dp, if (on) Tokens.pink else Tokens.onDark.copy(alpha = .14f), RoundedCornerShape(50)).selectable(on, !feedback.busy, Role.Tab) { selectedGoal = ""; preferences.edit().putString("unit:$owner", unit.id).apply(); vm.goals(unit.id) }.padding(horizontal = 13.dp, vertical = 8.dp))
                }
            }
        }
        goal?.let { target ->
            val summary = target.summary
            val scale = maxOf(summary.levels.maxOfOrNull { it.amount } ?: 0.0, 1.0)
            // Average ticket is not cumulative: cents matter and there is no pace to project.
            val amount: (Double) -> String = { if (summary.cumulative) money0(it) else moneyValue(it) }
            val mainTarget = summary.levels.firstOrNull()?.amount
            Spacer(Modifier.height(12.dp))
            Text("${unitName} · ${target.typeLabel}".uppercase(ptBR), color = Tokens.pink, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.Black))
            Text("${shortDate(target.startDate) ?: target.startDate} a ${shortDate(target.endDate) ?: target.endDate} · dia ${summary.elapsedDays} de ${summary.totalDays}", color = Tokens.onDark2, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    if (!summary.cumulative) Text("Ticket médio atual", color = Tokens.onDark3, style = MaterialTheme.typography.bodySmall)
                    Text(amount(summary.currentValue), color = Tokens.onDark, style = MaterialTheme.typography.headlineLarge.copy(fontSize = 32.sp, fontWeight = FontWeight.Black))
                }
                val projection = summary.projection
                if (projection != null && mainTarget != null && summary.elapsedDays > 0) {
                    val onPace = projection >= mainTarget
                    Text(if (onPace) "No ritmo" else "Atrás do ritmo", color = if (onPace) Color(0xFF7EE2A8) else Color(0xFFFDBA74), style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp, fontWeight = FontWeight.ExtraBold),
                        modifier = Modifier.padding(end = 8.dp, bottom = 6.dp).background((if (onPace) Color(0xFF7EE2A8) else Color(0xFFFDBA74)).copy(alpha = .14f), RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 4.dp))
                }
                Text(percentText(Math.round(summary.percentOfTarget).toDouble()), color = Tokens.onDark, style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp, fontWeight = FontWeight.Black))
            }
            Spacer(Modifier.height(8.dp))
            Box(Modifier.fillMaxWidth()) {
                AnimatedProgress((summary.currentValue / scale).toFloat(), height = 12, track = Tokens.track, fill = androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(Tokens.accent, Tokens.pink)))
                // White ticks mark where each level sits on the bar.
                androidx.compose.foundation.Canvas(Modifier.fillMaxWidth().height(12.dp)) { summary.levels.forEach { level -> val x = (level.amount / scale).toFloat().coerceIn(0f, 1f) * size.width - 2.dp.toPx(); drawRect(Color.White, androidx.compose.ui.geometry.Offset(x, 0f), androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height)) } }
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                summary.levels.forEach { level -> Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text((if (level.reached) "✓ " else "") + level.label, color = if (level.reached) Color(0xFF7EE2A8) else Tokens.onDark2, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp, fontWeight = FontWeight.Black))
                    Text(amount(level.amount), color = Tokens.onDark, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 13.sp))
                } }
            }
            Spacer(Modifier.height(8.dp))
            val facts = listOfNotNull(
                summary.nextLevel?.let { if (summary.cumulative) "Faltam ${money0(it.remaining)} para ${it.label}" else "O ticket precisa subir ${moneyValue(it.remaining)} para ${it.label}" } ?: "Todos os níveis batidos".takeIf { summary.levels.isNotEmpty() },
                "Ticket médio não acumula: vale a média do período até hoje".takeIf { !summary.cumulative },
                summary.neededDaily?.let { "Precisa de ${money0(it)} por dia nos ${summary.remainingDays} dias restantes" },
                summary.projection?.let { "No ritmo atual, fecha em ${money0(it)}" })
            facts.forEach { Text(it, color = Tokens.onDark2, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp), modifier = Modifier.padding(top = 2.dp)) }
        }
    }) {
        if (goals.size > 1) Choices("Meta", goals.map { it.id to "${it.typeLabel} · ${shortDate(it.startDate) ?: it.startDate} a ${shortDate(it.endDate) ?: it.endDate}" }, goal?.id.orEmpty()) { selectedGoal = it }
        if (state.goals == null && !feedback.busy) Text("Escolha a unidade para ver a meta em andamento.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.greyBg, RoundedCornerShape(12.dp)).padding(14.dp))
        if (state.goals != null && goals.isEmpty()) Text("Nenhuma meta em andamento em ${unitName.ifBlank { "esta unidade" }}.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.greyBg, RoundedCornerShape(12.dp)).padding(14.dp))
        goal?.let { target ->
            val today = state.goals?.today
            target.team.firstOrNull { it.isMe }?.let { me ->
                Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.pink.copy(alpha = .5f), RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("MINHA PARTE", color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.ExtraBold))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(money0(me.currentValue), style = MaterialTheme.typography.titleLarge.copy(fontSize = 24.sp), modifier = Modifier.weight(1f))
                        Text(percentText(Math.round(me.percent).toDouble()), style = MaterialTheme.typography.titleMedium)
                    }
                    AnimatedProgress((me.percent / 100).toFloat(), duration = 1000, height = 6, fill = androidx.compose.ui.graphics.SolidColor(if (me.percent >= 100) Tokens.ok else Tokens.accent))
                    val left = me.targetValue - me.currentValue
                    Text(if (left > 0) "Faltam ${money0(left)} para a sua meta de ${money0(me.targetValue)}" else "Sua meta de ${money0(me.targetValue)} foi batida", color = if (left > 0) Tokens.muted else Tokens.ok, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                    me.prize?.let { Text("Prêmio previsto: ${money0(it)}", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp)) }
                }
            }
            val todayRow = target.days.firstOrNull { it.date == today }
            val dailyTarget = target.summary.dailyTarget
            // A day outside the distribution (reachedDailyTarget == null) has no daily share to chase.
            if (todayRow != null && dailyTarget != null && dailyTarget > 0 && todayRow.reachedDailyTarget != null) {
                Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("HOJE NA UNIDADE", color = Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.ExtraBold), modifier = Modifier.weight(1f))
                        if (todayRow.value >= dailyTarget) StatusChip("Meta do dia batida", Tokens.ok, Tokens.okBg)
                    }
                    Text("${money0(todayRow.value)} de ${money0(dailyTarget)}", style = MaterialTheme.typography.titleMedium.copy(fontSize = 16.sp))
                    AnimatedProgress((todayRow.value / dailyTarget).toFloat(), duration = 800, height = 6, fill = androidx.compose.ui.graphics.SolidColor(if (todayRow.value >= dailyTarget) Tokens.ok else Tokens.accent))
                    if (todayRow.value < dailyTarget) Text("Faltam ${money0(dailyTarget - todayRow.value)} para a meta de hoje", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                }
            }
            // Segmented control: the selected tab is the white tile.
            Row(Modifier.fillMaxWidth().background(Tokens.segment, RoundedCornerShape(12.dp)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("days" to "Dias", "team" to "Equipe", "prize" to "Prêmio").forEach { (id, label) ->
                    val on = tab == id
                    Box(Modifier.weight(1f).heightIn(min = 36.dp).clip(RoundedCornerShape(9.dp)).background(if (on) Color.White else Color.Transparent).selectable(on, role = Role.Tab) { tab = id }, contentAlignment = Alignment.Center) { Text(label, color = if (on) Tokens.ink else Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, fontWeight = if (on) FontWeight.ExtraBold else FontWeight.Bold)) }
                }
            }
            if (tab == "days") {
                target.summary.dailyTarget?.let { Text(if (target.distributedBySchedule) "Meta por dia trabalhado da unidade: ${money0(it)}. Conta só os dias com escala; nos outros o resultado entra no total, mas não há meta do dia." else "Meta por dia da unidade: ${money0(it)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp)) }
                Text("Os valores abaixo são de toda a unidade, somando a equipe inteira. O seu resultado individual está em \"Minha parte\" e na aba Equipe.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                val ordered = target.days.sortedBy { it.date }
                if (ordered.size > 1) {
                    val top = maxOf(ordered.maxOf { it.value }, dailyTarget ?: 0.0, 1.0)
                    Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        // One bar per day; the dashed line is the daily share of the goal.
                        androidx.compose.foundation.Canvas(Modifier.fillMaxWidth().height(96.dp).semantics { contentDescription = "Gráfico do resultado da unidade por dia" }) {
                            val gap = 3.dp.toPx(); val width = ((size.width - gap * (ordered.size - 1)) / ordered.size).coerceAtLeast(1f)
                            ordered.forEachIndexed { index, row ->
                                val height = (row.value / top).toFloat().coerceIn(0f, 1f) * size.height
                                val color = when { row.date == today -> Tokens.pink; row.reachedDailyTarget == true -> Tokens.ok; row.reachedDailyTarget == null -> Color(0xFFB9B8C2); else -> Tokens.accent }
                                drawRoundRect(color, androidx.compose.ui.geometry.Offset(index * (width + gap), size.height - height), androidx.compose.ui.geometry.Size(width, height.coerceAtLeast(2.dp.toPx())), androidx.compose.ui.geometry.CornerRadius(2.dp.toPx()))
                            }
                            dailyTarget?.let { goal -> val y = size.height - (goal / top).toFloat() * size.height
                                drawLine(Tokens.ink, androidx.compose.ui.geometry.Offset(0f, y), androidx.compose.ui.geometry.Offset(size.width, y), 1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))) }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            listOf("Bateu a meta do dia" to Tokens.ok, "Abaixo" to Tokens.accent, "Hoje" to Tokens.pink).forEach { (label, color) -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { Box(Modifier.size(8.dp).background(color, RoundedCornerShape(2.dp))); Text(label, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp)) } }
                        }
                    }
                }
                Text("Resultado da unidade por dia", style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 2.dp)) {
                    if (target.days.isEmpty()) Text("Ainda não há resultado lançado neste período.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 12.dp))
                    target.days.sortedByDescending { it.date }.forEachIndexed { index, row ->
                        val isToday = row.date == today
                        if (index > 0) HorizontalDivider(color = Tokens.border)
                        Row(Modifier.fillMaxWidth().padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(runCatching { LocalDate.parse(row.date).format(DateTimeFormatter.ofPattern("EEE dd/MM", ptBR)).replace(".", "") }.getOrDefault(row.date), style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.5.sp))
                            if (isToday) StatusChip("hoje", Tokens.wine, Tokens.accentSoft)
                            Text(money0(row.value), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, fontSize = 14.5.sp), textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                            Text(when { isToday -> "…"; row.reachedDailyTarget == true -> "✓"; else -> "·" }, color = when { isToday -> Tokens.faint; row.reachedDailyTarget == true -> Tokens.ok; else -> Color(0xFFB9B8C2) }, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), modifier = Modifier.width(18.dp), textAlign = TextAlign.Center)
                        }
                    }
                }
            }
            if (tab == "team") {
                Text("Resultado da equipe", style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 2.dp)) {
                    if (target.team.isEmpty()) Text("Nenhuma pessoa vinculada a esta meta.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 12.dp))
                    target.team.forEachIndexed { index, member ->
                        if (index > 0) HorizontalDivider(color = Tokens.border)
                        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                PersonBadge(member.name, member.avatarUrl, index, member.color, 32)
                                Text("${member.name}${if (member.isMe) " · você" else ""}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                                Text(percentText(Math.round(member.percent).toDouble()), style = MaterialTheme.typography.titleMedium)
                            }
                            AnimatedProgress((member.percent / 100).toFloat(), duration = 1000, height = 6, fill = androidx.compose.ui.graphics.SolidColor(if (member.percent >= 100) Tokens.ok else Tokens.accent))
                            Text("${money0(member.currentValue)} de ${money0(member.targetValue)}${when (member.role) { "leader" -> " · Liderança"; "relief" -> " · Folguista"; "fixed" -> ""; else -> " · ${member.role}" }}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                            member.prize?.let { Text("Prêmio previsto: ${money0(it)}", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp)) }
                        }
                    }
                }
            }
            if (tab == "prize") target.prize?.let { prize ->
                Column(Modifier.fillMaxWidth().background(Color.White, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(money0(prize.totalTeamBonus), style = MaterialTheme.typography.headlineLarge.copy(fontSize = 30.sp, fontWeight = FontWeight.Black))
                    Text("Prêmio previsto da equipe · ${prize.methodName}${if (prize.leadershipBonus > 0) " · liderança: ${money0(prize.leadershipBonus)}" else ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                    Text((prize.highestTierLabel?.let { "Faixa atual: $it" } ?: "Nenhuma faixa atingida ainda") + (prize.nextTier?.let { " · faltam ${money0(it.remaining)} para ${it.label}" } ?: ""), color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                    prize.tiers.forEach { tier ->
                        val current = tier.label == prize.highestTierLabel
                        Row(Modifier.fillMaxWidth().background(if (current) Tokens.accentSoft else Tokens.soft, RoundedCornerShape(12.dp)).border(if (current) 2.dp else 1.dp, if (current) Tokens.accent else Tokens.border, RoundedCornerShape(12.dp)).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.size(22.dp).background(if (tier.reached) Tokens.okBg else Tokens.greyBg, androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) { if (tier.reached) Text("✓", color = Tokens.ok, style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp, letterSpacing = 0.sp)) }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(tier.label, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                                Text("a partir de ${money0(tier.fromAmount)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                                Text("${money0(tier.fixedBonusAmount)} fixo${if (tier.excessPercent > 0) " + ${percentText(tier.excessPercent)} do que passar" else ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    prize.message?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                    Text("Previsão com o faturamento de hoje. O valor final é apurado no encerramento da meta e o de cada pessoa está na aba Equipe.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp))
                }
            }
            if (tab == "prize" && target.prize == null) Text("Nenhum prêmio informado para esta meta.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.greyBg, RoundedCornerShape(12.dp)).padding(14.dp))
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
