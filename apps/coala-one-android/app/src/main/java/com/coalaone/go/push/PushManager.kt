package com.coalaone.go.push

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.app.NotificationManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.auth.RuntimeMode
import com.coalaone.go.data.ApiService
import com.coalaone.go.data.PushDeviceRegistration
import com.coalaone.go.data.PushDeviceRemoval
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class PushStatus(val enabled: Boolean = false, val busy: Boolean = false, val error: String? = null, val permitted: Boolean = false)
interface PushController {
    val state: StateFlow<PushStatus>
    val permissionRequested: Boolean
    fun markPermissionRequested()
    fun permissionGranted(): Boolean
    fun reflect(uid: String?)
    fun enable(uid: String)
    fun foreground(uid: String?)
    fun disable(uid: String)
    suspend fun logout(uid: String?)
}

@Singleton class PushManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val auth: AuthGateway,
    private val mode: RuntimeMode,
    private val api: ApiService,
) : PushController {
    private val prefs = context.getSharedPreferences("push_consent", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val operations = Mutex()
    private val mutable = MutableStateFlow(PushStatus())
    override val state = mutable.asStateFlow()
    private val installationId: String get() = prefs.getString("installation", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("installation", it).apply() }
    val optedIn: Boolean get() = prefs.getBoolean("enabled", false)
    val boundOwner: String? get() = prefs.getString("owner", null)
    val currentAuthenticatedOwner: String? get() = auth.current?.uid?.takeIf { it == boundOwner && !mode.simulation }
    override val permissionRequested: Boolean get() = prefs.getBoolean("permission_requested", false)
    override fun markPermissionRequested() { prefs.edit().putBoolean("permission_requested", true).apply() }
    override fun permissionGranted() = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    private fun available() = !mode.simulation && !BuildConfig.LOCAL_TEST && BuildConfig.FIREBASE_SENDER_ID.isNotBlank() && BuildConfig.FIREBASE_APP_ID.isNotBlank()

    override fun reflect(uid: String?) { mutable.value = PushStatus(enabled = uid != null && optedIn && boundOwner == uid, permitted = permissionGranted()) }

    override fun enable(uid: String) {
        if (mutable.value.busy) return
        if (!available()) { mutable.value = PushStatus(error = "Notificações indisponíveis neste modo."); return }
        if (!permissionGranted()) { mutable.value = PushStatus(error = "Permita notificações nas configurações do Android."); return }
        prefs.edit().putString("owner", uid).putBoolean("enabled", true).apply()
        mutable.value = PushStatus(enabled = true, busy = true, permitted = true)
        scope.launch { operations.withLock { register(uid) } }
    }

    private suspend fun register(uid: String) {
        try {
            if (!optedIn || boundOwner != uid || auth.current?.uid != uid || !permissionGranted() || !available()) return
            val messaging = FirebaseMessaging.getInstance()
            messaging.isAutoInitEnabled = true
            val token = messaging.token.await()
            if (!optedIn || boundOwner != uid || auth.current?.uid != uid) return
            api.registerPush(PushDeviceRegistration(installationId, token, context.packageName, appVersion = BuildConfig.VERSION_NAME), uid)
            if (optedIn && boundOwner == uid && auth.current?.uid == uid) mutable.value = PushStatus(enabled = true, permitted = permissionGranted())
        } catch (cause: CancellationException) { throw cause }
        catch (_: Exception) {
            if (optedIn && boundOwner == uid && auth.current?.uid == uid) mutable.value = PushStatus(enabled = true, permitted = permissionGranted(), error = "Não foi possível ativar agora. Tentaremos ao abrir o aplicativo novamente.")
        } finally { if (optedIn && boundOwner == uid) mutable.value = mutable.value.copy(busy = false) }
    }

    override fun foreground(uid: String?) {
        if (uid != null && optedIn && boundOwner == uid && permissionGranted() && !mutable.value.busy && available()) {
            mutable.value = PushStatus(enabled = true, busy = true, permitted = true)
            scope.launch { operations.withLock { register(uid) } }
        }
    }
    fun onNewToken() { foreground(auth.current?.uid) }

    override fun disable(uid: String) {
        if (boundOwner != uid) return
        context.getSystemService(NotificationManager::class.java).cancelAll()
        prefs.edit().putBoolean("enabled", false).remove("owner").apply()
        mutable.value = PushStatus()
        if (!available()) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        scope.launch { operations.withLock { revoke(uid) } }
    }

    override suspend fun logout(uid: String?) {
        if (uid == null || boundOwner != uid) return
        context.getSystemService(NotificationManager::class.java).cancelAll()
        prefs.edit().putBoolean("enabled", false).remove("owner").apply()
        mutable.value = PushStatus()
        if (!available()) return
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        withTimeoutOrNull(3_000) { operations.withLock { revoke(uid) } }
    }

    private suspend fun revoke(uid: String) {
        try { api.removePush(PushDeviceRemoval(installationId), uid) } catch (_: Exception) { /* Local consent is already off. */ }
        try { FirebaseMessaging.getInstance().deleteToken().await() } catch (_: Exception) { /* No push is displayed without consent. */ }
    }

    @Synchronized fun seen(eventId: String): Boolean {
        val owner = currentAuthenticatedOwner ?: return true
        val key = PushPolicy.eventKey(owner, eventId)
        val seen = prefs.getString("events", "").orEmpty().split(',').filter(String::isNotBlank)
        if (key in seen) return true
        prefs.edit().putString("events", (seen.takeLast(49) + key).joinToString(",")).apply()
        return false
    }
}
