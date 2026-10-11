package com.coalaone.go.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules

@Composable fun CountScreen(vm: CountViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    var confirm by rememberSaveable { mutableStateOf(false) }; var cancel by rememberSaveable { mutableStateOf(false) }
    val session = state.session
    val back = { if (session != null) vm.leave(onBack) else onBack(); Unit }
    BackHandler { if (!feedback.busy) back() }
    val groups = session?.items.orEmpty().filter { it.productName.contains(state.search, ignoreCase = true) && (!state.onlyChanged || state.drafts[it.lotId]?.let(Rules::changed) == true) }.groupBy { it.productName }.entries.toList()
    val steps = maxOf(1, (groups.size + 2) / 3); val step = state.step.coerceAtMost(steps - 1)
    Page("Contagem de estoque", feedback, back, footer = {
        if (session != null) {
            if (confirm) InlineConfirmation("Concluir a contagem e aplicar os ajustes?", feedback.busy, { confirm = false }, "Concluir contagem") { vm.save(true); confirm = false }
            else if (cancel) InlineConfirmation("Cancelar esta contagem? Os ajustes ainda não chegaram ao estoque.", feedback.busy, { cancel = false }, "Cancelar contagem") { vm.cancel(); cancel = false }
            else {
                if (step < steps - 1) Action("Próxima etapa", feedback.busy) { vm.step(step + 1) } else Action("Concluir contagem", feedback.busy) { confirm = true }
                if (step > 0) Action("Etapa anterior", feedback.busy, secondary = true) { vm.step(step - 1) }
                TextButton({ cancel = true }, enabled = !feedback.busy) { Text("Cancelar contagem", color = Tokens.danger) }
            }
        }
    }, header = if (session != null) ({ StepHeader("Contagem de estoque", session.kioskName, step, steps, feedback.busy, back, backLabel = "Salvar e sair") }) else null, onRefresh = { vm.refresh() }) {
        if (session == null) {
            state.context?.let { context ->
                val resuming = context.openSessions.map { it.kioskId }.toSet()
                val fresh = context.units.filter { it.id !in resuming }
                if (context.units.isEmpty() && context.openSessions.isEmpty()) EmptyState("Nenhuma unidade disponível", "Seu perfil não tem unidade liberada para contagem.")
                if (context.openSessions.isNotEmpty()) {
                    SectionLabel("Em andamento")
                    context.openSessions.forEach { open -> ListRow(open.kioskName, listOfNotNull("${open.itemCount} lotes", shortDate(open.startedAt)?.let { "iniciada em $it" }).joinToString(" · "), !feedback.busy, badge = "Retomar", highlight = true) { vm.open(open.kioskId) } }
                }
                if (fresh.isNotEmpty()) {
                    SectionLabel(if (context.openSessions.isEmpty()) "Escolha a unidade" else "Outras unidades")
                    fresh.forEach { unit -> ListRow(unit.name, "Iniciar contagem", !feedback.busy) { vm.open(unit.id) } }
                }
            }
        } else {
            Text("O rascunho fica protegido neste aparelho.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            Field("Buscar insumo", state.search) { vm.filters(it, state.onlyChanged) }
            CheckRow("Somente alterados", state.onlyChanged) { vm.filters(state.search, it) }
            if (groups.isEmpty()) EmptyState("Nenhum insumo encontrado", "Revise a busca ou desmarque \"Somente alterados\".")
            groups.drop(step * 3).take(3).forEach { (name, items) -> CardBlock(selected = items.any { state.drafts[it.lotId]?.let(Rules::changed) == true }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ProductPhoto(items.firstOrNull { it.imageUrl != null }?.imageUrl, name, 56)
                    Column { Text(name, style = MaterialTheme.typography.titleMedium); items.firstOrNull { it.countingInstruction != null }?.countingInstruction?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) } }
                }
                items.forEach { item ->
                    val draft = state.drafts[item.lotId] ?: Rules.draft(item)
                    val exit = Rules.quantity(draft.exit); val entry = Rules.quantity(draft.entry)
                    HorizontalDivider(color = Tokens.border)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Lote ${item.lotNumber}", style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont))
                            Text(item.expiryDate?.let { "Validade ${fullDate(it)}" } ?: "Sem validade", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("No sistema", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                            Text("${Rules.quantityText(item.systemQuantity)} ${item.displayUnit}", style = MaterialTheme.typography.titleMedium)
                        }
                    }
                    QuantityField("Saída (${item.displayUnit})", draft.exit, !feedback.busy) { vm.edit(item.lotId, draft.copy(exit = it)) }
                    // Reason and notes only matter once something left or entered the lot.
                    if (exit > 0) {
                        Choices("Motivo", state.context?.exitReasons.orEmpty().map { it.value to it.label }, draft.reason, !feedback.busy) { vm.edit(item.lotId, draft.copy(reason = it)) }
                        Field("Observação da saída${if (draft.reason == "SAIDA_DESCARTE_OUTROS") " (obrigatória)" else ""}", draft.exitNotes, !feedback.busy) { vm.edit(item.lotId, draft.copy(exitNotes = it.take(240))) }
                    }
                    QuantityField("Entrada (${item.displayUnit})", draft.entry, !feedback.busy) { vm.edit(item.lotId, draft.copy(entry = it)) }
                    if (entry > 0) Field("Observação da entrada", draft.entryNotes, !feedback.busy) { vm.edit(item.lotId, draft.copy(entryNotes = it.take(240))) }
                    if (exit > 0 || entry > 0) Text("Quantidade final: ${Rules.quantityText(item.systemQuantity - exit + entry)} ${item.displayUnit}", color = Tokens.accent, style = MaterialTheme.typography.titleMedium)
                }
            } }
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
    Page("Recebimento", feedback, back, footer = {
        if (activity != null) {
            if (confirm) InlineConfirmation("Confirmar recebimento em ${activity.destinationName}? Depois não é possível alterar pelo aplicativo.", feedback.busy, { confirm = false }, "Confirmar recebimento") { vm.confirm(); confirm = false }
            else if (step < steps - 1) Action("Próxima etapa", feedback.busy) { vm.step(step + 1) }
            else Action("Confirmar recebimento", feedback.busy) { confirm = true }
            if (step > 0) Action("Etapa anterior", feedback.busy, secondary = true) { vm.step(step - 1) }
        }
    }, header = if (activity != null) ({ StepHeader("Recebimento", "${activity.originName} → ${activity.destinationName}", step, steps, feedback.busy, back) }) else null, onRefresh = { vm.refresh() }) {
        if (activity == null) {
            if (state.list?.activities?.isEmpty() == true) EmptyState("Nenhuma reposição a receber", "Quando o centro de distribuição enviar uma reposição, ela aparece aqui.")
            if (state.list?.truncated == true) Text("Há mais reposições em trânsito. Receba as mais antigas primeiro.")
            if (state.list?.activities?.isNotEmpty() == true) SectionLabel("Aguardando conferência")
            state.list?.activities.orEmpty().forEach { row ->
                ListRow(row.destinationName, listOfNotNull("De ${row.originName}", "${row.rows.size} lotes", shortDate(row.dispatchedAt)?.let { "enviada em $it" }).joinToString(" · "), !feedback.busy) { vm.open(row) }
            }
        } else {
            Text("Confira a quantidade recebida. Altere e explique somente o que chegou diferente.", color = Tokens.muted)
            groups.drop(step * 3).take(3).forEach { (name, rows) -> CardBlock {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { ProductPhoto(rows.firstOrNull { it.imageUrl != null }?.imageUrl, name); Text(name, style = MaterialTheme.typography.titleMedium) }
                rows.forEach { row ->
                    val key = Rules.receiptKey(row); val draft = state.drafts.getValue(key)
                    HorizontalDivider(color = Tokens.border)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Lote ${row.lotNumber}", style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont), modifier = Modifier.weight(1f))
                        Column(horizontalAlignment = Alignment.End) { Text("Enviado", color = Tokens.muted, style = MaterialTheme.typography.bodySmall); Text(Rules.quantityText(row.sentQuantity), style = MaterialTheme.typography.titleMedium) }
                    }
                    QuantityField("Recebido", draft.first, !feedback.busy, emptyAtZero = false) { vm.edit(key, it, draft.second) }
                    if (Rules.quantity(draft.first) != row.sentQuantity) {
                        Text("Quantidade diferente da enviada", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                        Field("Explique a divergência (obrigatório)", draft.second, !feedback.busy) { vm.edit(key, draft.first, it.take(240)) }
                    }
                }
            } }
        }
    }
}
