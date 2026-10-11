package com.coalaone.go.ui

import com.coalaone.go.data.*
import com.coalaone.go.domain.Rules
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.time.LocalDate
import javax.inject.Inject

data class ModulesState(val schedules: Map<String, MonthSchedule> = emptyMap(), val day: LocalDate = LocalDate.now(), val selectedScheduleUnit: String = "", val onlyMine: Boolean = false, val goalUnits: List<UnitRef> = emptyList(), val goals: UnitGoals? = null, val signage: SignageUnits? = null, val paired: PairResponse? = null)
@HiltViewModel class ModulesViewModel @Inject constructor(private val repository: ApiRepository) : FeedbackViewModel() {
    private val mutable = MutableStateFlow(ModulesState())
    val state = mutable.asStateFlow()
    fun schedule(day: LocalDate = mutable.value.day) = run {
        val keys = Rules.week(day).map { it.year to it.monthValue }.distinct()
        var schedules = mutable.value.schedules
        for ((year, month) in keys) {
            val key = "%04d-%02d".format(year, month)
            if (key !in schedules) schedules = schedules + (key to repository.api.schedule(year, month))
        }
        mutable.update { it.copy(schedules = schedules, day = day) }
    }
    fun refreshSchedule() { mutable.update { it.copy(schedules = emptyMap()) }; schedule() }
    fun scheduleFilter(unitId: String, onlyMine: Boolean) { mutable.update { it.copy(selectedScheduleUnit = unitId, onlyMine = onlyMine) } }
    fun goalUnits() = run { mutable.update { it.copy(goalUnits = repository.api.goalUnits().units) } }
    fun goals(unit: String) = run { mutable.update { it.copy(goals = repository.api.goals(unit)) } }
    fun signage() = run { mutable.update { it.copy(signage = repository.api.signage()) } }
    fun pair(unitId: String, screenId: String?, orientation: String, text: String) = run("Tela conectada.") {
        val code = Rules.pairingCode(text) ?: throw IllegalArgumentException("Código de tela inválido.")
        require(orientation in listOf("landscape", "portrait"))
        mutable.update { it.copy(paired = repository.api.pair(PairScreen(unitId, screenId, orientation, code)), signage = repository.api.signage()) }
    }
}
