package com.coalaone.go.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.*
import com.coalaone.go.data.ApiService
import com.coalaone.go.data.AppAttestation
import com.coalaone.go.data.DEVELOPER_VIEW_AS_EMAIL
import com.coalaone.go.data.DeveloperViewAsSelection
import com.coalaone.go.data.DeveloperViewAsSelectionStore
import com.coalaone.go.data.DeveloperViewAsUser
import com.coalaone.go.data.Errors
import com.coalaone.go.data.InMemoryDeveloperViewAsStore
import com.coalaone.go.data.ResetRequest
import com.coalaone.go.push.PushController
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SessionState(val identity: Identity? = null, val loading: Boolean = true, val locked: Boolean = true, val busy: Boolean = false, val error: String? = null, val resetSent: Boolean = false, val simulation: Boolean = false)
data class DeveloperViewAsState(val available: Boolean = false, val users: List<DeveloperViewAsUser> = emptyList(), val targetUserId: String? = null, val targetName: String? = null, val busy: Boolean = false, val error: String? = null)
@HiltViewModel class SessionViewModel @Inject constructor(private val auth: AuthGateway, private val gate: SessionGate, val mode: RuntimeMode, private val biometric: BiometricPreferences, private val api: ApiService, private val attestation: AppAttestation, val push: PushController, private val developerViewAsStore: DeveloperViewAsSelectionStore = InMemoryDeveloperViewAsStore(), private val demoApi: com.coalaone.go.data.DemoApi = com.coalaone.go.data.DemoApi()) : ViewModel() {
    private val mutable = MutableStateFlow(SessionState())
    val state = mutable.asStateFlow()
    private val developerViewAsMutable = MutableStateFlow(DeveloperViewAsState())
    val developerViewAs = developerViewAsMutable.asStateFlow()
    private var stoppedAt = 0L
    init { viewModelScope.launch { auth.identities.collect { identity -> if (!mode.simulation) {
        if (identity?.email?.trim()?.lowercase() != DEVELOPER_VIEW_AS_EMAIL) { developerViewAsStore.clear(); developerViewAsMutable.value = DeveloperViewAsState() }
        mutable.update { it.copy(identity = identity, loading = false, locked = identity == null || !gate.permits(identity.uid)) }; push.reflect(identity?.uid)
    } } } }
    fun login(email: String, password: String) = perform {
        require(BuildConfig.FIREBASE_API_KEY.isNotBlank()) { "Configure o Firebase público deste build antes de entrar." }
        val previous = auth.current?.uid
        val identity = auth.login(email, password)
        if (previous != identity.uid) biometric.clear() else if (biometric.enabled(identity.uid)) biometric.record(identity.uid, true)
        gate.unlock(identity.uid)
        mutable.update { it.copy(identity = identity, locked = false, resetSent = false) }
        push.reflect(identity.uid); push.foreground(identity.uid)
    }
    fun unlock(password: String, enableBiometric: Boolean) = perform {
        auth.reauthenticate(password)
        val identity = auth.current ?: error("Sessão expirada")
        biometric.record(identity.uid, enableBiometric); gate.unlock(identity.uid)
        mutable.update { it.copy(locked = false) }
    }
    fun biometricReady() = auth.current?.uid?.let(biometric::ready) == true
    fun biometricEnabled() = auth.current?.uid?.let(biometric::enabled) == true
    fun unlockBiometric() { auth.current?.uid?.takeIf { biometric.ready(it) }?.let { gate.unlock(it); mutable.update { current -> current.copy(locked = false, error = null) } } }
    fun reset(email: String) = perform { require(email.contains('@')) { "Informe seu e-mail." }; api.reset(ResetRequest(email.trim())); mutable.update { it.copy(resetSent = true) } }
    fun simulate() { mode.simulate(); mutable.value = SessionState(mode.identity(), loading = false, locked = false, simulation = true) }
    fun loadDeveloperViewAs() {
        if (mutable.value.identity?.email?.trim()?.lowercase() != DEVELOPER_VIEW_AS_EMAIL || developerViewAsMutable.value.busy) return
        developerViewAsMutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val directory = sessionApi().developerViewAs()
                developerViewAsMutable.value = DeveloperViewAsState(true, directory.users, directory.targetUserId, directory.targetUser?.username)
            } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) { developerViewAsMutable.update { it.copy(busy = false, error = Errors.classify(cause).message) } }
        }
    }
    fun selectDeveloperViewAs(userId: String) {
        val user = developerViewAsMutable.value.users.firstOrNull { it.id == userId } ?: return
        if (developerViewAsMutable.value.busy) return
        developerViewAsMutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                sessionApi().startDeveloperViewAs(DeveloperViewAsSelection(user.id))
                developerViewAsStore.select(user.id)
                developerViewAsMutable.update { it.copy(targetUserId = user.id, targetName = user.username, busy = false) }
            } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) { developerViewAsMutable.update { it.copy(busy = false, error = Errors.classify(cause).message) } }
        }
    }
    fun stopDeveloperViewAs() {
        if (developerViewAsMutable.value.busy) return
        developerViewAsMutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                sessionApi().stopDeveloperViewAs()
                developerViewAsStore.clear()
                developerViewAsMutable.update { it.copy(targetUserId = null, targetName = null, busy = false) }
            } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) { developerViewAsMutable.update { it.copy(busy = false, error = Errors.classify(cause).message) } }
        }
    }
    fun signOut() { if (mutable.value.busy) return; mutable.update { it.copy(busy = true) }; viewModelScope.launch {
        try { push.logout(auth.current?.uid) } finally { developerViewAsStore.clear(); developerViewAsMutable.value = DeveloperViewAsState(); gate.lock(); attestation.clear(); biometric.clear(); mode.reset(); auth.signOut(); mutable.value = SessionState(loading = false) }
    } }
    fun stopped() { stoppedAt = System.currentTimeMillis() }
    fun resumed() {
        if (stoppedAt > 0 && System.currentTimeMillis() - stoppedAt > 300_000 && !mode.simulation) { gate.lock(); mutable.update { it.copy(locked = true) } }
        stoppedAt = 0
        if (!mode.simulation) { push.reflect(auth.current?.uid); push.foreground(auth.current?.uid) }
    }
    private fun sessionApi() = if (mode.simulation) demoApi else api
    private fun perform(work: suspend () -> Unit) {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try { work() }
            catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) { mutable.update { it.copy(error = if (cause is IllegalArgumentException) cause.message else "Não foi possível autenticar. Confira os dados e a conexão.") } }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
}
