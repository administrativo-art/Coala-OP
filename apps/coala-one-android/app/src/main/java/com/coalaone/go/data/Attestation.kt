package com.coalaone.go.data

import android.content.Context
import android.util.Base64
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.AuthGateway
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

interface AppAttestation { suspend fun token(): String?; fun clear() }
@Singleton class Attestation @Inject constructor(@ApplicationContext context: Context, private val auth: AuthGateway, private val json: Json) : AppAttestation {
    private val manager = IntegrityManagerFactory.createStandard(context)
    private val exchangeClient = OkHttpClient.Builder().followRedirects(false).build()
    private val mutex = Mutex()
    private var provider: StandardIntegrityManager.StandardIntegrityTokenProvider? = null
    private var cached: Pair<String, AttestationToken>? = null
    private var retryAt = 0L
    override suspend fun token(): String? = mutex.withLock {
        val uid = auth.current?.uid ?: return@withLock null
        val now = System.currentTimeMillis()
        cached?.takeIf { it.first == uid && it.second.expiresAt - 300_000 > now }?.let { return@withLock it.second.token }
        if (now < retryAt || BuildConfig.LOCAL_TEST) return@withLock null
        try {
            val project = BuildConfig.FIREBASE_SENDER_ID.toLong()
            val prepared = provider ?: manager.prepareIntegrityToken(StandardIntegrityManager.PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(project).build()).await().also { provider = it }
            val nonce = UUID.randomUUID().toString()
            val hash = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest("$uid:$nonce".toByteArray()), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
            val integrity = prepared.request(StandardIntegrityManager.StandardIntegrityTokenRequest.builder().setRequestHash(hash).build()).await().token()
            val request = Request.Builder().url("${BuildConfig.API_BASE_URL.trimEnd('/')}/api/mobile/app-attestation").header("Authorization", "Bearer ${auth.token()}").post(json.encodeToString(AttestationRequest(integrity, nonce)).toRequestBody("application/json".toMediaType())).build()
            val response = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { exchangeClient.newCall(request).execute().use { if (it.isSuccessful) json.decodeFromString<AttestationResponse>(it.body!!.string()) else null } }
            val result = response?.attestation
            if (result != null && auth.current?.uid == uid) { cached = uid to result; result.token }
            else { retryAt = now + 600_000; null }
        } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
        catch (_: Exception) { retryAt = now + 600_000; null }
    }
    override fun clear() { cached = null; retryAt = 0 }
}
