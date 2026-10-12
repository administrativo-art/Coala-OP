package com.coalaone.go.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules

/** Green confirmation card the prototype shows above a list after an action. */
@Composable private fun DoneCard(title: String, text: String) {
    Column(Modifier.fillMaxWidth().background(Tokens.okBg, RoundedCornerShape(14.dp)).border(1.dp, Tokens.okBorder, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (title.isNotBlank()) Text(title, color = Tokens.okInk, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
        Text(text, color = Tokens.okInk, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
    }
}
/** Unit row of the prototype: name, what is going on there and the action in words; the badge carries the unit initials. */
@Composable fun UnitRow(name: String, meta: String, action: String, highlight: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Card(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Tokens.border), colors = CardDefaults.cardColors(containerColor = Tokens.surface, disabledContainerColor = Tokens.surface)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(44.dp).background(if (highlight) Tokens.accentSoft else Tokens.soft, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) { Text(unitInitials(name), color = if (highlight) Tokens.wine else Tokens.ink, style = MaterialTheme.typography.titleMedium) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(name, style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.5.sp))
                Text(meta, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            Text(action, color = if (highlight) Tokens.wine else Tokens.ink, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.5.sp))
        }
    }
}
@Composable fun CountScreen(vm: CountViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var confirm by rememberSaveable { mutableStateOf(false) }; var cancel by rememberSaveable { mutableStateOf(false) }
    var enlarged by rememberSaveable { mutableStateOf("") }
    val session = state.session
    val back = { if (session != null) vm.leave(onBack) else onBack(); Unit }
    BackHandler { if (!feedback.busy) back() }
    val words = state.search.trim().lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
    val changedCount = session?.items.orEmpty().count { state.drafts[it.lotId]?.let(Rules::changed) == true }
    // The prototype searches by supply or lot and filters lot by lot.
    val groups = session?.items.orEmpty().filter { item -> (!state.onlyChanged || state.drafts[item.lotId]?.let(Rules::changed) == true) && words.all { "${item.productName} ${item.lotNumber}".lowercase().contains(it) } }.groupBy { it.productName }.entries.toList()
    val steps = maxOf(1, (groups.size + 2) / 3); val step = state.step.coerceAtMost(steps - 1)
    val last = step == steps - 1; val filtered = state.search.isNotBlank() || state.onlyChanged
    Page("Contagem de estoque", feedback, back, footer = if (session == null) null else ({
        if (confirm) Column(Modifier.fillMaxWidth().background(Tokens.amberBg, RoundedCornerShape(14.dp)).border(1.dp, Tokens.amberBorder, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Concluir a contagem de ${session.kioskName}? ${if (changedCount == 0) "Nenhum lote será ajustado." else if (changedCount == 1) "1 lote terá o estoque ajustado." else "$changedCount lotes terão o estoque ajustado."} Depois de concluída, não é possível alterar pelo aplicativo.", color = Tokens.amberInk, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
            FooterPair("Voltar", !feedback.busy, { confirm = false }, "Concluir", !feedback.busy) { vm.save(true); confirm = false }
        } else if (cancel) InlineConfirmation("Cancelar esta contagem? Os ajustes ainda não chegaram ao estoque.", feedback.busy, { cancel = false }, "Cancelar contagem") { vm.cancel(); cancel = false }
        else {
            FooterPair("Anterior", step > 0 && !feedback.busy, { vm.step(step - 1) }, if (last) "Concluir contagem" else "Próximo", !feedback.busy && !(last && filtered)) { if (last) confirm = true else vm.step(step + 1) }
            if (last && filtered) Text("Limpe a busca e volte para \"Todos\" para concluir a contagem.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            TextButton({ cancel = true }, enabled = !feedback.busy, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Cancelar contagem", color = Tokens.danger) }
        }
    }), header = if (session != null) ({ StepHeader(session.kioskName, "", step, steps, feedback.busy, back, backLabel = "Salvar e sair", kicker = "Contagem de estoque", aside = if (changedCount == 1) "1 lote com lançamento" else "$changedCount lotes com lançamento") }) else null, onRefresh = { vm.refresh() }) {
        if (session == null) {
            if (state.completed) DoneCard("Contagem concluída", "Os ajustes foram lançados no estoque da unidade.")
            Text("Escolha a unidade. A contagem parte da quantidade que o sistema tem agora em cada lote.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
            state.context?.let { context ->
                val open = context.openSessions.associateBy { it.kioskId }
                if (context.units.isEmpty() && open.isEmpty()) EmptyState("Nenhuma unidade disponível", "Seu perfil não tem unidade liberada para contagem.")
                // Units with a count under way come first; a unit never shows twice.
                context.openSessions.forEach { row -> UnitRow(row.kioskName, listOfNotNull("Contagem em andamento", shortDate(row.startedAt)?.let { "iniciada em $it" }, "${row.itemCount} lotes").joinToString(" · "), "Continuar", true, !feedback.busy) { vm.open(row.kioskId) } }
                context.units.filter { it.id !in open }.forEach { unit -> UnitRow(unit.name, "Nenhuma contagem em andamento", "Iniciar", false, !feedback.busy) { vm.open(unit.id) } }
            }
        } else if (confirm) {
            // Everything that will change in stock, in one list, before the count is concluded.
            val changed = session.items.mapNotNull { item -> state.drafts[item.lotId]?.takeIf(Rules::changed)?.let { item to it } }
            Text("Resumo da contagem", style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp))
            Text(if (changed.isEmpty()) "Nenhum lote foi alterado. Concluir registra que o estoque confere com o sistema." else "Confira os ${changed.size} ${if (changed.size == 1) "lote alterado" else "lotes alterados"} antes de concluir. Para corrigir, toque em Voltar.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
            if (changed.isNotEmpty()) Column(Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 2.dp)) {
                changed.forEachIndexed { index, (item, draft) ->
                    val exit = Rules.quantity(draft.exit); val entry = Rules.quantity(draft.entry)
                    if (index > 0) HorizontalDivider(color = Tokens.border)
                    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(item.productName, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp), modifier = Modifier.weight(1f))
                            Text("${Rules.quantityText(item.systemQuantity)} → ${Rules.quantityText(item.systemQuantity - exit + entry)} ${item.displayUnit}", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp))
                        }
                        Text("Lote ${item.lotNumber}", color = Tokens.faint, style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont, fontSize = 11.sp))
                        if (exit > 0) Text("Saída de ${Rules.quantityText(exit)} ${item.displayUnit} · ${state.context?.exitReasons?.firstOrNull { it.value == draft.reason }?.label ?: "motivo não informado"}${draft.exitNotes.takeIf(String::isNotBlank)?.let { " · $it" } ?: ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                        if (entry > 0) Text("Sobra de ${Rules.quantityText(entry)} ${item.displayUnit}${draft.entryNotes.takeIf(String::isNotBlank)?.let { " · $it" } ?: ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                    }
                }
            }
        } else {
            if (step == 0) Text("Confira cada insumo. Se a quantidade bater com a do sistema, só avance; se não, lance a saída do turno (com o motivo) ou a sobra encontrada.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
            LabeledInput("", state.search, placeholder = "Buscar insumo ou lote") { vm.filters(it, state.onlyChanged) }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PillChoice("Todos", !state.onlyChanged) { vm.filters(state.search, false) }
                PillChoice("Só com lançamento · $changedCount", state.onlyChanged) { vm.filters(state.search, true) }
            }
            if (groups.isEmpty()) Text(if (state.onlyChanged) "Nenhum lote com lançamento ainda." else "Nenhum insumo encontrado com essa busca.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.greyBg, RoundedCornerShape(12.dp)).padding(14.dp))
            groups.drop(step * 3).take(3).forEach { (name, items) ->
                val photo = items.firstOrNull { it.imageUrl != null }?.imageUrl
                Column(Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(18.dp)).border(1.dp, Tokens.border, RoundedCornerShape(18.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.clip(RoundedCornerShape(12.dp)).clickable(enabled = photo != null, role = Role.Button, onClickLabel = "Ampliar a foto") { enlarged = if (enlarged == name) "" else name }) { ProductPhoto(photo, name, 64) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(name, style = MaterialTheme.typography.titleMedium)
                            items.firstOrNull { it.countingInstruction != null }?.countingInstruction?.let { Text("Como contar: $it", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    if (enlarged == name && photo != null) Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClickLabel = "Fechar a foto") { enlarged = "" }) { ProductPhoto(photo, name, 200) }
                    items.forEach { item ->
                        val draft = state.drafts[item.lotId] ?: Rules.draft(item)
                        val exit = Rules.quantity(draft.exit); val entry = Rules.quantity(draft.entry); val changed = exit > 0 || entry > 0
                        val final = item.systemQuantity - exit + entry
                        val problem = when { !changed -> ""; final < 0 -> "A saída é maior que a quantidade em estoque."; exit > 0 && draft.reason == "SAIDA_DESCARTE_OUTROS" && draft.exitNotes.trim().length < 3 -> "Descreva o motivo da saída marcada como Outros."; else -> "" }
                        val line = when { problem.isNotBlank() -> Tokens.danger; changed -> Tokens.accent; else -> Tokens.border }
                        Column(Modifier.fillMaxWidth().background(when { problem.isNotBlank() -> Tokens.problemBg; changed -> Tokens.changedBg; else -> Tokens.soft }, RoundedCornerShape(14.dp)).border(if (changed) 2.dp else 1.dp, line, RoundedCornerShape(14.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                            Text("Lote ${item.lotNumber}${item.expiryDate?.let { " · val. ${fullDate(it)}" } ?: ""}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont, fontSize = 11.5.sp))
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text("Sistema: ", style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
                                Text("${Rules.quantityText(item.systemQuantity)} ${item.displayUnit}", style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold), modifier = Modifier.weight(1f))
                                Text(if (changed) "Final: ${Rules.quantityText(final)} ${item.displayUnit}" else "Sem alteração", color = when { problem.isNotBlank() -> Tokens.danger; changed -> Tokens.wine; else -> Tokens.faint }, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp, fontWeight = if (changed) FontWeight.ExtraBold else FontWeight.SemiBold))
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                LabeledInput("Saída do turno", draft.exit, !feedback.busy, decimal = true, placeholder = "0", modifier = Modifier.weight(1f)) { vm.edit(item.lotId, draft.copy(exit = it)) }
                                LabeledInput("Sobra encontrada", draft.entry, !feedback.busy, decimal = true, placeholder = "0", modifier = Modifier.weight(1f)) { vm.edit(item.lotId, draft.copy(entry = it)) }
                            }
                            // Reason and notes only matter once something left or was found in the lot.
                            if (exit > 0) {
                                @OptIn(ExperimentalLayoutApi::class) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    state.context?.exitReasons.orEmpty().forEach { reason -> PillChoice(reason.label, draft.reason == reason.value, !feedback.busy, accent = true) { vm.edit(item.lotId, draft.copy(reason = reason.value)) } }
                                }
                                LabeledInput("", draft.exitNotes, !feedback.busy, placeholder = if (draft.reason == "SAIDA_DESCARTE_OUTROS") "Descreva o motivo (obrigatório)" else "Observação (opcional)") { vm.edit(item.lotId, draft.copy(exitNotes = it.take(240))) }
                            }
                            if (entry > 0) LabeledInput("", draft.entryNotes, !feedback.busy, placeholder = "Observação da sobra (opcional)") { vm.edit(item.lotId, draft.copy(entryNotes = it.take(240))) }
                            if (problem.isNotBlank()) Text(problem, color = Tokens.danger, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp))
                            if (changed) Text("Limpar lançamentos deste lote", color = Tokens.wine, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp), modifier = Modifier.clickable(enabled = !feedback.busy, role = Role.Button) { vm.edit(item.lotId, draft.copy(exit = "", entry = "", exitNotes = "", entryNotes = "")) }.padding(vertical = 4.dp))
                        }
                    }
                }
            }
        }
    }
}
@Composable fun ReceiveScreen(vm: ReceiveViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var confirm by rememberSaveable { mutableStateOf(false) }
    val back = { if (state.activity != null) vm.back() else onBack() }
    BackHandler { if (!feedback.busy) back() }
    val activity = state.activity
    val groups = activity?.rows.orEmpty().groupBy { it.productName }.entries.toList(); val steps = maxOf(1, (groups.size + 2) / 3); val step = state.step.coerceAtMost(steps - 1)
    val different = activity?.rows.orEmpty().count { row -> state.drafts[Rules.receiptKey(row)]?.let { Rules.quantity(it.first) != row.sentQuantity } == true }
    Page("Recebimento", feedback, back, footer = if (activity == null) null else ({
        if (confirm) InlineConfirmation("Confirmar recebimento em ${activity.destinationName}? Depois não é possível alterar pelo aplicativo.", feedback.busy, { confirm = false }, "Confirmar recebimento") { vm.confirm(); confirm = false }
        else FooterPair("Anterior", step > 0 && !feedback.busy, { vm.step(step - 1) }, if (step < steps - 1) "Próximo" else "Confirmar recebimento", !feedback.busy) { if (step < steps - 1) vm.step(step + 1) else confirm = true }
    }), header = if (activity != null) ({ TopBar("Recebimento", listOfNotNull("${activity.originName} → ${activity.destinationName}", shortDate(activity.dispatchedAt)?.let { "despachada em $it" }).joinToString(" · "), feedback.busy, back) }) else null, onRefresh = { vm.refresh() }) {
        if (activity == null) {
            if (state.list?.activities?.isEmpty() == true) EmptyState("Nenhuma reposição a receber", "Quando o centro de distribuição enviar uma reposição, ela aparece aqui.")
            else if (state.list != null) Text("Escolha a reposição que chegou para conferir as quantidades.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
            if (state.list?.truncated == true) Text("Há mais reposições em trânsito. Receba as mais antigas primeiro.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
            state.list?.activities.orEmpty().forEach { row ->
                UnitRow(row.destinationName, listOfNotNull("De ${row.originName}", "${row.rows.size} lotes", shortDate(row.dispatchedAt)?.let { "despachada em $it" }).joinToString(" · "), "Conferir", true, !feedback.busy) { vm.open(row) }
            }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Text("Etapa ${step + 1} de $steps", style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp), modifier = Modifier.weight(1f))
                Text(when (different) { 0 -> "Tudo confere"; 1 -> "1 lote com diferença"; else -> "$different lotes com diferença" }, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) { repeat(steps) { index -> Box(Modifier.weight(1f).height(4.dp).background(if (index <= step) Tokens.accent else Tokens.border, RoundedCornerShape(4.dp))) } }
            Text("A quantidade recebida já vem igual à enviada. Altere só o que chegou diferente e explique o motivo.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            groups.drop(step * 3).take(3).forEach { (name, rows) ->
                val differs = rows.any { row -> Rules.quantity(state.drafts.getValue(Rules.receiptKey(row)).first) != row.sentQuantity }
                Column(Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(16.dp)).border(if (differs) 2.dp else 1.dp, if (differs) Tokens.warning else Tokens.border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ProductPhoto(rows.firstOrNull { it.imageUrl != null }?.imageUrl, name)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                            Text(name, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                            if (rows.size == 1) Text(rows[0].lotNumber, color = Tokens.faint, style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont, fontSize = 11.sp))
                        }
                        if (differs) StatusChip("Diferença", Tokens.warning, Tokens.warningBg)
                    }
                    rows.forEach { row ->
                        val key = Rules.receiptKey(row); val draft = state.drafts.getValue(key); val off = Rules.quantity(draft.first) != row.sentQuantity
                        if (rows.size > 1) Text(row.lotNumber, color = Tokens.faint, style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont, fontSize = 11.sp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("Enviado", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold))
                                Text(Rules.quantityText(row.sentQuantity), style = MaterialTheme.typography.titleMedium.copy(fontSize = 16.sp), modifier = Modifier.padding(top = 14.dp))
                            }
                            LabeledInput("Recebido", draft.first, !feedback.busy, decimal = true, alert = if (off) Tokens.warning else null, modifier = Modifier.weight(1f)) { vm.edit(key, it, draft.second) }
                        }
                        if (off) LabeledInput("", draft.second, !feedback.busy, placeholder = "Explique a divergência (obrigatório)") { vm.edit(key, draft.first, it.take(240)) }
                    }
                }
            }
        }
    }
}
