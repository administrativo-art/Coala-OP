package com.coalaone.go.data

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

data class ApiCredentials(val uid: String, val token: String, val attestation: String?)
fun interface CredentialProvider { suspend fun credentials(): ApiCredentials? }
class AuthenticationInterceptor(private val origin: HttpUrl, private val provider: CredentialProvider) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val expectedOwner = request.header("X-Coala-Local-Owner")
        val builder = request.newBuilder().removeHeader("X-Coala-Local-Owner")
        val sameOrigin = request.url.scheme == origin.scheme && request.url.host == origin.host && request.url.port == origin.port
        val public = request.url.encodedPath in listOf("/api/app/version", "/api/auth/forgot-password", "/api/mobile/app-attestation")
        if (sameOrigin && request.url.encodedPath.startsWith("/api/") && !public) {
            val credentials = runBlocking { provider.credentials() } ?: throw AppFailure(ErrorCategory.AUTHENTICATION, false, "Entre novamente.")
            if (expectedOwner != null && credentials.uid != expectedOwner) throw AppFailure(ErrorCategory.AUTHENTICATION, false, "O envio pertence a outra conta. Entre com a conta original.")
            builder.header("Authorization", "Bearer ${credentials.token}")
            credentials.attestation?.let { builder.header("X-Coala-App-Attestation", it) }
        }
        return chain.proceed(builder.build())
    }
}
