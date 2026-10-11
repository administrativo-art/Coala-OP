package com.coalaone.go.ui

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.*
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
@Composable fun PurchaseScreen(vm: PurchaseViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsState(); val feedback by vm.feedback.collectAsState()
    val review = state.review; val selected = state.selected
    var confirmation by rememberSaveable { mutableStateOf(false) }
    val back = { if (selected != null || review != null) vm.leaveReview() else onBack() }
    BackHandler { if (!feedback.busy) back() }
    Page(if (review != null) "Revisão obrigatória" else "Compra local", feedback, back, footer = {
        if (review != null) {
            if (confirmation) InlineConfirmation("Confirmar esta compra e os dados revisados?", feedback.busy, { confirmation = false }, "Confirmar compra") { vm.confirm(); confirmation = false }
            else Action("Confirmar compra", feedback.busy) { confirmation = true }
        } else if (selected != null) Action("Enviar documentos e revisar", feedback.busy, enabled = selected.receipts.isNotEmpty()) { vm.upload() }
    }, header = {
        StepHeader("Compra local", if (review != null) "Confira os dados antes de confirmar" else "Notas e comprovantes", if (review != null) 2 else if (selected != null) 1 else 0, 3, feedback.busy, back, listOf("Tipo", "Anexos", "Finalizar"), onRefresh = if (review == null && selected == null) ({ vm.refresh() }) else null)
    }) {
        state.result?.let { result -> CardBlock {
            Text(when (result.status) { "confirmed" -> "Compra confirmada"; "linked" -> "Compra conciliada com a sangria"; else -> "Compra registrada" }, style = MaterialTheme.typography.titleMedium)
            when (result.stockEntry) { "done" -> "Entrada no estoque: ${result.stockItemCount ?: 0} itens"; "pending" -> "Entrada no estoque pendente"; "reversed" -> "Entrada no estoque estornada"; else -> null }?.let { Text(it) }
            result.changeCents?.let { Text("Troco: ${money(it)}") }
        } }
        if (review != null) {
            CardBlock {
                Text(review.supplierName.ifBlank { "Fornecedor a conferir" }, style = MaterialTheme.typography.titleMedium)
                Text(money(review.totalCents), style = MaterialTheme.typography.headlineLarge)
                Text(fullDate(review.purchaseDate), color = Tokens.muted)
            }
            Text("A leitura da nota é uma sugestão. Confira Compra, Pagamento e Itens antes de confirmar.")
            state.analysis?.warnings?.forEach { Text(it, color = Tokens.warning) }
            state.analysis?.payment?.let { payment -> Text("Comprovante: " + listOfNotNull(payment.payeeName?.takeIf(String::isNotBlank), payment.amountCents?.let(::money), payment.paidAt?.takeIf(String::isNotBlank)?.let(::fullDate)).joinToString(" · ")); if (payment.amountMatchesReceipt == false || payment.payeeMatchesSupplier == false) Text("O comprovante diverge da nota. Confira antes de confirmar.", color = Tokens.warning) }
            key(review.submissionId) { ReviewFields(review, state.context, selected?.withdrawal, !feedback.busy, vm::review) }
        } else if (selected != null) {
            Text(if (selected.fundingSource == "company_payment") "Pagamento da empresa" else "Compra por sangria")
            selected.withdrawal?.let { Text("${it.unitName} · ${money(it.amountCents)} · ${fullDate(it.date)}") }
            Text("Até 2 arquivos por documento; 15 MB por arquivo e 25 MB no total.")
            CardBlock {
            CaptureButtons("Nota da compra", !feedback.busy && selected.receipts.size < 2) { vm.attach(it, false) }
            selected.receipts.forEachIndexed { index, doc -> Text("Nota ${index + 1}: ${doc.name} · ${doc.bytes.size / 1024} KB"); TextButton({ vm.remove(index, false) }, enabled = !feedback.busy) { Text("Remover nota ${index + 1}") } }
            }
            if (selected.fundingSource == "company_payment") {
                CardBlock {
                CaptureButtons("Comprovante de pagamento", !feedback.busy && selected.paymentProofs.size < 2) { vm.attach(it, true) }
                selected.paymentProofs.forEachIndexed { index, doc -> Text("Comprovante ${index + 1}: ${doc.name}"); TextButton({ vm.remove(index, true) }, enabled = !feedback.busy) { Text("Remover comprovante ${index + 1}") } }
                }
            }
            Field("Observação (até 240 caracteres)", selected.note, !feedback.busy, onChange = vm::note)
        } else {
            state.withdrawals?.let { list ->
                if (list.partial) Text("Lista parcial de sangrias. Confira o período de ${fullDate(list.window.from)} a ${fullDate(list.window.to)}.", color = Tokens.warning)
                SectionLabel("Paga com sangria do caixa")
                list.withdrawals.forEach { withdrawal ->
                    ListRow("${withdrawal.unitName} · ${money(withdrawal.amountCents)}", listOfNotNull(fullDate(withdrawal.date), withdrawal.time?.takeIf(String::isNotBlank), withdrawal.operatorName?.takeIf(String::isNotBlank)).joinToString(" · "), !feedback.busy, leading = "R$") { vm.select("cash_withdrawal", withdrawal) }
                }
                ListRow("Outra sangria", "A sangria usada não aparece na lista", !feedback.busy, leading = "+") { vm.select("cash_withdrawal") }
                SectionLabel("Paga pela empresa")
                ListRow("Compra paga pela empresa", "PIX, cartão, boleto ou a prazo", !feedback.busy, leading = "E") { vm.select("company_payment") }
                if (list.awaitingPurchases.isNotEmpty()) SectionLabel("Aguardando conciliação")
                list.awaitingPurchases.forEach { purchase -> CardBlock {
                    Text("${purchase.supplierName} · ${money(purchase.totalCents)}", style = MaterialTheme.typography.titleMedium)
                    Text("Compra de ${fullDate(purchase.purchaseDate)} sem sangria vinculada", color = Tokens.muted, style = MaterialTheme.typography.bodySmall)
                    list.withdrawals.filter { it.unitId == purchase.unitId }.forEach { withdrawal -> Action("Vincular sangria de ${money(withdrawal.amountCents)}", feedback.busy, secondary = true) { vm.link(purchase, withdrawal) } }
                } }
            }
            if (state.queue.isNotEmpty()) {
                SectionLabel("Envios guardados no aparelho")
                Action("Sincronizar pendências", feedback.busy, secondary = true) { vm.sync() }
                state.queue.forEach { row -> CardBlock {
                    Text(when (row.state) { "UPLOADED" -> "Recebido — revisão pendente"; "BLOCKED" -> "Revise o envio antes de tentar novamente"; else -> "Aguardando envio" })
                    row.error?.let { Text(it, color = Tokens.danger) }
                    Action(if (row.state == "UPLOADED") "Revisar compra recebida" else "Abrir documentos pendentes", feedback.busy, secondary = true) { vm.resume(row) }
                } }
            }
        }
    }
}
@Composable private fun ReviewFields(input: ConfirmPurchase, context: PurchaseContext?, withdrawal: Withdrawal?, enabled: Boolean, onChange: (ConfirmPurchase) -> Unit) {
    var open by rememberSaveable(input.submissionId) { mutableStateOf(0) }
    CardBlock(selected = open == 0) {
        TextButton({ open = if (open == 0) -1 else 0 }) { Text("1 · Compra · ${money(input.totalCents)}") }
        if (open == 0) {
            if (withdrawal != null) Text("Unidade: ${withdrawal.unitName} (fixada pela sangria)")
            else Choices("Unidade", context?.units.orEmpty().map { it.id to it.name }, input.unitId, enabled) { unit -> onChange(input.copy(unitId = unit, resultCenterId = "")) }
            Field("Fornecedor", input.supplierName, enabled) { onChange(input.copy(supplierName = it)) }
            Field("CNPJ (14 dígitos, opcional)", input.supplierTaxId.orEmpty(), enabled) { onChange(input.copy(supplierTaxId = it.filter(Char::isDigit).take(14).ifBlank { null })) }
            DateField("Data da compra", input.purchaseDate, enabled) { onChange(input.copy(purchaseDate = it)) }
            ReviewDecimal("Total (R$)", centsText(input.totalCents), enabled) { onChange(input.copy(totalCents = Rules.cents(it) ?: 0)) }
        }
    }
    CardBlock(selected = open == 1) {
        TextButton({ open = if (open == 1) -1 else 1 }) { Text("2 · Pagamento e classificação") }
        if (open == 1) {
            Choices("Categoria", context?.accounts.orEmpty().map { it.id to it.name }, input.accountPlanId, enabled) { onChange(input.copy(accountPlanId = it)) }
            Choices("Centro de resultado", context?.resultCenters.orEmpty().filter { it.unitId == input.unitId }.map { it.id to it.name }, input.resultCenterId, enabled) { onChange(input.copy(resultCenterId = it)) }
            if (input.fundingSource == "company_payment") Choices("Método de pagamento", listOf("pix" to "PIX", "card_credit" to "Crédito", "card_debit" to "Débito", "cash" to "Dinheiro", "boleto" to "Boleto", "term" to "A prazo"), input.companyPaymentMethod.orEmpty(), enabled) { onChange(input.copy(companyPaymentMethod = it)) }
            else withdrawal?.let { Text("Troco previsto: ${money((it.amountCents - input.totalCents).coerceAtLeast(0))}") }
        }
    }
    CardBlock(selected = open == 2) {
        TextButton({ open = if (open == 2) -1 else 2 }) { Text("3 · Itens · soma ${money(input.items.sumOf { it.totalCents })}") }
        if (open == 2) {
            input.items.forEachIndexed { index, item ->
                key(item.localId) {
                fun edit(next: PurchaseItem) { onChange(input.copy(items = input.items.mapIndexed { i, current -> if (i == index) next else current })) }
                Text("Item ${index + 1}", style = MaterialTheme.typography.titleMedium)
                Field("Descrição", item.description, enabled) { edit(item.copy(description = it)) }
                ReviewDecimal("Quantidade", Rules.quantityText(item.quantity), enabled) { edit(item.copy(quantity = Rules.quantity(it))) }
                Field("Unidade", item.unit, enabled) { edit(item.copy(unit = it)) }
                ReviewDecimal("Preço unitário (R$)", centsText(item.unitPriceCents), enabled) { edit(item.copy(unitPriceCents = Rules.cents(it) ?: 0)) }
                ReviewDecimal("Total do item (R$)", centsText(item.totalCents), enabled) { edit(item.copy(totalCents = Rules.cents(it) ?: 0)) }
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
