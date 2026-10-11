package com.coalaone.go.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
    }, header = if (session != null) ({ StepHeader("Contagem de estoque", session.kioskName, step, steps, feedback.busy, back, backLabel = "Salvar e sair") }) else null) {
        if (session == null) {
            Action("Atualizar unidades", feedback.busy, secondary = true) { vm.refresh() }
            state.context?.let { context ->
                if (context.units.isEmpty()) Text("Nenhuma unidade disponível para contagem.")
                context.openSessions.forEach { open -> CardBlock { Text("Retomar: ${open.kioskName} · ${open.itemCount} lotes"); Action("Retomar contagem", feedback.busy, secondary = true) { vm.open(open.kioskId) } } }
                context.units.forEach { unit -> Action("Contar ${unit.name}", feedback.busy, secondary = true) { vm.open(unit.id) } }
            }
        } else {
            Text(session.kioskName, style = MaterialTheme.typography.titleMedium)
            Text("Etapa ${step + 1} de $steps · O rascunho é protegido no aparelho.")
            Field("Buscar insumo", state.search) { vm.filters(it, state.onlyChanged) }
            Row { Checkbox(state.onlyChanged, { vm.filters(state.search, it) }); Text("Somente alterados") }
            if (groups.isEmpty()) Text("Nenhum insumo corresponde aos filtros.")
            groups.drop(step * 3).take(3).forEach { (name, items) -> CardBlock(selected = items.any { state.drafts[it.lotId]?.let(Rules::changed) == true }) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { ProductPhoto(items.firstOrNull { it.imageUrl != null }?.imageUrl, name, 64); Text(name, style = MaterialTheme.typography.titleMedium) }
                items.firstOrNull { it.countingInstruction != null }?.countingInstruction?.let { Text(it) }
                items.forEach { item ->
                    val draft = state.drafts[item.lotId] ?: Rules.draft(item)
                    Text("Lote ${item.lotNumber} · ${item.expiryDate ?: "sem validade"} · ${Rules.quantityText(item.systemQuantity)} ${item.displayUnit}", style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) { Field("Saída (${item.displayUnit})", draft.exit, !feedback.busy, decimal = true) { vm.edit(item.lotId, draft.copy(exit = it)) } }
                        Column(Modifier.weight(1f)) { Field("Entrada (${item.displayUnit})", draft.entry, !feedback.busy, decimal = true) { vm.edit(item.lotId, draft.copy(entry = it)) } }
                    }
                    Choices("Motivo", state.context?.exitReasons.orEmpty().map { it.value to it.label }, draft.reason, !feedback.busy) { vm.edit(item.lotId, draft.copy(reason = it)) }
                    Field("Observação da saída${if (draft.reason == "SAIDA_DESCARTE_OUTROS") " (obrigatória)" else ""}", draft.exitNotes, !feedback.busy) { vm.edit(item.lotId, draft.copy(exitNotes = it.take(240))) }
                    Field("Observação da entrada", draft.entryNotes, !feedback.busy) { vm.edit(item.lotId, draft.copy(entryNotes = it.take(240))) }
                    Text("Quantidade final: ${Rules.quantityText(item.systemQuantity - Rules.quantity(draft.exit) + Rules.quantity(draft.entry))}", style = MaterialTheme.typography.titleMedium)
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
    }, header = if (activity != null) ({ StepHeader("Recebimento", "${activity.originName} → ${activity.destinationName}", step, steps, feedback.busy, back) }) else null) {
        if (activity == null) {
            Action("Atualizar reposições", feedback.busy, secondary = true) { vm.refresh() }
            if (state.list?.activities?.isEmpty() == true) Text("Nenhuma reposição aguardando recebimento.")
            if (state.list?.truncated == true) Text("Há mais reposições em trânsito. Receba as mais antigas primeiro.")
            state.list?.activities.orEmpty().forEach { row -> CardBlock {
                Text(row.destinationName, style = MaterialTheme.typography.titleMedium); Text("De ${row.originName} · ${row.rows.size} lotes · ${row.dispatchedAt.orEmpty()}")
                Action("Conferir recebimento", feedback.busy, secondary = true) { vm.open(row) }
            } }
        } else {
            Text("${activity.originName} → ${activity.destinationName}"); Text("Etapa ${step + 1} de $steps")
            Text("Confira a quantidade recebida. Altere e explique somente o que chegou diferente.")
            groups.drop(step * 3).take(3).forEach { (name, rows) -> CardBlock {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { ProductPhoto(rows.firstOrNull { it.imageUrl != null }?.imageUrl, name); Text(name, style = MaterialTheme.typography.titleMedium) }
                rows.forEach { row ->
                    val key = Rules.receiptKey(row); val draft = state.drafts.getValue(key)
                    Text("Lote ${row.lotNumber} · enviado ${Rules.quantityText(row.sentQuantity)}", style = MaterialTheme.typography.bodySmall.copy(fontFamily = CodeFont))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Column(Modifier.weight(1f)) { Text("Enviado", color = Tokens.muted, style = MaterialTheme.typography.bodySmall); Text(Rules.quantityText(row.sentQuantity), style = MaterialTheme.typography.titleLarge) }
                        Column(Modifier.weight(1f)) { Field("Recebido", draft.first, !feedback.busy, decimal = true) { vm.edit(key, it, draft.second) } }
                    }
                    if (Rules.quantity(draft.first) != row.sentQuantity) {
                        Text("Quantidade diferente da enviada", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                        Field("Explique a divergência (obrigatório)", draft.second, !feedback.busy) { vm.edit(key, draft.first, it.take(240)) }
                    }
                }
            } }
        }
    }
}
