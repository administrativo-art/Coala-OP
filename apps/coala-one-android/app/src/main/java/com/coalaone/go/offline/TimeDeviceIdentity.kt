package com.coalaone.go.offline

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class TimeDeviceKey(val keyId: String, val publicKey: String, val security: String)

@Singleton class TimeDeviceIdentity @Inject constructor(@ApplicationContext private val context: Context, private val vault: Vault) {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun alias(uid: String) = "coala.go.time.offline.v1.${vault.owner(uid)}"
    @Synchronized private fun entry(uid: String): KeyStore.PrivateKeyEntry {
        val alias = alias(uid)
        (store.getEntry(alias, null) as? KeyStore.PrivateKeyEntry)?.let { return it }
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256).build())
        }.generateKeyPair()
        return store.getEntry(alias, null) as KeyStore.PrivateKeyEntry
    }
    fun key(uid: String): TimeDeviceKey {
        val entry = entry(uid)
        val info = KeyFactory.getInstance(entry.privateKey.algorithm, "AndroidKeyStore")
            .getKeySpec(entry.privateKey, KeyInfo::class.java)
        @Suppress("DEPRECATION")
        val hardwareProtected = if (Build.VERSION.SDK_INT >= 31) info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT
            || info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX else info.isInsideSecureHardware
        require(hardwareProtected) { "Este aparelho não possui chave segura compatível com o ponto offline." }
        val encoded = entry.certificate.publicKey.encoded
        val keyId = MessageDigest.getInstance("SHA-256").digest(encoded).joinToString("") { "%02x".format(it) }
        val security = if (Build.VERSION.SDK_INT >= 31 && info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX) "strongbox" else "tee"
        return TimeDeviceKey(keyId, Base64.encodeToString(encoded, Base64.NO_WRAP), security)
    }
    fun sign(uid: String, canonical: String): String = Base64.encodeToString(Signature.getInstance("SHA256withECDSA").run {
        initSign(entry(uid).privateKey); update(canonical.toByteArray()); sign()
    }, Base64.NO_WRAP)
    fun bootCount(): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
    fun installationId(): String {
        val preferences = context.getSharedPreferences("coala-go-time-device", Context.MODE_PRIVATE)
        return preferences.getString("installationId", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("installationId", it).apply()
        }
    }
}
