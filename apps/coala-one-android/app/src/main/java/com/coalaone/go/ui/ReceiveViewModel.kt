package com.coalaone.go.ui

import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

data class ReceiveState(val list: Repositions? = null, val activity: Reposition? = null, val drafts: Map<String, Pair<String, String>> = emptyMap(), val step: Int = 0)
@HiltViewModel class ReceiveViewModel @Inject constructor(private val repository: MobileRepository) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(ReceiveState())
    val state = mutable.asStateFlow()
    init { refresh() }
    fun refresh() = run { mutable.update { it.copy(list = repository.repositions()) } }
    fun open(activity: Reposition) { mutable.update { it.copy(activity = activity, drafts = activity.rows.associate { row -> Rules.receiptKey(row) to (Rules.quantityText(row.sentQuantity) to "") }, step = 0) } }
    fun edit(key: String, quantity: String, notes: String) { mutable.update { it.copy(drafts = it.drafts + (key to (quantity to notes))) } }
    fun back() { mutable.update { it.copy(activity = null, drafts = emptyMap()) } }
    fun step(value: Int) { mutable.update { it.copy(step = value.coerceAtLeast(0)) } }
    fun confirm() = run("Recebimento registrado. A entrada de estoque será efetivada no Coala One.") {
        val current = mutable.value; val activity = current.activity ?: return@run
        repository.receive(Rules.receipt(activity, current.drafts))
        mutable.update { it.copy(activity = null, drafts = emptyMap(), list = it.list?.copy(activities = it.list.activities.filter { row -> row.id != activity.id })) }
    }
}
