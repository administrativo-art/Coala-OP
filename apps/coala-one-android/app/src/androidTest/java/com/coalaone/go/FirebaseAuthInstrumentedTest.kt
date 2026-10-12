package com.coalaone.go

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coalaone.go.auth.FirebaseGateway
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class FirebaseAuthInstrumentedTest {
    @Test fun nativeFirebaseLoginReauthenticationAndSignOutUseLocalAuthEmulator() = runBlocking {
        withTimeout(30_000) {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val app = FirebaseApp.initializeApp(context, FirebaseOptions.Builder().setApiKey("AIza" + "A".repeat(35)).setApplicationId("1:123456789:android:0000000000000000").setProjectId("demo-coala-go").build(), "auth-test-${UUID.randomUUID()}")
            val firebase = FirebaseAuth.getInstance(app).apply { useEmulator("10.0.2.2", 9099) }
            val email = "native-${UUID.randomUUID()}@example.invalid"
            val password = "Local-emulator-password-123"
            try {
                val created = firebase.createUserWithEmailAndPassword(email, password).await().user!!
                val uid = created.uid; firebase.signOut()
                val gateway = FirebaseGateway(firebase)
                assertEquals(uid, gateway.login(email, password).uid)
                assertTrue(gateway.token().isNotBlank())
                gateway.reauthenticate(password)
                assertTrue(runCatching { gateway.reauthenticate("wrong-password") }.isFailure)
                firebase.currentUser!!.delete().await()
                gateway.signOut(); assertNull(gateway.current)
            } finally { firebase.signOut(); app.delete() }
        }
    }
}
