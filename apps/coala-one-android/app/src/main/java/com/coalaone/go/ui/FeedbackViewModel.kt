package com.coalaone.go.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.coalaone.go.data.Errors
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class Feedback(val busy: Boolean = false, val error: String? = null, val notice: String? = null)
abstract class FeedbackViewModel : ViewModel() {
    protected val feedbackMutable = MutableStateFlow(Feedback())
    val feedback = feedbackMutable.asStateFlow()
    protected fun run(notice: String? = null, work: suspend () -> Unit): Job? {
        if (feedbackMutable.value.busy) return null
        feedbackMutable.value = Feedback(busy = true)
        return viewModelScope.launch {
            try { work(); feedbackMutable.value = feedbackMutable.value.copy(busy = false, notice = notice ?: feedbackMutable.value.notice) }
            catch (cause: Exception) { feedbackMutable.value = Feedback(error = Errors.classify(cause).message) }
        }
    }
}
