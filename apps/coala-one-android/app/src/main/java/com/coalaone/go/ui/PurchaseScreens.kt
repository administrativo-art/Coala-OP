package com.coalaone.go.ui

import androidx.activity.compose.BackHandler
import androidx.compose.material3.*
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
    }) {
        state.result?.let { result -> CardBlock {
            Text("Compra ${result.status}"); Text("Estoque: ${result.stockEntry ?: "not_needed"} · ${result.stockItemCount ?: 0} itens")
            result.changeCents?.let { Text("Troco: ${money(it)}") }
        } }
        if (review != null) {
            Text("A leitura da nota é uma sugestão. Confira Compra, Pagamento e Itens antes de confirmar.")
            state.analysis?.warnings?.forEach { Text(it, color = Tokens.warning) }
            state.analysis?.payment?.let { payment -> Text("Comprovante: ${payment.payeeName.orEmpty()} · ${payment.amountCents?.let(::money).orEmpty()} · ${payment.paidAt.orEmpty()}"); if (payment.amountMatchesReceipt == false || payment.payeeMatchesSupplier == false) Text("O comprovante diverge da nota. Confira antes de confirmar.", color = Tokens.warning) }
            key(review.submissionId) { ReviewFields(review, state.context, selected?.withdrawal, !feedback.busy, vm::review) }
        } else if (selected != null) {
            Text(if (selected.fundingSource == "company_payment") "Pagamento da empresa" else "Compra por sangria")
            selected.withdrawal?.let { Text("${it.unitName} · ${money(it.amountCents)} · ${it.date}") }
            Text("Até 2 arquivos por documento; 15 MB por arquivo e 25 MB no total.")
            CaptureButtons("Nota da compra", !feedback.busy && selected.receipts.size < 2) { vm.attach(it, false) }
            selected.receipts.forEachIndexed { index, doc -> Text("Nota ${index + 1}: ${doc.name} · ${doc.bytes.size / 1024} KB"); TextButton({ vm.remove(index, false) }, enabled = !feedback.busy) { Text("Remover nota ${index + 1}") } }
            if (selected.fundingSource == "company_payment") {
                CaptureButtons("Comprovante de pagamento", !feedback.busy && selected.paymentProofs.size < 2) { vm.attach(it, true) }
                selected.paymentProofs.forEachIndexed { index, doc -> Text("Comprovante ${index + 1}: ${doc.name}"); TextButton({ vm.remove(index, true) }, enabled = !feedback.busy) { Text("Remover comprovante ${index + 1}") } }
            }
            Field("Observação (até 240 caracteres)", selected.note, !feedback.busy, onChange = vm::note)
        } else {
            Action("Atualizar sangrias", feedback.busy, secondary = true) { vm.refresh() }
            state.withdrawals?.let { list ->
                if (list.partial) Text("Lista parcial de sangrias. Confira o período ${list.window.from} a ${list.window.to}.")
                list.withdrawals.forEach { withdrawal -> CardBlock {
                    Text("${withdrawal.unitName} · ${money(withdrawal.amountCents)}", style = MaterialTheme.typography.titleMedium)
                    Text("${withdrawal.date} · ${withdrawal.time.orEmpty()} · ${withdrawal.operatorName.orEmpty()}")
                    Action("Registrar compra desta sangria", feedback.busy, secondary = true) { vm.select("cash_withdrawal", withdrawal) }
                } }
                list.awaitingPurchases.forEach { purchase -> CardBlock {
                    Text("Conciliar: ${purchase.supplierName} · ${money(purchase.totalCents)}")
                    list.withdrawals.filter { it.unitId == purchase.unitId }.forEach { withdrawal -> Action("Vincular sangria de ${money(withdrawal.amountCents)}", feedback.busy, secondary = true) { vm.link(purchase, withdrawal) } }
                } }
            }
            Action("Registrar compra por sangria fora da lista", feedback.busy, secondary = true) { vm.select("cash_withdrawal") }
            Action("Registrar compra paga pela empresa", feedback.busy, secondary = true) { vm.select("company_payment") }
            if (state.queue.isNotEmpty()) {
                Text("Envios protegidos no aparelho", style = MaterialTheme.typography.titleMedium)
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
    CardBlock {
        TextButton({ open = if (open == 0) -1 else 0 }) { Text("1 · Compra · ${money(input.totalCents)}") }
        if (open == 0) {
            if (withdrawal != null) Text("Unidade: ${withdrawal.unitName} (fixada pela sangria)")
            else Choices("Unidade", context?.units.orEmpty().map { it.id to it.name }, input.unitId, enabled) { unit -> onChange(input.copy(unitId = unit, resultCenterId = "")) }
            Field("Fornecedor", input.supplierName, enabled) { onChange(input.copy(supplierName = it)) }
            Field("CNPJ (14 dígitos, opcional)", input.supplierTaxId.orEmpty(), enabled) { onChange(input.copy(supplierTaxId = it.filter(Char::isDigit).take(14).ifBlank { null })) }
            Field("Data da compra (AAAA-MM-DD)", input.purchaseDate, enabled) { onChange(input.copy(purchaseDate = it)) }
            ReviewDecimal("Total (R$)", centsText(input.totalCents), enabled) { onChange(input.copy(totalCents = Rules.cents(it) ?: 0)) }
        }
    }
    CardBlock {
        TextButton({ open = if (open == 1) -1 else 1 }) { Text("2 · Pagamento e classificação") }
        if (open == 1) {
            Choices("Categoria", context?.accounts.orEmpty().map { it.id to it.name }, input.accountPlanId, enabled) { onChange(input.copy(accountPlanId = it)) }
            Choices("Centro de resultado", context?.resultCenters.orEmpty().filter { it.unitId == input.unitId }.map { it.id to it.name }, input.resultCenterId, enabled) { onChange(input.copy(resultCenterId = it)) }
            if (input.fundingSource == "company_payment") Choices("Método de pagamento", listOf("pix" to "PIX", "card_credit" to "Crédito", "card_debit" to "Débito", "cash" to "Dinheiro", "boleto" to "Boleto", "term" to "A prazo"), input.companyPaymentMethod.orEmpty(), enabled) { onChange(input.copy(companyPaymentMethod = it)) }
            else withdrawal?.let { Text("Troco previsto: ${money((it.amountCents - input.totalCents).coerceAtLeast(0))}") }
        }
    }
    CardBlock {
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
                    Field("Validade (AAAA-MM-DD, vazio se não houver)", stock.expiryDate.orEmpty(), enabled) { edit(item.copy(stock = stock.copy(expiryDate = it.ifBlank { null }))) }
                }
                TextButton({ onChange(input.copy(items = input.items.filterIndexed { i, _ -> i != index })) }, enabled = enabled) { Text("Remover item", color = Tokens.danger) }
                }
            }
            Action("Adicionar item", enabled = enabled, secondary = true) { onChange(input.copy(items = input.items + PurchaseItem("", 1.0, "un", 0, 0))) }
        }
    }
}
