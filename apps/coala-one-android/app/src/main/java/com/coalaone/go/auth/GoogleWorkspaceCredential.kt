package com.coalaone.go.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
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
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    return try {
        val response = CredentialManager.create(context).getCredential(context, request)
        val credential = GoogleIdTokenCredential.createFrom(response.credential.data)
        GoogleCredentialResult.Token(credential.idToken, credential.id)
    } catch (_: GetCredentialCancellationException) {
        GoogleCredentialResult.Cancelled
    }
}
