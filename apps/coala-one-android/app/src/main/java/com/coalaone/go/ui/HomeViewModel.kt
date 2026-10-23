package com.coalaone.go.ui

import androidx.lifecycle.viewModelScope
import com.coalaone.go.auth.RuntimeMode
import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.offline.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the home screen says about today; every field is optional because each module may be off or fail on its own. */
data class HomeToday(val loaded: Boolean = false, val hasSchedule: Boolean = false, val shift: String? = null, val shiftShort: String? = null, val shiftUnit: String? = null,
    val timeOptions: TimeOptions? = null, val timeClockOffset: Long? = null, val timePunches: List<OwnMarking> = emptyList(), val timeShift: OwnShift? = null,
    val goalUnit: String? = null, val goalToday: Double? = null, val goalDaily: Double? = null, val goalPercent: Double? = null, val openCounts: List<String> = emptyList(), val repositions: Int? = null)
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
    private val todayMutable = MutableStateFlow(HomeToday())
    val today = todayMutable.asStateFlow()
    private var todayLoadedAt = 0L
    private suspend fun <T> quiet(block: suspend () -> T): T? = try { block() } catch (cause: kotlinx.coroutines.CancellationException) { throw cause } catch (_: Exception) { null }
    /**
     * Read once when the home opens and again on pull-to-refresh or after two minutes away, never on a timer.
     * A module that is off is not asked; a failure only leaves its line out.
     */
    fun loadToday(modules: Modules, goalUnitId: String?, force: Boolean = false) {
        if (!force && System.currentTimeMillis() - todayLoadedAt < 120_000) return
        todayLoadedAt = System.currentTimeMillis()
        viewModelScope.launch {
            var next = HomeToday(loaded = true)
            val now = java.time.LocalDate.now()
            if (modules.stockCount) quiet { repository.countContext().openSessions.map { it.kioskName } }?.let { next = next.copy(openCounts = it) }
            if (modules.repositionReceipt) quiet { repository.repositions().activities.size }?.let { next = next.copy(repositions = it) }
            if (modules.timeRecording) {
                val elapsed = android.os.SystemClock.elapsedRealtime()
                val options = quiet { repository.api.timeOptions(now.toString()) }
                val markings = quiet { repository.api.markings(now.toString(), now.toString()).markings }.orEmpty()
                val ownShift = quiet { repository.api.timeMonth(now.toString().take(7)).shifts.firstOrNull { it.date == now.toString() } }
                next = next.copy(timeOptions = options, timeClockOffset = TimeRules.clockOffset(options?.officialClock, elapsed),
                    timePunches = markings, timeShift = ownShift, hasSchedule = ownShift != null,
                    shiftUnit = ownShift?.unitName, shift = TimeRules.shiftText(ownShift),
                    shiftShort = ownShift?.let { if (it.type == "day_off") "Folga" else "${it.startTime?.take(2)}h–${it.endTime?.take(2)}h" })
            } else if (modules.schedule) quiet { repository.api.schedule(now.year, now.monthValue).units.firstNotNullOfOrNull { unit -> unit.shifts.firstOrNull { it.date == now.toString() && unit.people.getOrNull(it.person)?.isMe == true }?.let { unit.name to it } } to true }?.let { (found, _) ->
                val shift = found?.second
                next = next.copy(hasSchedule = true, shiftUnit = found?.first, shift = shift?.let { if (it.type == "day_off") "Folga" else "${it.startTime}–${it.endTime} · ${it.shiftName}" }, shiftShort = shift?.let { if (it.type == "day_off") "Folga" else "${it.startTime.take(2)}h–${it.endTime.take(2)}h" })
            }
            if (modules.goals) quiet { val units = repository.api.goalUnits().units; (units.firstOrNull { it.id == goalUnitId } ?: units.firstOrNull())?.let { unit -> unit.name to repository.api.goals(unit.id) } }?.let { (name, data) ->
                data.goals.firstOrNull()?.let { goal -> next = next.copy(goalUnit = name, goalToday = goal.days.firstOrNull { it.date == data.today }?.value, goalDaily = goal.summary.dailyTarget, goalPercent = goal.summary.percentOfTarget) }
            }
            todayMutable.value = next
        }
    }
    fun avatar(document: Document) = run("Foto atualizada.") {
        require(document.bytes.size <= 5 * 1024 * 1024 && document.mimeType in listOf("image/jpeg", "image/png", "image/webp")) { "Escolha uma foto JPG, PNG ou WEBP até 5 MB." }
        val url = repository.avatar(document)
        mutable.value = mutable.value?.let { it.copy(profile = it.profile.copy(avatarUrl = url)) }
    }
}
