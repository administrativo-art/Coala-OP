package com.coalaone.go

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.coalaone.go.data.AndroidKeyChallenge
import com.coalaone.go.data.DirectAppIdentity
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.security.Signature
import java.security.cert.CertificateFactory
import android.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DirectAppIdentityInstrumentedTest {
    @Test fun localAuthorizationSurvivesReopeningItsDatabaseAndKeystore() = kotlinx.coroutines.runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val uid = "demo-local-permit-${java.util.UUID.randomUUID()}"
        val name = "test-local-permit-${java.util.UUID.randomUUID()}.db"
        val json = Json { encodeDefaults = true; explicitNulls = true }
        val vault = com.coalaone.go.offline.Vault()
        fun openDatabase() = androidx.room.Room.databaseBuilder(context,
            com.coalaone.go.offline.TimeOfflineDatabase::class.java, name).build()
        var database = openDatabase()
        try {
            val identity = com.coalaone.go.offline.TimeDeviceIdentity(context, vault)
            val queue = com.coalaone.go.offline.TimeOfflineStore(database, vault, identity, json)
            val elapsed = android.os.SystemClock.elapsedRealtime()
            val request = requireNotNull(queue.permitRequest(uid, "2026-10-27", elapsed, "pilot"))
            val anchor = java.time.Instant.now()
            queue.savePermit(uid, com.coalaone.go.data.OfflinePermit("demo-permit", request.installationId,
                request.deviceKeyId, request.keySecurity, request.bootCount, elapsed, anchor.toString(), anchor.toString(),
                anchor.plusSeconds(43_200).toString(), listOf(com.coalaone.go.data.OfflinePermitUnit("demo-unit", "Test unit", "America/Belem")), "pilot"))
            assertNotNull(queue.cachedOptions(uid, android.os.SystemClock.elapsedRealtime()))
            database.close()
            database = openDatabase()
            val reopenedVault = com.coalaone.go.offline.Vault()
            val reopened = com.coalaone.go.offline.TimeOfflineStore(database, reopenedVault,
                com.coalaone.go.offline.TimeDeviceIdentity(context, reopenedVault), json)
            assertNotNull(reopened.cachedOptions(uid, android.os.SystemClock.elapsedRealtime()))
            assertNull(reopened.permitRequest(uid, "2026-10-27", android.os.SystemClock.elapsedRealtime(), "pilot"))
        } finally {
            database.close()
            context.deleteDatabase(name)
            java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.also {
                it.deleteEntry("coala.go.time.offline.v1.${vault.owner(uid)}")
                it.deleteEntry("coala.go.queue.v1.${vault.owner(uid)}")
            }
        }
    }

    @Test fun hardwareProofWorksWithoutAPlayStoreInstallation() {
        val token = InstrumentationRegistry.getArguments().getString("coalaChallenge") ?: "local-test-challenge"
        val proof = DirectAppIdentity().proof("demo-android-user", AndroidKeyChallenge(token, Long.MAX_VALUE))
        assertEquals("android-key", proof.provider)
        assertTrue(proof.certificateChain.size >= 2)
        val certificate = CertificateFactory.getInstance("X.509").generateCertificate(
            Base64.decode(proof.certificateChain.first(), Base64.DEFAULT).inputStream())
        val valid = Signature.getInstance("SHA256withECDSA").run {
            initVerify(certificate.publicKey)
            update("coala-go-direct-app-v1\ndemo-android-user\n$token".toByteArray())
            verify(Base64.decode(proof.signature, Base64.DEFAULT))
        }
        assertTrue(valid)
        // Public test evidence only: no account, Firebase token or private key is exported.
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        // Match the production serializer: the default provider is required by the server schema.
        val wireJson = Json { encodeDefaults = true; explicitNulls = true }
        val encoded = wireJson.encodeToString(proof)
        assertEquals("android-key", Json.parseToJsonElement(encoded).jsonObject["provider"]?.jsonPrimitive?.content)
        File(context.cacheDir, "direct-app-test-proof.json").writeText(encoded)
    }
}
