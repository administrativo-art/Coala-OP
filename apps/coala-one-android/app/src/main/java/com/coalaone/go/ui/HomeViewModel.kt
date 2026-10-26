package com.coalaone.go.ui

import androidx.lifecycle.viewModelScope
import com.coalaone.go.auth.RuntimeMode
import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.offline.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the home screen says about today; every field is optional because each module may be off or fail on its own. */
data class HomeToday(val contextKey: String? = null, val loaded: Boolean = false, val scheduleAvailable: Boolean? = null,
    val hasSchedule: Boolean = false, val shift: String? = null, val shiftShort: String? = null, val shiftUnit: String? = null,
    val timeOptions: TimeOptions? = null, val timeClockOffset: Long? = null, val timePunches: List<OwnMarking> = emptyList(), val timeShift: OwnShift? = null,
    val timeWorkDate: String? = null, val timeShifts: List<OwnShift> = emptyList(), val timeTreatments: List<Treatment> = emptyList(),
    val timeTreatmentsAvailable: Boolean? = null, val timeOfflinePending: Int = 0,
    val goalUnit: String? = null, val goalToday: Double? = null, val goalDaily: Double? = null, val goalPercent: Double? = null, val openCounts: List<String> = emptyList(), val repositions: Int? = null)
/** Never expose a summary loaded for another owner while Compose schedules the next reload. */
fun HomeToday.visibleFor(contextKey: String) = takeIf { it.contextKey == contextKey } ?: HomeToday(contextKey = contextKey)
/** Profile and module grants must never be rendered for a different real/view-as identity. */
data class HomeProfile(val contextKey: String? = null, val response: ProfileResponse? = null)
fun HomeProfile.visibleFor(contextKey: String) = response.takeIf { this.contextKey == contextKey }
@HiltViewModel class HomeViewModel @Inject constructor(private val repository: ApiRepository, private val mode: RuntimeMode, private val queue: UploadQueue, private val scheduler: WorkScheduler,
    private val timeOfflineQueue: TimeOfflineQueue,
    private val developerViewAsStore: DeveloperViewAsSelectionStore = InMemoryDeveloperViewAsStore(),
    private val timeSummaryUpdates: TimeSummaryUpdates = TimeSummaryUpdates()) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(HomeProfile())
    val profile = mutable.asStateFlow()
    private var profileContextKey: String? = null
    private var profileGeneration = 0L
    private val queueMutable = MutableStateFlow<List<QueueRow>>(emptyList())
    val pending = queueMutable.asStateFlow()
    init {
        // The interceptor reads the same store, so the response and its UI context are keyed alike
        // even before Compose has a chance to run HomeScreen's context-aware refresh.
        refresh(developerViewAsStore.current() ?: mode.identity().uid)
        if (!mode.simulation) viewModelScope.launch {
            val uid = mode.identity().uid
            // A fila pertence sempre ao ator real. Falha ao reidratá-la não pode aparecer como
            // feedback da pessoa visualizada; o observador/worker volta a conciliá-la em separado.
            try { queue.list(uid) } catch (_: Exception) { queueMutable.value = emptyList() }
            scheduler.schedule(uid); queue.observe(uid).collect { queueMutable.value = it }
        }
    }
    fun refresh(contextKey: String = mode.identity().uid) {
        if (profileContextKey != contextKey) {
            profileContextKey = contextKey
            mutable.value = HomeProfile(contextKey = contextKey)
        }
        val generation = ++profileGeneration
        feedbackMutable.value = Feedback(busy = true)
        viewModelScope.launch {
            try {
                val response = repository.profile()
                if (profileContextKey == contextKey && profileGeneration == generation) {
                    mutable.value = HomeProfile(contextKey, response)
                    feedbackMutable.value = feedbackMutable.value.copy(busy = false)
                }
            } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) {
                if (profileContextKey == contextKey && profileGeneration == generation) {
                    feedbackMutable.value = Feedback(error = Errors.classify(cause).message)
                }
            }
        }
    }
    private val todayMutable = MutableStateFlow(HomeToday())
    val today = todayMutable.asStateFlow()
    private var todayLoadedAt = 0L
    private var todayContextKey: String? = null
    private var todayGeneration = 0L
    private var timeOfflinePendingCount = 0
    private val confirmedPunches = linkedMapOf<String, OwnMarking>()
    private suspend fun <T> quiet(block: suspend () -> T): T? = try { block() } catch (cause: kotlinx.coroutines.CancellationException) { throw cause } catch (_: Exception) { null }
    private fun mergedPunches(server: List<OwnMarking>) = (server + confirmedPunches.values)
        .associateBy { it.receiptId }.values.sortedBy { it.markedAt }
    private fun reconciledTime(value: HomeToday): HomeToday {
        val merged = mergedPunches(value.timePunches)
        if (value.timeShifts.isEmpty() && merged.isEmpty()) return value
        val context = TimeRules.homeWorkContext(java.time.LocalDate.now(), value.timeShifts, merged)
        return value.copy(timeWorkDate = context.date, timeShift = context.shift, timePunches = context.markings,
            shiftUnit = context.shift?.unitName, shift = TimeRules.shiftText(context.shift),
            shiftShort = context.shift?.let { if (it.type == "day_off") "Folga" else "${it.startTime?.take(2)}h–${it.endTime?.take(2)}h" })
    }
    private fun publishToday(contextKey: String, generation: Long, value: HomeToday) {
        if (todayContextKey == contextKey && todayGeneration == generation) {
            // Queued or just-confirmed punches can change while remote Home reads are in flight.
            // Every publication is reconciled so a stale response cannot restore the previous journey.
            val pending = if (contextKey == mode.identity().uid) timeOfflinePendingCount else 0
            todayMutable.value = reconciledTime(value).copy(timeOfflinePending = pending)
        }
    }

    private data class TimeSummary(val options: TimeOptions?, val markings: List<OwnMarking>, val month: OwnMonth?, val elapsed: Long)

    init {
        if (!mode.simulation) mode.identity().uid.let { uid -> viewModelScope.launch {
            timeOfflineQueue.observe(uid).collect { rows ->
                timeOfflinePendingCount = rows.size
                if (todayContextKey == uid) todayMutable.value = todayMutable.value.copy(timeOfflinePending = rows.size)
            }
        } }
        viewModelScope.launch {
            timeSummaryUpdates.updates.collect { update ->
                if (todayContextKey == update.contextKey) {
                    confirmedPunches[update.marking.receiptId] = update.marking
                    todayMutable.value = reconciledTime(todayMutable.value)
                }
            }
        }
    }
    /**
     * Read once when the home opens and again on pull-to-refresh or after two minutes away, never on a timer.
     * A module that is off is not asked; a failure only leaves its line out.
     */
    fun loadToday(modules: Modules, goalUnitId: String?, contextKey: String, force: Boolean = false) {
        if (todayContextKey != contextKey) {
            todayContextKey = contextKey
            todayLoadedAt = 0L
            todayGeneration++
            confirmedPunches.clear()
            todayMutable.value = HomeToday(contextKey = contextKey)
        }
        if (!force && System.currentTimeMillis() - todayLoadedAt < 120_000) return
        todayLoadedAt = System.currentTimeMillis()
        val generation = ++todayGeneration
        viewModelScope.launch {
            coroutineScope {
            var next = HomeToday(contextKey = contextKey, loaded = true,
                timeOfflinePending = if (contextKey == mode.identity().uid) timeOfflinePendingCount else 0)
            val now = java.time.LocalDate.now()
            val previous = now.minusDays(1)
            val counts = async { if (modules.stockCount) quiet { repository.countContext().openSessions.map { it.kioskName } } else null }
            val repositions = async { if (modules.repositionReceipt) quiet { repository.repositions().activities.size } else null }
            val goals = async {
                if (!modules.goals) null else quiet {
                    val units = repository.api.goalUnits().units
                    (units.firstOrNull { it.id == goalUnitId } ?: units.firstOrNull())?.let { unit -> unit.name to repository.api.goals(unit.id) }
                }
            }
            // Treatments refine the mini-summary, but must not hold back the clock, punch count or shift.
            val timeTreatments = async {
                if (!modules.timeRecording) null else {
                    val months = listOf(previous.toString().take(7), now.toString().take(7)).distinct()
                    val reads = months.map { month -> quiet { repository.api.adjustments(month).treatments } }
                    if (reads.any { it == null }) null else reads.filterNotNull().flatten()
                }
            }
            val time = async {
                if (!modules.timeRecording) null else {
                    val elapsed = android.os.SystemClock.elapsedRealtime()
                    coroutineScope {
                        val options = quiet { repository.api.timeOptions(now.toString()) }
                        val markings = async { quiet { repository.api.markings(previous.toString(), now.toString()).markings }.orEmpty() }
                        val month = async { quiet { repository.api.timeMonth(now.toString().take(7)) } }
                        val previousMonth = async { if (previous.month == now.month) null else quiet { repository.api.timeMonth(previous.toString().take(7)) } }
                        val currentMonth = month.await()
                        TimeSummary(options, markings.await(), currentMonth?.copy(shifts = previousMonth.await()?.shifts.orEmpty() + currentMonth.shifts), elapsed)
                    }
                }
            }
            val schedule = async {
                if (modules.timeRecording || !modules.schedule) null else quiet { repository.api.schedule(now.year, now.monthValue) }
            }
            if (modules.timeRecording) {
                val summary = time.await()!!
                val options = summary.options
                val markings = summary.markings
                val month = summary.month
                val shifts = month?.shifts.orEmpty()
                val context = TimeRules.homeWorkContext(now, shifts, mergedPunches(markings))
                val ownShift = context.shift
                next = next.copy(timeOptions = options, timeClockOffset = TimeRules.clockOffset(options?.officialClock, summary.elapsed),
                    timePunches = context.markings, timeShift = ownShift, timeWorkDate = context.date, timeShifts = shifts,
                    scheduleAvailable = month != null, hasSchedule = ownShift != null,
                    shiftUnit = ownShift?.unitName, shift = TimeRules.shiftText(ownShift),
                    shiftShort = ownShift?.let { if (it.type == "day_off") "Folga" else "${it.startTime?.take(2)}h–${it.endTime?.take(2)}h" })
            } else if (modules.schedule) {
                val scheduleResult = schedule.await()
                val found = scheduleResult?.units?.firstNotNullOfOrNull { unit -> unit.shifts.firstOrNull { it.date == now.toString() && unit.people.getOrNull(it.person)?.isMe == true }?.let { unit.name to it } }
                val shift = found?.second
                next = next.copy(scheduleAvailable = scheduleResult != null, hasSchedule = found != null,
                    shiftUnit = found?.first, shift = shift?.let { if (it.type == "day_off") "Folga" else "${it.startTime}–${it.endTime} · ${it.shiftName}" },
                    shiftShort = shift?.let { if (it.type == "day_off") "Folga" else "${it.startTime.take(2)}h–${it.endTime.take(2)}h" })
            }
            // Clock, punch count and shift become visible without waiting for unrelated Home modules.
            publishToday(contextKey, generation, next)
            val treatments = timeTreatments.await()
            next = if (treatments == null) next.copy(timeTreatmentsAvailable = false)
                else next.copy(timeTreatments = treatments, timeTreatmentsAvailable = true)
            publishToday(contextKey, generation, next)
            counts.await()?.let { next = next.copy(openCounts = it) }
            repositions.await()?.let { next = next.copy(repositions = it) }
            goals.await()?.let { (name, data) ->
                data.goals.firstOrNull()?.let { goal -> next = next.copy(goalUnit = name, goalToday = goal.days.firstOrNull { it.date == data.today }?.value, goalDaily = goal.summary.dailyTarget, goalPercent = goal.summary.percentOfTarget) }
            }
            publishToday(contextKey, generation, next.copy(timePunches = mergedPunches(next.timePunches)))
            }
        }
    }
    fun avatar(document: Document) {
        if (feedbackMutable.value.busy) return
        val contextKey = profileContextKey
        feedbackMutable.value = Feedback(busy = true)
        viewModelScope.launch {
            try {
                require(document.bytes.size <= 5 * 1024 * 1024 && document.mimeType in listOf("image/jpeg", "image/png", "image/webp")) { "Escolha uma foto JPG, PNG ou WEBP até 5 MB." }
                val url = repository.avatar(document)
                if (profileContextKey == contextKey) {
                    profileGeneration++ // an older refresh of the same profile must not restore the previous photo
                    mutable.value = mutable.value.let { current ->
                        current.copy(response = current.response?.let { response -> response.copy(profile = response.profile.copy(avatarUrl = url)) })
                    }
                    feedbackMutable.value = Feedback(notice = "Foto atualizada.")
                }
            } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) {
                if (profileContextKey == contextKey) feedbackMutable.value = Feedback(error = Errors.classify(cause).message)
            }
        }
    }
}
