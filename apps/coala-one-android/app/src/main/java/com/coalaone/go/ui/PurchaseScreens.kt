package com.coalaone.go.ui

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules

private fun centsText(value: Long) = java.math.BigDecimal.valueOf(value, 2).toPlainString().replace('.', ',')
// Keep incomplete decimal input ("12,") separate from the numeric DTO. Formatting
// on every keystroke moves the cursor and prevents entering fractional values.
@Composable private fun ReviewDecimal(label: String, initial: String, enabled: Boolean, onChange: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    Field(label, text, enabled, decimal = true) { next ->
        if (next.matches(Regex("[0-9.,]*"))) { text = next; onChange(next) }
    }
}
/** One document of the purchase (note or payment proof): what is attached and the two ways to add more. */
@Composable private fun DocumentCard(title: String, subtitle: String, docs: List<Document>, enabled: Boolean, onAdd: (Document) -> Unit, onRemove: (Int) -> Unit) {
    val actions = rememberCaptureActions(onDocument = onAdd)
    val empty = docs.isEmpty(); val full = docs.size >= 2
    Column(Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(16.dp)).border(if (empty) 1.5.dp else 1.dp, if (empty) Tokens.fieldBorder else Tokens.border, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                Text(subtitle, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            if (!empty) StatusChip("${docs.size} DE 2", Tokens.ok, Tokens.okBg)
        }
        docs.forEachIndexed { index, doc ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(40.dp, 50.dp).background(Tokens.soft, RoundedCornerShape(8.dp)).border(1.dp, Tokens.fieldBorder, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) { Text(if (doc.mimeType == "application/pdf") "PDF" else "IMG", color = Tokens.faint, style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, letterSpacing = 0.sp)) }
                Column(Modifier.weight(1f)) {
                    Text(doc.name, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 13.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${doc.bytes.size / 1024} KB", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                }
                Text("Remover", color = Tokens.danger, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp), modifier = Modifier.clickable(enabled = enabled, role = Role.Button, onClickLabel = "Remover ${doc.name}") { onRemove(index) }.padding(8.dp))
            }
        }
        if (!full) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { Action(if (empty) "Fotografar" else "+ Outra imagem", enabled = enabled, secondary = !empty, onClick = actions.photograph) }
            Box(Modifier.weight(1f)) { Action(if (empty) "Arquivo" else "+ Outro arquivo", enabled = enabled, secondary = true, onClick = actions.pickFile) }
        }
        if (!empty && !full) Text("Não coube em uma foto? Adicione a segunda imagem do mesmo documento.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp))
        actions.error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
    }
}
@Composable private fun ChoiceCard(kicker: String, title: String, text: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Card(onClick = onClick, enabled = enabled, modifier = modifier, shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Tokens.border), colors = CardDefaults.cardColors(containerColor = Tokens.surface, disabledContainerColor = Tokens.surface)) {
        Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(kicker, color = Tokens.wine, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.ExtraBold))
            Text(title, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.5.sp))
            Text(text, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp))
        }
    }
}
@OptIn(ExperimentalFoundationApi::class)
@Composable fun PurchaseScreen(vm: PurchaseViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val review = state.review; val selected = state.selected
    var confirmation by rememberSaveable { mutableStateOf(false) }
    val back = { if (state.pendingLink != null) vm.cancelLink() else if (selected != null || review != null) vm.leaveReview() else if (state.unitView != null) vm.closeUnit() else onBack() }
    BackHandler { if (!feedback.busy) back() }
    val needsProof = selected?.fundingSource == "company_payment"
    val canAnalyze = selected != null && selected.receipts.isNotEmpty()
    val unitName = review?.let { input -> selected?.withdrawal?.unitName ?: state.context?.units?.firstOrNull { it.id == input.unitId }?.name }
    // The list filter is organization and group only; the cards are already split by unit. The last choice
    // is kept per account on this phone; a filter shows whenever there is more than one option to pick.
    val units = state.context?.units.orEmpty(); val pending = state.withdrawals?.withdrawals.orEmpty()
    val preferences = androidx.compose.ui.platform.LocalContext.current.getSharedPreferences("purchase", android.content.Context.MODE_PRIVATE)
    val owner = LocalOwner.current
    var restored by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.context) {
        if (!restored && state.context != null) { restored = true; vm.restoreFilter(preferences.getString("organization:$owner", null) ?: Rules.ALL_UNITS, preferences.getString("group:$owner", null) ?: Rules.ALL_UNITS) }
    }
    fun saveFilter() { preferences.edit().putString("organization:$owner", vm.state.value.organizationFilter).putString("group:$owner", vm.state.value.groupFilter).apply() }
    val filtersEnabled = !feedback.busy && state.pendingLink == null
    val organizations = Rules.purchaseOrganizationChoices(units)
    val groups = Rules.purchaseGroupChoices(units, state.organizationFilter)
    // A note kept on the phone for a withdrawal lives on that withdrawal's card, not in a list of its own.
    val noteFor = state.queueWithdrawals.entries.associate { (rowId, sourceId) -> sourceId to rowId }
    var discarding by rememberSaveable { mutableStateOf<String?>(null) }
    Page(if (review != null) "Revisão obrigatória" else "Compra local", feedback, back, footer = when {
        review != null -> ({
            if (confirmation) InlineConfirmation("Confirmar esta compra e os dados revisados?", feedback.busy, { confirmation = false }, "Confirmar compra") { vm.confirm(); confirmation = false }
            else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val items = review.items.sumOf { it.totalCents }; val matches = items == review.totalCents
                Column(Modifier.weight(1f)) {
                    Text("Itens × total", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp))
                    Text("${money(items)} · ${if (matches) "confere" else "não confere"}", color = if (matches) Tokens.ok else Tokens.warning, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                }
                Box(Modifier.width(190.dp)) { Action("Confirmar compra", feedback.busy) { confirmation = true } }
            }
        })
        selected != null -> ({
            Action("Analisar e continuar", feedback.busy, enabled = canAnalyze) { vm.upload() }
            if (needsProof && selected.receipts.isNotEmpty() && selected.paymentProofs.isEmpty()) Text("Sem comprovante, somente documento fiscal autorizado pode prosseguir.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        })
        else -> null
    }, header = {
        if (review != null) {
            TopBar(review.supplierName.ifBlank { "Fornecedor a conferir" }, "", feedback.busy, back, kicker = "Revisão obrigatória")
            Spacer(Modifier.height(10.dp))
            Text("Total da nota", color = Tokens.onDark4, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp))
            Text(money(review.totalCents), color = Tokens.onDark, style = MaterialTheme.typography.headlineLarge.copy(fontSize = 30.sp))
            Text(listOfNotNull(fullDate(review.purchaseDate).takeIf(String::isNotBlank), unitName).joinToString(" · "), color = Tokens.onDark2, style = MaterialTheme.typography.bodySmall)
        } else {
            StepHeader("Compra local", "", if (selected != null) 1 else 0, 3, feedback.busy, back, listOf("Tipo", "Anexos", "Finalizar"))
            if (selected == null && state.unitView == null && organizations.size > 2) UnitPickerHeader(organizations, state.organizationFilter, !filtersEnabled, "Organização", "Trocar") { vm.filterOrganization(it); saveFilter() }
        }
    }) {
        if (review != null) {
            Text("A leitura da nota é uma sugestão. Confira Compra, Pagamento e Itens antes de confirmar.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
            state.analysis?.warnings?.forEach { Text(it, color = Tokens.amberInk, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().background(Tokens.amberBg, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp)) }
            state.analysis?.payment?.let { payment ->
                Text("Comprovante: " + listOfNotNull(payment.payeeName?.takeIf(String::isNotBlank), payment.amountCents?.let(::money), payment.paidAt?.takeIf(String::isNotBlank)?.let(::fullDate)).joinToString(" · "), style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
                if (payment.amountMatchesReceipt == false || payment.payeeMatchesSupplier == false) Text("O comprovante diverge da nota. Confira antes de confirmar.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp), modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp))
            }
            key(review.submissionId) { ReviewFields(review, state.context, selected?.withdrawal, !feedback.busy, vm::review) }
            if (discarding == review.submissionId) InlineConfirmation("Cancelar esta nota? Ela sai do aparelho e do financeiro, e a sangria fica livre para outra nota.", feedback.busy, { discarding = null }, "Voltar", "Cancelar nota") { vm.discard(review.submissionId); discarding = null }
            else Action("Cancelar esta nota", feedback.busy, secondary = true) { discarding = review.submissionId }
        } else if (selected != null) {
            Row(Modifier.fillMaxWidth().background(Tokens.soft, RoundedCornerShape(16.dp)).border(1.dp, Tokens.border, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("TIPO DA COMPRA", color = Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, letterSpacing = 1.2.sp))
                    Text(when { needsProof -> "Compra normal"; selected.withdrawal != null -> "Sangria · ${money(selected.withdrawal.amountCents)}"; else -> "Sangria fora da lista" }, style = MaterialTheme.typography.titleMedium)
                    selected.withdrawal?.let { Text("${it.unitName} · ${fullDate(it.date)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                    selected.withdrawal?.reason?.takeIf(String::isNotBlank)?.let { Text("Motivo no PDV: $it", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                }
                Text("Alterar", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), modifier = Modifier.clickable(enabled = !feedback.busy, role = Role.Button, onClick = back).padding(8.dp))
            }
            if (selected.withdrawal != null) Action("Cancelar seleção da sangria", feedback.busy, secondary = true) { vm.leaveReview() }
            Text(if (needsProof) "Anexe a nota da compra. NF-e, DANFE ou NFC-e autorizada pode seguir sem comprovante; cupom comum, recibo ou contingência pendente exige comprovante." else "Anexe a nota da compra. A sangria já comprova o pagamento.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
            DocumentCard("Nota da compra", "Cupom, nota fiscal ou recibo", selected.receipts, !feedback.busy, { vm.attach(it, false) }) { vm.remove(it, false) }
            if (needsProof) DocumentCard("Comprovante de pagamento", "Obrigatório sem documento fiscal autorizado", selected.paymentProofs, !feedback.busy, { vm.attach(it, true) }) { vm.remove(it, true) }
            LabeledInput("", selected.note, !feedback.busy, placeholder = "Observação (opcional, até 240 caracteres)", onChange = vm::note)
            Text("Até 2 arquivos por documento; 15 MB por arquivo e 25 MB no total.", color = Tokens.faint, style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp))
        } else {
            state.result?.let { result -> Column(Modifier.fillMaxWidth().background(Tokens.okBg, RoundedCornerShape(14.dp)).border(1.dp, Tokens.okBorder, RoundedCornerShape(14.dp)).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(when (result.status) { "confirmed" -> "Compra registrada"; "linked" -> "Compra conciliada com a sangria"; else -> "Compra registrada" }, color = Tokens.okInk, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                when (result.stockEntry) { "done" -> "Entrada no estoque: ${result.stockItemCount ?: 0} itens."; "pending" -> "Entrada no estoque pendente."; "reversed" -> "Entrada no estoque estornada."; else -> null }?.let { Text(it, color = Tokens.okInk, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp)) }
                if (result.itemCount != null && result.resolvedItemCount != null) Text(if (result.operationalStatus == "resolved") "Todos os itens foram tratados." else "${result.resolvedItemCount} de ${result.itemCount} itens tratados; os demais seguiram para Compras.", color = Tokens.okInk, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp))
                result.changeCents?.takeIf { it > 0 }?.let { Text("Troco de ${money(it)}: devolva esse valor ao caixa.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 13.sp)) }
            } }
            val list = state.withdrawals
            val unitView = state.unitView
            val shownWithdrawals = Rules.filterWithdrawals(pending, units, state.organizationFilter, state.groupFilter)
            if (unitView == null) {
                // Step 1: one card per unit with withdrawals waiting; a unit with nothing open does not show.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Sangrias aguardando nota", style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp))
                        Text(list?.let { "Registradas no PDV desde ${shortDate(it.window.from) ?: it.window.from}" } ?: "Registradas no PDV", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Atualizar", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp), modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Tokens.surface).border(1.dp, Tokens.fieldBorder, RoundedCornerShape(10.dp)).clickable(enabled = !feedback.busy, role = Role.Button) { vm.refresh() }.padding(horizontal = 12.dp, vertical = 9.dp))
                }
                if (groups.size > 2) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    groups.forEach { (id, name) -> FilterChip(state.groupFilter == id, onClick = { vm.filterGroup(id); saveFilter() }, enabled = filtersEnabled, label = { Text(name, maxLines = 1) }) }
                }
                if (list?.partial == true) Text("Lista parcial. Confira o período de ${fullDate(list.window.from)} a ${fullDate(list.window.to)}.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall)
                if (list != null && shownWithdrawals.isEmpty()) Text(if (pending.isEmpty()) "Nenhuma sangria aguardando nota." else "Nenhuma sangria aguardando nota neste filtro.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.greyBg, RoundedCornerShape(12.dp)).padding(14.dp))
                Rules.purchaseUnitCards(shownWithdrawals).forEach { (unitId, name, count) ->
                    val notes = shownWithdrawals.count { it.unitId == unitId && it.sourceId in noteFor }
                    Card(onClick = { vm.openUnit(unitId) }, enabled = !feedback.busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), border = BorderStroke(1.dp, Tokens.border), colors = CardDefaults.cardColors(containerColor = Tokens.surface, disabledContainerColor = Tokens.surface)) {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(name, style = MaterialTheme.typography.titleMedium)
                                Text(if (count == 1) "1 sangria aguardando nota" else "$count sangrias aguardando nota", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                                if (notes > 0) Text(if (notes == 1) "1 nota em revisão" else "$notes notas em revisão", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp))
                            }
                            Box(Modifier.size(32.dp).background(Tokens.accentSoft, CircleShape), contentAlignment = Alignment.Center) { Text("$count", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.ExtraBold)) }
                        }
                    }
                }
                Text("Outra compra", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                Text("Se a sangria ainda não apareceu na lista, ou a compra não foi paga com o caixa, informe como ela foi paga.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ChoiceCard("SANGRIA", "Dinheiro do caixa", "Sangria fora da lista. Só a nota da compra.", !feedback.busy, Modifier.weight(1f).fillMaxHeight()) { vm.select("cash_withdrawal") }
                    ChoiceCard("COMPRA NORMAL", "Recurso da empresa", "Documento fiscal autorizado pode seguir sem comprovante.", !feedback.busy, Modifier.weight(1f).fillMaxHeight()) { vm.select("company_payment") }
                }
                // Notes not tied to a withdrawal on the list (other purchases, or a withdrawal that left it).
                val loose = state.queue.filter { row -> state.queueWithdrawals[row.id]?.let { source -> pending.none { it.sourceId == source } } ?: true }
                if (loose.isNotEmpty()) {
                    Text("Notas guardadas no aparelho", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                    if (state.queue.any { it.state != "UPLOADED" }) Action("Sincronizar pendências", feedback.busy, secondary = true) { vm.sync() }
                    loose.forEach { row -> CardBlock { QueuedNote(row, discarding == row.id, feedback.busy, { vm.resume(row) }, { discarding = row.id }, { discarding = null }) { vm.discard(row.id); discarding = null } } }
                }
            } else {
                // Step 2: the withdrawals of one unit, each card carrying its note in review when there is one.
                val unitWithdrawals = pending.filter { it.unitId == unitView }
                val unitTitle = unitWithdrawals.firstOrNull()?.unitName ?: units.firstOrNull { it.id == unitView }?.name ?: "Unidade"
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(unitTitle, style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp))
                        Text(if (unitWithdrawals.size == 1) "1 sangria aguardando nota" else "${unitWithdrawals.size} sangrias aguardando nota", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Unidades", color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp), modifier = Modifier.clickable(enabled = !feedback.busy && state.pendingLink == null, role = Role.Button, onClick = vm::closeUnit).padding(8.dp))
                }
                if (unitWithdrawals.isEmpty()) Text("Nenhuma sangria aguardando nota nesta unidade.", color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp), modifier = Modifier.fillMaxWidth().background(Tokens.greyBg, RoundedCornerShape(12.dp)).padding(14.dp))
                unitWithdrawals.forEach { withdrawal ->
                    val activeLink = state.pendingLink?.takeIf { it.withdrawal.sourceId == withdrawal.sourceId }
                    val note = noteFor[withdrawal.sourceId]?.let { id -> state.queue.firstOrNull { it.id == id } }
                    val requester = remember(withdrawal.sourceId) { BringIntoViewRequester() }
                    if (activeLink != null) LaunchedEffect(state.linkFocusRequest) { requester.bringIntoView() }
                    val highlighted = activeLink != null || note != null
                    Card(onClick = { when { activeLink != null -> vm.resumeLink(); note != null -> vm.resume(note); else -> vm.select("cash_withdrawal", withdrawal) } }, enabled = !feedback.busy, modifier = Modifier.fillMaxWidth().bringIntoViewRequester(requester), shape = RoundedCornerShape(16.dp), border = BorderStroke(if (highlighted) 2.dp else 1.dp, if (highlighted) Tokens.accent else Tokens.border), colors = CardDefaults.cardColors(containerColor = if (highlighted) Tokens.accentSoft else Tokens.surface, disabledContainerColor = Tokens.surface)) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(money(withdrawal.amountCents), style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp))
                                    Text((shortDate(withdrawal.date) ?: withdrawal.date) + (withdrawal.time?.takeIf(String::isNotBlank)?.let { " às ${it.take(5)}" } ?: ""), color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp))
                                    withdrawal.operatorName?.takeIf(String::isNotBlank)?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp)) }
                                    // Only when the PDV sends it: what the operator typed there when taking the money out.
                                    withdrawal.reason?.takeIf(String::isNotBlank)?.let { Text("Motivo: $it", color = Tokens.ink, style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp), maxLines = 3, overflow = TextOverflow.Ellipsis) }
                                }
                                Text(when { activeLink != null -> "Retomar vinculação"; note != null -> "Retomar nota"; else -> "Anexar nota" }, color = Tokens.wine, style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp))
                            }
                            activeLink?.let { link ->
                                Text("${link.purchase.supplierName} · ${money(link.purchase.totalCents)}", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold))
                                InlineConfirmation("Vincular esta compra a esta sangria?", feedback.busy, vm::cancelLink, "Cancelar vinculação", "Confirmar vínculo", vm::link)
                            }
                            if (activeLink == null && note != null) QueuedNote(note, discarding == note.id, feedback.busy, { vm.resume(note) }, { discarding = note.id }, { discarding = null }) { vm.discard(note.id); discarding = null }
                        }
                    }
                }
                val unitPurchases = list?.awaitingPurchases.orEmpty().filter { it.unitId == unitView }
                if (unitPurchases.isNotEmpty() && unitWithdrawals.isNotEmpty()) Text("Compras aguardando conciliação", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                if (unitWithdrawals.isNotEmpty()) unitPurchases.forEach { purchase -> CardBlock {
                    Text("${purchase.supplierName} · ${money(purchase.totalCents)}", style = MaterialTheme.typography.titleMedium)
                    Text("Compra de ${fullDate(purchase.purchaseDate)} sem sangria vinculada", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    unitWithdrawals.filter { it.sourceId !in noteFor }.forEach { withdrawal ->
                        val selectedLink = state.pendingLink?.takeIf { it.purchase.id == purchase.id && it.withdrawal.sourceId == withdrawal.sourceId }
                        if (selectedLink != null) Action("Retomar vinculação", feedback.busy, secondary = true, onClick = vm::resumeLink)
                        else Action("Selecionar sangria de ${money(withdrawal.amountCents)}", feedback.busy, secondary = true) { vm.prepareLink(purchase, withdrawal) }
                    }
                } }
            }
        }
    }
}
/** A note kept on the phone: where it stands, how to pick it up again, and how to give it up. */
@Composable private fun QueuedNote(row: com.coalaone.go.offline.QueueRow, confirming: Boolean, busy: Boolean, onResume: () -> Unit, onAskDiscard: () -> Unit, onKeep: () -> Unit, onDiscard: () -> Unit) {
    Text(when (row.state) { "UPLOADED" -> "Nota enviada · revisão pendente"; "BLOCKED" -> "Revise o envio antes de tentar novamente"; else -> "Nota aguardando envio" }, color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp))
    row.error?.let { Text(it, color = Tokens.danger, style = MaterialTheme.typography.bodySmall) }
    if (confirming) InlineConfirmation("Cancelar esta nota? Ela sai do aparelho e do financeiro, e a sangria fica livre para outra nota.", busy, onKeep, "Voltar", "Cancelar nota", onDiscard)
    else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f)) { Action(if (row.state == "UPLOADED") "Retomar revisão" else "Abrir documentos", busy, onClick = onResume) }
        Box(Modifier.weight(1f)) { Action("Cancelar nota", busy, secondary = true, onClick = onAskDiscard) }
    }
}
/** Numbered section header of the review: a tick when collapsed, the number while open. */
@Composable private fun ReviewSection(number: Int, title: String, subtitle: String, open: Boolean, onToggle: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().background(Tokens.surface, RoundedCornerShape(16.dp)).border(if (open) 2.dp else 1.dp, if (open) Tokens.accent else Tokens.border, RoundedCornerShape(16.dp)).padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onToggle), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(22.dp).background(if (open) Tokens.accentSoft else Tokens.soft, CircleShape), contentAlignment = Alignment.Center) { Text("$number", color = if (open) Tokens.wine else Tokens.muted, style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Black)) }
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                if (!open && subtitle.isNotBlank()) Text(subtitle, color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            }
            DropdownChevron(open, if (open) Tokens.wine else Tokens.faint)
        }
        if (open) content()
    }
}
@Composable private fun ReviewFields(input: ConfirmPurchase, context: PurchaseContext?, withdrawal: Withdrawal?, enabled: Boolean, onChange: (ConfirmPurchase) -> Unit) {
    var open by rememberSaveable(input.submissionId) { mutableStateOf(0) }
    ReviewSection(1, "Compra", "${withdrawal?.let { "${it.unitName} (fixada pela sangria)" } ?: context?.units?.firstOrNull { it.id == input.unitId }?.name ?: "Unidade a escolher"} · ${money(input.totalCents)}", open == 0, { open = if (open == 0) -1 else 0 }) {
        run {
            if (withdrawal != null) Text("Unidade: ${withdrawal.unitName} (fixada pela sangria)")
            else Choices("Unidade", context?.units.orEmpty().map { it.id to it.name }, input.unitId, enabled) { unit -> onChange(input.copy(unitId = unit, resultCenterId = "")) }
            Field("Fornecedor", input.supplierName, enabled) { onChange(input.copy(supplierName = it)) }
            Field("CNPJ (14 dígitos, opcional)", input.supplierTaxId.orEmpty(), enabled) { onChange(input.copy(supplierTaxId = it.filter(Char::isDigit).take(14).ifBlank { null })) }
            DateField("Data da compra", input.purchaseDate, enabled) { onChange(input.copy(purchaseDate = it)) }
            ReviewDecimal("Total (R$)", centsText(input.totalCents), enabled) { onChange(input.copy(totalCents = Rules.cents(it) ?: 0)) }
        }
    }
    ReviewSection(2, "Pagamento", context?.accounts?.firstOrNull { it.id == input.accountPlanId }?.name ?: "Categoria a escolher", open == 1, { open = if (open == 1) -1 else 1 }) {
        run {
            withdrawal?.let { Column(Modifier.fillMaxWidth().background(Tokens.soft, RoundedCornerShape(12.dp)).border(1.dp, Tokens.border, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp)) {
                Text("Sangria de ${money(it.amountCents)}", style = MaterialTheme.typography.titleMedium.copy(fontSize = 14.sp))
                it.reason?.takeIf(String::isNotBlank)?.let { reason -> Text("Motivo no PDV: $reason", color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                Text("${it.unitName} · ${fullDate(it.date)}", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
            } }
            Choices("Categoria", context?.accounts.orEmpty().map { it.id to it.name }, input.accountPlanId, enabled) { onChange(input.copy(accountPlanId = it)) }
            Choices("Centro de resultado", context?.resultCenters.orEmpty().filter { it.unitId == input.unitId }.map { it.id to it.name }, input.resultCenterId, enabled) { onChange(input.copy(resultCenterId = it)) }
            if (input.fundingSource == "company_payment") Choices("Método de pagamento", listOf("pix" to "PIX", "card_credit" to "Crédito", "card_debit" to "Débito", "cash" to "Dinheiro", "boleto" to "Boleto", "term" to "A prazo"), input.companyPaymentMethod.orEmpty(), enabled) { onChange(input.copy(companyPaymentMethod = it)) }
            else withdrawal?.let { (it.amountCents - input.totalCents).takeIf { change -> change > 0 }?.let { change -> Text("Troco de ${money(change)}: devolva esse valor ao caixa.", color = Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp), modifier = Modifier.fillMaxWidth().background(Tokens.warningBg, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp)) } }
        }
    }
    ReviewSection(3, "Itens", "${input.items.size} ${if (input.items.size == 1) "item" else "itens"} · soma ${money(input.items.sumOf { it.totalCents })}", open == 2, { open = if (open == 2) -1 else 2 }) {
        run {
            input.items.forEachIndexed { index, item ->
                key(item.localId) {
                fun edit(next: PurchaseItem) { onChange(input.copy(items = input.items.mapIndexed { i, current -> if (i == index) next else current })) }
                Text("Item ${index + 1}", style = MaterialTheme.typography.titleMedium)
                Field("Descrição", item.description, enabled) { edit(item.copy(description = it)) }
                ReviewDecimal("Quantidade", Rules.quantityText(item.quantity), enabled) { edit(item.copy(quantity = Rules.quantity(it))) }
                Field("Unidade", item.unit, enabled) { edit(item.copy(unit = it)) }
                ReviewDecimal("Preço unitário (R$)", centsText(item.unitPriceCents), enabled) { edit(item.copy(unitPriceCents = Rules.cents(it) ?: 0)) }
                ReviewDecimal("Total do item (R$)", centsText(item.totalCents), enabled) { edit(item.copy(totalCents = Rules.cents(it) ?: 0)) }
                Text("IA · " + when (item.aiTreatment) { "existing_item" -> "item existente encontrado"; "item_not_found" -> "item não encontrado"; "asset_candidate" -> "possível patrimônio"; "immediate_use" -> "uso imediato, sem estoque"; else -> "destinação precisa de revisão" }, color = if (item.aiTreatment == "existing_item" || item.aiTreatment == "immediate_use") Tokens.okInk else Tokens.warning, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 12.5.sp))
                item.aiReason?.takeIf(String::isNotBlank)?.let { Text(it, color = Tokens.muted, style = MaterialTheme.typography.bodySmall) }
                if (context?.products?.isNotEmpty() == true) Choices("Entrada no estoque", listOf("" to "Sem entrada") + context.products.map { it.id to "${it.name} (${it.packageLabel})" }, item.stock?.productId.orEmpty(), enabled) { productId -> edit(item.copy(stock = productId.takeIf(String::isNotEmpty)?.let { StockEntry(it, item.quantity) })) }
                item.stock?.let { stock ->
                    ReviewDecimal("Quantidade no estoque", Rules.quantityText(stock.quantity), enabled) { edit(item.copy(stock = stock.copy(quantity = Rules.quantity(it)))) }
                    DateField("Validade", stock.expiryDate.orEmpty(), enabled, optional = true) { edit(item.copy(stock = stock.copy(expiryDate = it.ifBlank { null }))) }
                }
                TextButton({ onChange(input.copy(items = input.items.filterIndexed { i, _ -> i != index })) }, enabled = enabled) { Text("Remover item", color = Tokens.danger) }
                }
            }
            Action("Adicionar item", enabled = enabled, secondary = true) { onChange(input.copy(items = input.items + PurchaseItem("", 1.0, "un", 0, 0))) }
        }
    }
}
