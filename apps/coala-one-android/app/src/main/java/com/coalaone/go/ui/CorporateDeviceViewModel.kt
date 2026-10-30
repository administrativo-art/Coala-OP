package com.coalaone.go.ui

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.data.ApiService
import com.coalaone.go.data.CorporateDeviceRequest
import com.coalaone.go.data.Errors
import com.coalaone.go.offline.TimeDeviceIdentity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CorporateDeviceState(val loading: Boolean = false, val busy: Boolean = false,
    val status: String? = null, val model: String? = null, val error: String? = null)

@HiltViewModel class CorporateDeviceViewModel @Inject constructor(
    private val auth: AuthGateway, private val api: ApiService, private val identity: TimeDeviceIdentity,
) : ViewModel() {
    private val mutable = MutableStateFlow(CorporateDeviceState())
    val state = mutable.asStateFlow()
    fun load() {
        if (auth.current == null || mutable.value.loading) return
        mutable.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try { val result = api.corporateDevice(identity.installationId()); mutable.update { it.copy(status = result.device?.status, model = result.device?.model) } }
            catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) { mutable.update { it.copy(error = Errors.classify(cause).message) } }
            finally { mutable.update { it.copy(loading = false) } }
        }
    }
    fun request() {
        val uid = auth.current?.uid ?: return
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val key = identity.key(uid)
                val result = api.requestCorporateDevice(CorporateDeviceRequest(identity.installationId(), key.keyId,
                    key.publicKey, key.security, BuildConfig.VERSION_NAME, "${Build.MANUFACTURER} ${Build.MODEL}".trim(), Build.VERSION.RELEASE))
                mutable.update { it.copy(status = result.status, model = "${Build.MANUFACTURER} ${Build.MODEL}".trim()) }
            } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
            catch (cause: Exception) { mutable.update { it.copy(error = Errors.classify(cause).message) } }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
}
