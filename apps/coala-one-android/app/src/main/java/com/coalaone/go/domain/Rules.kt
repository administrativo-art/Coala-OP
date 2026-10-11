package com.coalaone.go.domain

import com.coalaone.go.data.*
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.DayOfWeek
import java.time.temporal.TemporalAdjusters
import java.util.UUID

object Rules {
    fun quantity(value: String): Double = value.trim().replace(".", "").replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 } ?: 0.0
    fun quantityText(value: Double): String = BigDecimal.valueOf(value).setScale(3, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString().replace('.', ',')
    fun cents(value: String): Long? = runCatching { BigDecimal(value.trim().replace(".", "").replace(',', '.')).movePointRight(2).longValueExact() }.getOrNull()
    fun changed(draft: CountDraft) = quantity(draft.exit) > 0 || quantity(draft.entry) > 0
    fun draft(item: CountItem) = CountDraft(if (item.exitQuantity > 0) quantityText(item.exitQuantity) else "", item.exitReason, item.exitNotes, if (item.entryQuantity > 0) quantityText(item.entryQuantity) else "", item.entryNotes)
    fun merge(session: CountSession, local: StoredCountDraft?): Map<String, CountDraft> {
        val server = session.items.associate { it.lotId to draft(it) }
        val known = local?.drafts?.filterKeys { it in server } ?: emptyMap()
        val time = runCatching { Instant.parse(session.updatedAt).toEpochMilli() }.getOrNull()
        return if (known.isNotEmpty() && (time == null || local!!.savedAt > time)) server + known else server
    }
    fun countRequest(session: CountSession, drafts: Map<String, CountDraft>, complete: Boolean): SaveCountRequest {
        val entries = session.items.mapNotNull { item ->
            val draft = drafts[item.lotId] ?: return@mapNotNull null
            if (!changed(draft)) return@mapNotNull null
            require(item.systemQuantity - quantity(draft.exit) + quantity(draft.entry) >= -0.000001) { "${item.productName}: a quantidade final não pode ser negativa." }
            require(draft.reason != "SAIDA_DESCARTE_OUTROS" || draft.exitNotes.trim().length >= 3) { "Explique o motivo Outros." }
            require(draft.exitNotes.length <= 240 && draft.entryNotes.length <= 240) { "Observação muito longa." }
            CountEntry(item.lotId, quantity(draft.exit), draft.reason, draft.exitNotes.trim(), quantity(draft.entry), draft.entryNotes.trim())
        }
        return SaveCountRequest(session.id, entries, complete)
    }
    fun receiptKey(row: RepositionRow) = "${row.baseProductId}:${row.lotId}"
    fun receipt(activity: Reposition, drafts: Map<String, Pair<String, String>>): ReceiveRequest {
        require(drafts.keys == activity.rows.map(::receiptKey).toSet()) { "Confira todos os lotes enviados." }
        return ReceiveRequest(activity.id, activity.rows.map { row ->
            val (text, notes) = drafts.getValue(receiptKey(row))
            require(text.isNotBlank()) { "Informe a quantidade recebida (0 se não chegou)." }
            val received = quantity(text)
            require(received == row.sentQuantity || notes.trim().length >= 3) { "Explique a divergência no lote ${row.lotNumber}." }
            require(notes.length <= 240) { "Observação muito longa." }
            ReceiptRow(row.baseProductId, row.lotId, received, notes.trim())
        })
    }
    fun validateUpload(upload: PendingUpload) {
        UUID.fromString(upload.submissionId)
        Instant.parse(upload.capturedAt)
        require(upload.receipts.size in 1..2 && upload.paymentProofs.size <= 2) { "Escolha até duas imagens por documento." }
        require(upload.fundingSource in listOf("cash_withdrawal", "company_payment"))
        require((upload.fundingSource == "company_payment") == upload.paymentProofs.isNotEmpty()) { "Compra empresarial exige comprovante; compra por sangria não usa comprovante." }
        require(upload.note.length <= 240) { "Observação: máximo de 240 caracteres." }
        val documents = upload.receipts + upload.paymentProofs
        require(documents.all { it.bytes.isNotEmpty() && it.bytes.size <= 15 * 1024 * 1024 && it.mimeType in listOf("image/jpeg", "image/png", "image/webp", "application/pdf") }) { "Documento inválido ou maior que 15 MB." }
        require(documents.sumOf { it.bytes.size.toLong() } <= 25 * 1024 * 1024) { "Os documentos ultrapassam 25 MB." }
        require(documents.map { java.security.MessageDigest.getInstance("SHA-256").digest(it.bytes).toList() }.distinct().size == documents.size) { "Não repita o mesmo documento." }
    }
    fun validatePurchase(input: ConfirmPurchase) {
        UUID.fromString(input.submissionId)
        require(runCatching { LocalDate.parse(input.purchaseDate) }.isSuccess) { "Informe uma data de compra válida." }
        require(input.unitId.isNotBlank() && input.accountPlanId.isNotBlank() && input.resultCenterId.isNotBlank()) { "Escolha unidade, categoria e centro de resultado." }
        require(input.supplierName.trim().length in 2..240) { "Informe o fornecedor." }
        require(input.supplierTaxId == null || input.supplierTaxId.matches(Regex("\\d{14}"))) { "CNPJ deve conter 14 dígitos." }
        require(input.totalCents > 0 && input.items.isNotEmpty() && input.items.sumOf { it.totalCents } == input.totalCents) { "A soma dos itens deve ser igual ao total da compra." }
        require(input.items.all { it.description.trim().length in 1..180 && it.quantity > 0 && it.unit.isNotBlank() && it.unitPriceCents >= 0 && it.totalCents > 0 }) { "Revise os itens da compra." }
        require(input.items.all { it.stock == null || it.stock.quantity > 0 && it.stock.productId.isNotBlank() && (it.stock.expiryDate == null || runCatching { LocalDate.parse(it.stock.expiryDate) }.isSuccess) }) { "Revise os itens de estoque." }
        require(input.fundingSource in listOf("cash_withdrawal", "company_payment"))
        require(if (input.fundingSource == "company_payment") input.companyPaymentMethod in listOf("pix", "card_credit", "card_debit", "cash", "boleto", "term") && input.withdrawal == null else input.companyPaymentMethod == null) { "Revise a origem e o método de pagamento." }
    }
    fun pairingCode(text: String): String? {
        val code = Regex("^COALA-SIGNAGE:([A-Za-z0-9]{8})$", RegexOption.IGNORE_CASE).matchEntire(text.trim())?.groupValues?.get(1)?.uppercase() ?: text.trim().uppercase()
        return code.takeIf { it.matches(Regex("[A-HJ-NP-Z2-9]{8}")) }
    }
    fun week(date: LocalDate) = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).let { monday -> (0..6).map { monday.plusDays(it.toLong()) } }
    fun updateRequired(release: Release?, installed: Int) = release != null && installed > 0 && installed < release.minVersionCode
}
