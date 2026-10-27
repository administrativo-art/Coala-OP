package com.coalaone.go.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.Serializable

@Serializable data class AndroidKeyChallenge(val challengeToken: String, val expiresAt: Long)
@Serializable data class AndroidKeyProof(val provider: String = "android-key", val challengeToken: String,
    val certificateChain: List<String>, val signature: String)

/** Ephemeral hardware proof of the installed package and APK signer; independent of a store. */
@Singleton class DirectAppIdentity @Inject constructor() {
    fun proof(uid: String, challenge: AndroidKeyChallenge): AndroidKeyProof {
        val alias = "coala.go.app.attestation.${UUID.randomUUID()}"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setAttestationChallenge(MessageDigest.getInstance("SHA-256").digest(challenge.challengeToken.toByteArray()))
                    .build())
            }.generateKeyPair()
            val entry = store.getEntry(alias, null) as KeyStore.PrivateKeyEntry
            val signature = Signature.getInstance("SHA256withECDSA").run {
                initSign(entry.privateKey)
                update("coala-go-direct-app-v1\n$uid\n${challenge.challengeToken}".toByteArray())
                sign()
            }
            return AndroidKeyProof(challengeToken = challenge.challengeToken,
                certificateChain = store.getCertificateChain(alias).map { Base64.encodeToString(it.encoded, Base64.NO_WRAP) },
                signature = Base64.encodeToString(signature, Base64.NO_WRAP))
        } finally { if (store.containsAlias(alias)) store.deleteEntry(alias) }
    }
}
