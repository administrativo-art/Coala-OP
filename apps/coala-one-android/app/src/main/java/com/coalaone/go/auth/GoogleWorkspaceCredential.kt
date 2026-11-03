package com.coalaone.go.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

sealed interface GoogleCredentialResult {
    data class Token(val value: String, val email: String) : GoogleCredentialResult
    data object Cancelled : GoogleCredentialResult
}

suspend fun requestGoogleWorkspaceCredential(
    context: Context,
    serverClientId: String,
    authorizedOnly: Boolean,
): GoogleCredentialResult {
    require(serverClientId.isNotBlank()) { "O acesso Google ainda não está configurado neste aplicativo." }
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(serverClientId)
        .setFilterByAuthorizedAccounts(authorizedOnly)
        .setAutoSelectEnabled(false)
        .build()
    val manager = CredentialManager.create(context)
    return try {
        tokenFrom(manager.getCredential(context, GetCredentialRequest.Builder().addCredentialOption(option).build()))
    } catch (_: GetCredentialCancellationException) {
        GoogleCredentialResult.Cancelled
    } catch (_: NoCredentialException) {
        // The phone has no Google account the app can offer. The full sign-in sheet lets the person
        // pick or add the account (for example the company e-mail) without leaving the app.
        val signIn = GetSignInWithGoogleOption.Builder(serverClientId).build()
        try {
            tokenFrom(manager.getCredential(context, GetCredentialRequest.Builder().addCredentialOption(signIn).build()))
        } catch (_: GetCredentialCancellationException) {
            GoogleCredentialResult.Cancelled
        } catch (_: NoCredentialException) {
            throw IllegalStateException("Nenhuma conta Google disponível neste aparelho. Adicione a conta empresarial em Configurações > Contas e tente de novo.")
        } catch (cause: GetCredentialException) {
            throw IllegalStateException("Não foi possível abrir o acesso Google. Tente novamente.", cause)
        }
    } catch (cause: GetCredentialException) {
        throw IllegalStateException("Não foi possível abrir o acesso Google. Tente novamente.", cause)
    }
}

private fun tokenFrom(response: androidx.credentials.GetCredentialResponse): GoogleCredentialResult {
    val credential = GoogleIdTokenCredential.createFrom(response.credential.data)
    return GoogleCredentialResult.Token(credential.idToken, credential.id)
}
