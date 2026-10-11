package com.coalaone.go.auth

import android.content.Context
import android.util.Base64
import com.coalaone.go.offline.Vault
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

interface BiometricPreferences {
    fun enabled(uid: String): Boolean
    fun ready(uid: String): Boolean
    fun record(uid: String, enabled: Boolean)
    fun clear()
}
@Singleton class BiometricStore @Inject constructor(@ApplicationContext context: Context, private val vault: Vault) : BiometricPreferences {
    private val prefs = context.getSharedPreferences("coala-go-biometric", Context.MODE_PRIVATE)
    override fun enabled(uid: String) = prefs.contains(vault.owner(uid))
    override fun ready(uid: String): Boolean = runCatching {
        val encoded = prefs.getString(vault.owner(uid), null) ?: return false
        val time = vault.open(uid, "biometric", Base64.decode(encoded, Base64.NO_WRAP)).decodeToString().toLong()
        System.currentTimeMillis() - time in 0 until 7 * 86_400_000L
    }.getOrDefault(false)
    override fun record(uid: String, enabled: Boolean) {
        if (enabled) prefs.edit().putString(vault.owner(uid), Base64.encodeToString(vault.seal(uid, "biometric", System.currentTimeMillis().toString().toByteArray()), Base64.NO_WRAP)).apply()
        else prefs.edit().remove(vault.owner(uid)).apply()
    }
    override fun clear() { prefs.edit().clear().apply() }
}
