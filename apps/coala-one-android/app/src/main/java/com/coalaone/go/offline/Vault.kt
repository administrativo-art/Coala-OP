package com.coalaone.go.offline

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

@Singleton class Vault @Inject constructor() {
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    fun owner(uid: String) = MessageDigest.getInstance("SHA-256").digest(uid.toByteArray()).joinToString("") { "%02x".format(it) }
    @Synchronized private fun key(uid: String): SecretKey {
        val alias = "coala.go.queue.v1.${owner(uid)}"
        return (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    fun seal(uid: String, id: String, plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(uid))
        cipher.updateAAD("${owner(uid)}:$id".toByteArray())
        return byteArrayOf(1, cipher.iv.size.toByte()) + cipher.iv + cipher.doFinal(plain)
    }
    fun open(uid: String, id: String, sealed: ByteArray): ByteArray {
        require(sealed.size >= 30 && sealed[0] == 1.toByte() && sealed[1] == 12.toByte()) { "Documento cifrado inválido" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(uid), GCMParameterSpec(128, sealed.copyOfRange(2, 14)))
        cipher.updateAAD("${owner(uid)}:$id".toByteArray())
        return cipher.doFinal(sealed.copyOfRange(14, sealed.size))
    }
}
