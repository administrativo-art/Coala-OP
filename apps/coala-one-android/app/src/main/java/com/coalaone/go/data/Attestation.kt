package com.coalaone.go.data

import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.AuthGateway
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import javax.inject.Inject
import javax.inject.Singleton

interface AppAttestation {
    suspend fun token(): String?
    fun clear()
    fun currentFailure(): AppFailure? = null
    fun retry() { clear() }
}
@Singleton class Attestation @Inject constructor(private val auth: AuthGateway, private val json: Json,
    private val identity: DirectAppIdentity) : AppAttestation {
    private val exchangeClient = OkHttpClient.Builder().followRedirects(false).build()
    private val mutex = Mutex()
    private var cached: Pair<String, AttestationToken>? = null
    private var retryAt = 0L
    private var lastFailure: Pair<String, AppFailure>? = null
    private fun refused(response: okhttp3.Response): Throwable {
        val cause = retrofit2.HttpException(retrofit2.Response.error<Any>(response.code,
            response.body?.string().orEmpty().toResponseBody("application/json".toMediaType())))
        return Errors.withServerMessage(cause)
    }
    override suspend fun token(): String? = mutex.withLock {
        val uid = auth.current?.uid ?: return@withLock null
        val now = System.currentTimeMillis()
        cached?.takeIf { it.first == uid && it.second.expiresAt - 300_000 > now }?.let { return@withLock it.second.token }
        val refusedForUser = lastFailure?.let { it.first == uid && !it.second.retryable } == true
        if (refusedForUser || now < retryAt || BuildConfig.LOCAL_TEST) return@withLock null
        try {
            val bearer = auth.token()
            val endpoint = "${BuildConfig.API_BASE_URL.trimEnd('/')}/api/mobile/app-attestation"
            val response = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                val challengeRequest = Request.Builder().url(endpoint).header("Authorization", "Bearer $bearer").get().build()
                val challenge = exchangeClient.newCall(challengeRequest).execute().use {
                    if (!it.isSuccessful) throw refused(it)
                    json.decodeFromString<AndroidKeyChallenge>(it.body!!.string())
                }
                val proof = identity.proof(uid, challenge)
                if (auth.current?.uid != uid) return@withContext null
                val request = Request.Builder().url(endpoint).header("Authorization", "Bearer $bearer")
                    .post(json.encodeToString(proof).toRequestBody("application/json".toMediaType())).build()
                exchangeClient.newCall(request).execute().use {
                    if (!it.isSuccessful) throw refused(it)
                    json.decodeFromString<AttestationResponse>(it.body!!.string())
                }
            }
            val result = response?.attestation
            if (result != null && auth.current?.uid == uid) { cached = uid to result; lastFailure = null; result.token }
            else { if (auth.current?.uid == uid) lastFailure = uid to AppFailure(ErrorCategory.PERMISSION, false,
                "A verificação desta instalação ainda não foi liberada. Tente novamente ou procure o suporte.")
                null }
        } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
        catch (cause: Exception) {
            val failure = Errors.classify(cause)
            if (auth.current?.uid == uid) {
                lastFailure = uid to failure
                retryAt = if (failure.retryable) now + 30_000 else 0
            }
            null
        }
    }
    override fun currentFailure() = lastFailure?.takeIf { it.first == auth.current?.uid }?.second
    override fun clear() { cached = null; retryAt = 0; lastFailure = null }
}
