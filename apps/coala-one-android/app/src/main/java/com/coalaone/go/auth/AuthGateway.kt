package com.coalaone.go.auth

import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

data class Identity(val uid: String, val email: String?)
interface AuthGateway {
    val identities: Flow<Identity?>
    val current: Identity?
    suspend fun login(email: String, password: String): Identity
    suspend fun loginWithGoogle(idToken: String, expectedUid: String? = null): Identity
    suspend fun reauthenticate(password: String)
    suspend fun token(forceRefresh: Boolean = false): String
    fun signOut()
}
@Singleton class FirebaseGateway @Inject constructor(private val firebase: FirebaseAuth) : AuthGateway {
    override val identities = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser?.let { user -> Identity(user.uid, user.email) }) }
        firebase.addAuthStateListener(listener)
        awaitClose { firebase.removeAuthStateListener(listener) }
    }
    override val current get() = firebase.currentUser?.let { Identity(it.uid, it.email) }
    override suspend fun login(email: String, password: String): Identity {
        val user = firebase.signInWithEmailAndPassword(email.trim(), password).await().user ?: error("Login não confirmado")
        return Identity(user.uid, user.email)
    }
    override suspend fun loginWithGoogle(idToken: String, expectedUid: String?): Identity {
        val result = firebase.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
        val user = result.user ?: error("Login Google não confirmado")
        if (result.additionalUserInfo?.isNewUser == true) {
            runCatching { user.delete().await() }
            firebase.signOut()
            error("Esta conta Google ainda não foi vinculada a um acesso do Coala Go.")
        }
        if (expectedUid != null && user.uid != expectedUid) {
            firebase.signOut()
            error("A conta Google pertence a outro cadastro.")
        }
        return Identity(user.uid, user.email)
    }
    override suspend fun reauthenticate(password: String) {
        val user = firebase.currentUser ?: error("Sessão expirada")
        user.reauthenticate(EmailAuthProvider.getCredential(user.email ?: error("Conta sem e-mail"), password)).await()
    }
    override suspend fun token(forceRefresh: Boolean): String = try {
        firebase.currentUser?.getIdToken(forceRefresh)?.await()?.token ?: error("Sessão expirada")
    } catch (cause: com.google.firebase.FirebaseNetworkException) {
        throw com.coalaone.go.data.Errors.classify(cause)
    }
    override fun signOut() = firebase.signOut()
}
