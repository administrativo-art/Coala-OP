package com.coalaone.go

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.coalaone.go.data.AndroidKeyChallenge
import com.coalaone.go.data.DirectAppIdentity
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.Signature
import java.security.cert.CertificateFactory
import android.util.Base64
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DirectAppIdentityInstrumentedTest {
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
        File(context.cacheDir, "direct-app-test-proof.json").writeText(Json.encodeToString(proof))
    }
}
