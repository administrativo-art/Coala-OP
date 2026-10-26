package com.coalaone.go.ui

import com.coalaone.go.data.OwnMarking
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Keeps the Home summary in step with a punch before its server reconciliation finishes. */
data class TimeSummaryUpdate(val contextKey: String, val marking: OwnMarking)

@Singleton
class TimeSummaryUpdates @Inject constructor() {
    private val mutable = MutableSharedFlow<TimeSummaryUpdate>(extraBufferCapacity = 8)
    val updates = mutable.asSharedFlow()

    fun recorded(contextKey: String, marking: OwnMarking) {
        mutable.tryEmit(TimeSummaryUpdate(contextKey, marking))
    }
}
