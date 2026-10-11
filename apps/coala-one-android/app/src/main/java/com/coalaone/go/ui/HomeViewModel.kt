package com.coalaone.go.ui

import androidx.lifecycle.viewModelScope
import com.coalaone.go.auth.RuntimeMode
import com.coalaone.go.data.*
import com.coalaone.go.offline.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel class HomeViewModel @Inject constructor(private val repository: ApiRepository, private val mode: RuntimeMode, private val queue: UploadQueue, private val scheduler: WorkScheduler) : FeedbackViewModel() {
    private val mutable = MutableStateFlow<ProfileResponse?>(null)
    val profile = mutable.asStateFlow()
    private val queueMutable = MutableStateFlow<List<QueueRow>>(emptyList())
    val pending = queueMutable.asStateFlow()
    init {
        refresh()
        if (!mode.simulation) viewModelScope.launch {
            val uid = mode.identity().uid
            try { queue.list(uid) } catch (cause: Exception) { feedbackMutable.value = Feedback(error = Errors.classify(cause).message) }
            scheduler.schedule(uid); queue.observe(uid).collect { queueMutable.value = it }
        }
    }
    fun refresh() = run { mutable.value = repository.profile() }
    fun avatar(document: Document) = run("Foto atualizada.") {
        require(document.bytes.size <= 5 * 1024 * 1024 && document.mimeType in listOf("image/jpeg", "image/png", "image/webp")) { "Escolha uma foto JPG, PNG ou WEBP até 5 MB." }
        val url = repository.avatar(document)
        mutable.value = mutable.value?.let { it.copy(profile = it.profile.copy(avatarUrl = url)) }
    }
}
