package com.coalaone.go

import com.coalaone.go.data.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.mockwebserver.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.File

class ApiContractTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    @Test fun goVersionQueryCannotSelectLegacyInstallerAndAttestationNamesGo() = runTest {
        MockWebServer().use { server ->
            val api = Retrofit.Builder().baseUrl(server.url("/")).addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(ApiService::class.java)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"versionCode":0,"versionName":"Não publicado","minVersionCode":0,"packagePath":null}"""))
            assertNull(api.release().packagePath)
            assertEquals("/api/app/version?packageName=coalaone.go", server.takeRequest().path)
            assertEquals("coalaone.go.debug", BuildConfig.APPLICATION_ID)
            assertTrue(json.encodeToString(AttestationRequest("t".repeat(200), "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e")).contains("\"packageName\":\"coalaone.go\""))
        }
    }
    @Test fun privatePhotosReceiveLoginAndAttestationAndNeverLeakToAnotherOrigin() {
        MockWebServer().use { server -> MockWebServer().use { external ->
            val client = OkHttpClient.Builder().addInterceptor(AuthenticationInterceptor(server.url("/")) { ApiCredentials("u", "token", "proof") }).build()
            server.enqueue(MockResponse().setBody("image")); external.enqueue(MockResponse().setBody("public"))
            client.newCall(Request.Builder().url(server.url("/api/stock/mobile-reposition/photo?activityId=a&baseProductId=b&lotId=l")).build()).execute().close()
            val request = server.takeRequest(); assertEquals("Bearer token", request.getHeader("Authorization")); assertEquals("proof", request.getHeader("X-Coala-App-Attestation"))
            client.newCall(Request.Builder().url(external.url("/api/photo")).build()).execute().close()
            assertNull(external.takeRequest().getHeader("Authorization"))
        } }
    }
    @Test fun ownerMismatchFailsBeforeTheNetworkAndPublicCallsAreUnauthenticated() {
        MockWebServer().use { server ->
            val client = OkHttpClient.Builder().addInterceptor(AuthenticationInterceptor(server.url("/")) { ApiCredentials("other", "token", null) }).build()
            assertThrows(AppFailure::class.java) { client.newCall(Request.Builder().url(server.url("/api/financial/inbox/mobile-upload")).header("X-Coala-Local-Owner", "owner").build()).execute() }
            assertEquals(0, server.requestCount)
            server.enqueue(MockResponse().setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/api/app/version")).build()).execute().close()
            assertNull(server.takeRequest().getHeader("Authorization"))
        }
    }
    @Test fun serializedPayloadsSatisfyExactLegacyShapesAndGenerateCrossLanguageFixtures() {
        val count = com.coalaone.go.domain.Rules.countRequest(countSession(), mapOf("lot" to CountDraft(exit = "1")), true)
        val receive = ReceiveRequest("a", listOf(ReceiptRow("b", "l", 1.0, "")))
        val pair = PairScreen("unit", orientation = "landscape", code = "ABCDEFGH")
        assertFalse(json.encodeToString(pair).contains("screenId"))
        assertTrue(json.encodeToString(purchase()).contains("\"companyPaymentMethod\":null"))
        assertFalse(json.encodeToString(purchase()).contains("localId"))
        val item = purchase().items.first()
        assertEquals(item.localId, item.copy(quantity = 2.0).localId)
        val fixtures = buildJsonObject { put("count", json.encodeToJsonElement(count)); put("purchase", json.encodeToJsonElement(purchase())); put("receive", json.encodeToJsonElement(receive)); put("pair", json.encodeToJsonElement(pair)); put("cancel", json.encodeToJsonElement(SessionRequest("count"))); put("start", json.encodeToJsonElement(StartCountRequest("unit"))); put("link", json.encodeToJsonElement(LinkWithdrawal("purchase", WithdrawalLink("a".repeat(64), "2026-10-01")))) }
        File("build/contract-fixtures.json").apply { parentFile!!.mkdirs(); writeText(json.encodeToString(fixtures)) }
    }
    @Test fun retrofitSendsMultipartWithSameSubmissionIdAndRoles() = runTest {
        MockWebServer().use { server ->
            val api = Retrofit.Builder().baseUrl(server.url("/")).addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(ApiService::class.java)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"submission":{"id":"server","duplicate":false,"status":"pending_review"}}"""))
            api.upload(mapOf("submissionId" to pending().submissionId.toRequestBody("text/plain".toMediaType()), "fundingSource" to "cash_withdrawal".toRequestBody()), listOf(MultipartBody.Part.createFormData("receipt", "note.jpg", byteArrayOf(1, 2, 3).toRequestBody("image/jpeg".toMediaType()))))
            val request = server.takeRequest(); assertEquals("POST", request.method); assertEquals("/api/financial/inbox/mobile-upload", request.path)
            val body = request.body.readUtf8(); assertTrue(body.contains(pending().submissionId)); assertTrue(body.contains("name=\"receipt\"")); assertFalse(body.contains("paymentProof"))
        }
    }
    @Test fun errorsAreCategorizedWithoutExposingServerInternals() {
        for ((code, category) in listOf(401 to ErrorCategory.AUTHENTICATION, 403 to ErrorCategory.PERMISSION, 409 to ErrorCategory.CONFLICT, 422 to ErrorCategory.VALIDATION, 429 to ErrorCategory.RATE_LIMIT, 503 to ErrorCategory.SERVER)) {
            val response = retrofit2.Response.error<Any>(code, "secret stack".toResponseBody())
            val failure = Errors.classify(retrofit2.HttpException(response)); assertEquals(category, failure.category); assertFalse(failure.message!!.contains("secret"))
        }
        assertTrue(Errors.classify(java.io.IOException()).retryable)
    }
}
