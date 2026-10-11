package com.coalaone.go.ui

import androidx.lifecycle.viewModelScope
import com.coalaone.go.auth.RuntimeMode
import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules
import com.coalaone.go.offline.CountDraftStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CountState(val context: CountContext? = null, val session: CountSession? = null, val drafts: Map<String, CountDraft> = emptyMap(), val step: Int = 0, val search: String = "", val onlyChanged: Boolean = false, val completed: Boolean = false)
@HiltViewModel class CountViewModel @Inject constructor(private val repository: MobileRepository, private val mode: RuntimeMode, private val store: CountDraftStore) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(CountState())
    val state = mutable.asStateFlow()
    private var saveJob: Job? = null
    init { refresh() }
    fun refresh() = run { mutable.update { it.copy(context = repository.countContext()) } }
    fun open(kioskId: String) = run {
        val session = repository.startCount(kioskId)
        val local = if (mode.simulation) null else store.load(mode.identity().uid, session.id)
        mutable.update { it.copy(session = session, drafts = Rules.merge(session, local), step = 0, completed = false) }
    }
    fun edit(lotId: String, draft: CountDraft) {
        if (feedback.value.busy) return
        mutable.update { it.copy(drafts = it.drafts + (lotId to draft)) }
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(600)
            try { saveLocal() }
            catch (cause: Exception) { feedbackMutable.value = Feedback(error = com.coalaone.go.data.Errors.classify(cause).message) }
        }
    }
    private suspend fun saveLocal() {
        if (mode.simulation) return
        val snapshot = mutable.value
        val session = snapshot.session ?: return
        store.save(mode.identity().uid, session.id, StoredCountDraft(System.currentTimeMillis(), snapshot.drafts))
    }
    fun filters(search: String, changed: Boolean) { mutable.update { it.copy(search = search, onlyChanged = changed, step = 0) } }
    fun step(value: Int) { mutable.update { it.copy(step = value.coerceAtLeast(0)) } }
    fun save(complete: Boolean, onSaved: () -> Unit = {}) = run(if (complete) "Contagem concluída." else "Rascunho salvo.") {
        saveJob?.cancel()
        saveLocal()
        val current = mutable.value
        val session = current.session ?: return@run
        repository.saveCount(Rules.countRequest(session, current.drafts, complete))
        if (!mode.simulation) store.clear(mode.identity().uid, session.id)
        mutable.update { it.copy(session = null, drafts = emptyMap(), completed = complete) }
        onSaved()
    }
    fun leave(onSaved: () -> Unit) = run("Rascunho preservado.") {
        saveJob?.cancel(); saveLocal()
        val current = mutable.value
        current.session?.let { session ->
            try { repository.saveCount(Rules.countRequest(session, current.drafts, false)); if (!mode.simulation) store.clear(mode.identity().uid, session.id) }
            catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (_: Exception) { /* Local encrypted draft remains authoritative until sync. */ }
        }
        onSaved()
    }
    fun cancel() = run("Contagem cancelada. O estoque não foi alterado.") {
        saveJob?.cancel()
        val session = mutable.value.session ?: return@run
        val result = repository.cancelCount(session.id)
        require(result.cancelled) { "O servidor não confirmou o cancelamento." }
        if (!mode.simulation) store.clear(mode.identity().uid, session.id)
        mutable.update { it.copy(session = null, drafts = emptyMap(), context = repository.countContext()) }
    }
}
