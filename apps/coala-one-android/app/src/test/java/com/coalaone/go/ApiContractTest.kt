package com.coalaone.go

import com.coalaone.go.data.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
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
            assertEquals(if (BuildConfig.DEBUG) "coalaone.go.debug" else "coalaone.go", BuildConfig.APPLICATION_ID)
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
    @Test fun offlinePermitKeepsThePublicVerificationFailureWithoutBlockingOrdinaryMonitorCalls() {
        MockWebServer().use { server ->
            val failure = AppFailure(ErrorCategory.PERMISSION, false, "A assinatura desta instalação não foi verificada.", "MOBILE_KEY_ATTESTATION_REJECTED")
            val client = OkHttpClient.Builder().addInterceptor(AuthenticationInterceptor(server.url("/")) {
                ApiCredentials("u", "token", null, failure)
            }).build()
            val refused = assertThrows(AppFailure::class.java) { client.newCall(Request.Builder()
                .url(server.url("/api/dp/time-recording/offline-permits")).post("{}".toRequestBody()).build()).execute() }
            assertEquals("MOBILE_KEY_ATTESTATION_REJECTED", refused.code)
            assertEquals(failure.message, refused.message)
            assertEquals(0, server.requestCount)
            server.enqueue(MockResponse().setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/api/mobile/profile")).build()).execute().close()
            assertEquals(1, server.requestCount)
        }
    }
    @Test fun developerViewAsHeaderStaysOnTheAuthenticatedApiOrigin() {
        MockWebServer().use { server -> MockWebServer().use { external ->
            val client = OkHttpClient.Builder().addInterceptor(AuthenticationInterceptor(server.url("/"), { "target-user" }) { ApiCredentials("developer", "token", "proof") }).build()
            server.enqueue(MockResponse().setBody("{}")); external.enqueue(MockResponse().setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/api/mobile/profile")).build()).execute().close()
            assertEquals("target-user", server.takeRequest().getHeader(DEVELOPER_VIEW_AS_HEADER))
            client.newCall(Request.Builder().url(external.url("/api/mobile/profile")).build()).execute().close()
            assertNull(external.takeRequest().getHeader(DEVELOPER_VIEW_AS_HEADER))
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
    @Test fun ownedTimeRequestsRejectViewAsAtDispatchAndNeverTransmitInternalOwnershipHeaders() = runTest {
        MockWebServer().use { server ->
            var target: String? = "other-person"
            val client = OkHttpClient.Builder().addInterceptor(AuthenticationInterceptor(server.url("/"), { target }) {
                ApiCredentials("owner", "token", "proof")
            }).build()
            val api = Retrofit.Builder().baseUrl(server.url("/")).client(client)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(ApiService::class.java)
            val request = MarkingRequest("attempt", "2026-10-27", "unit")
            val refused = runCatching { api.mark(request, "owner") }.exceptionOrNull()
            assertTrue(refused is AppFailure); assertEquals(0, server.requestCount)
            target = null
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
                """{"status":"recorded","receiptId":"receipt","receiptStatus":"available","marking":{"nsr":1,"markedAt":"2026-10-27T12:00:00-0300","executionUnitId":"unit"}}"""))
            api.mark(request, "owner")
            val sent = server.takeRequest()
            assertNull(sent.getHeader("X-Coala-Local-Owner")); assertNull(sent.getHeader(DEVELOPER_VIEW_AS_HEADER))
            assertEquals("Bearer token", sent.getHeader("Authorization"))
        }
    }
    @Test fun serializedPayloadsSatisfyExactLegacyShapesAndGenerateCrossLanguageFixtures() {
        val count = com.coalaone.go.domain.Rules.countRequest(countSession(), mapOf("lot" to CountDraft(exit = "1")), true)
        val receive = ReceiveRequest("a", listOf(ReceiptRow("b", "l", 1.0, "")))
        val pair = PairScreen("unit", orientation = "landscape", code = "ABCDEFGH")
        assertFalse(json.encodeToString(pair).contains("screenId"))
        assertTrue(json.encodeToString(purchase()).contains("\"companyPaymentMethod\":null"))
        assertFalse(json.encodeToString(purchase()).contains("localId"))
        val legacyOffline = """{"attemptId":"attempt-v1","workDate":"2026-10-19","executionUnitId":"unit-1","channel":"mobile","offline":{"permitId":"permit-v1","deviceKeyId":"${"a".repeat(64)}","elapsedRealtimeMs":2,"bootCount":1,"sequence":1,"previousLocalHash":null,"markedAt":"2026-10-19T08:00:00-0300","localHash":"${"b".repeat(64)}","signature":"${java.util.Base64.getEncoder().encodeToString(ByteArray(64) { 1 })}"}}"""
        val restoredV1 = json.decodeFromString<MarkingRequest>(legacyOffline)
        assertFalse("reidratar uma fila oficial v1 não pode alterar o digest do replay",
            json.encodeToString(restoredV1).contains("\"scope\""))
        assertTrue(json.encodeToString(restoredV1.copy(offline = restoredV1.offline?.copy(scope = "pilot"))).contains("\"scope\":\"pilot\""))
        val item = purchase().items.first()
        assertEquals(item.localId, item.copy(quantity = 2.0).localId)
        val fixtures = buildJsonObject { put("count", json.encodeToJsonElement(count)); put("purchase", json.encodeToJsonElement(purchase())); put("receive", json.encodeToJsonElement(receive)); put("pair", json.encodeToJsonElement(pair)); put("cancel", json.encodeToJsonElement(SessionRequest("count"))); put("start", json.encodeToJsonElement(StartCountRequest("unit"))); put("link", json.encodeToJsonElement(LinkWithdrawal("purchase", WithdrawalLink("a".repeat(64), "2026-10-01"))))
            // Ponto and Solicitações: built by the same rules the screens use, checked against the server schemas.
            val today = java.time.LocalDate.parse("2026-10-19"); val uuid = "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e"
            put("marking", json.encodeToJsonElement(MarkingRequest(uuid, "2026-10-19", "unit-1")))
            put("offlinePermit", json.encodeToJsonElement(OfflinePermitRequest(uuid, "2026-10-19", uuid,
                "a".repeat(64), java.util.Base64.getEncoder().encodeToString(ByteArray(80) { 1 }), "tee", 1, 10)))
            put("adjustmentInclude", json.encodeToJsonElement(com.coalaone.go.domain.TimeRules.adjustmentRequest(uuid, "2026-10-18", "include", null, "08:00", "unit-1", "Esqueci de bater a entrada.", today)))
            put("adjustmentDiscard", json.encodeToJsonElement(com.coalaone.go.domain.TimeRules.adjustmentRequest(uuid, "2026-10-18", "discard", "receipt-1", "", "unit-1", "Bati duas vezes seguidas.", today)))
            put("adjustmentCorrect", json.encodeToJsonElement(com.coalaone.go.domain.TimeRules.adjustmentRequest(uuid, "2026-10-18", "correct", "receipt-1", "12:00", "unit-1", "O horário saiu errado.", today)))
            val type = AbsenceOption("type-1", "Atestado", listOf("day", "hour"))
            val hours = com.coalaone.go.domain.TimeRules.absencePeriod(type, "hour", "2026-10-20", "2026-10-20", "08:00", "10:00")
            put("absencePreview", json.encodeToJsonElement(hours))
            put("absenceDraft", json.encodeToJsonElement(AbsenceDraftRequest(uuid, null, com.coalaone.go.domain.TimeRules.absencePeriod(type, "day", "2026-10-20", "2026-10-21", "", ""), emptyList(), null)))
            put("absenceDraftWithFiles", json.encodeToJsonElement(AbsenceDraftRequest(uuid, uuid, hours, listOf(uuid), "Consulta médica marcada.")))
            put("absenceSubmit", json.encodeToJsonElement(AbsenceSubmit(2, uuid)))
            put("voucher", json.encodeToJsonElement(com.coalaone.go.domain.TimeRules.voucherRequest("change", "Nova linha 401"))) }
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
    @Test fun pontoShowsOnlyThePublicServerMessage() {
        val refused = retrofit2.HttpException(retrofit2.Response.error<Any>(422, """{"error":{"code":"REP_P_TIME_UNAVAILABLE","message":"Hora oficial indisponível.","requestId":"r"}}""".toResponseBody()))
        assertEquals("REP_P_TIME_UNAVAILABLE", Errors.serverCode(refused))
        val failure = Errors.classify(Errors.withServerMessage(refused)); assertEquals("Hora oficial indisponível.", failure.message); assertEquals(ErrorCategory.VALIDATION, failure.category)
        val crash = retrofit2.HttpException(retrofit2.Response.error<Any>(500, """{"error":{"message":"stack"}}""".toResponseBody()))
        assertFalse(Errors.classify(Errors.withServerMessage(crash)).message!!.contains("stack"))
        val login = retrofit2.HttpException(retrofit2.Response.error<Any>(401, """{"error":{"message":"x"}}""".toResponseBody()))
        assertEquals(ErrorCategory.AUTHENTICATION, Errors.classify(Errors.withServerMessage(login)).category)
        val plain = retrofit2.HttpException(retrofit2.Response.error<Any>(400, "not json".toResponseBody()))
        assertEquals("Revise os campos e os documentos enviados.", Errors.classify(Errors.withServerMessage(plain)).message)
    }
    @Test fun pontoUsesTheWebRoutesAndTheMobileCollector() = runTest {
        MockWebServer().use { server ->
            val api = Retrofit.Builder().baseUrl(server.url("/")).addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(ApiService::class.java)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"status":"recorded","receiptId":"r1","receiptStatus":"pending","receiptIssue":"X","location":{"captureStatus":"captured","evaluation":"inside"},"marking":{"markingId":"m","nsr":7,"markedAt":"2026-10-19T08:00:00-03:00","recordedAt":"2026-10-19T08:00:00-03:00","executionUnitId":"u","hash":"h"}}"""))
            val location = LocationAttempt("capture-1", "captured", 450, "2026-10-19T11:00:00Z", -1.4558, -48.4902, 12.0)
            val marked = api.mark(MarkingRequest("a", "2026-10-19", "u", locationAttempt = location))
            assertEquals(7L, marked.marking.nsr); assertEquals("inside", marked.location?.evaluation)
            val request = server.takeRequest(); assertEquals("/api/dp/time-recording/markings", request.path)
            val markingBody = request.body.readUtf8()
            assertTrue(markingBody.contains("\"channel\":\"mobile\"")); assertTrue(markingBody.contains("\"locationAttempt\""))
            assertTrue(markingBody.contains("\"latitude\":-1.4558")); assertFalse(markingBody.contains("privacyNoticeUrl"))
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"permit":{"permitId":"p","installationId":"11111111-1111-4111-8111-111111111111","deviceKeyId":"${"a".repeat(64)}","keySecurity":"tee","bootCount":1,"anchorElapsedRealtimeMs":10,"anchorInstant":"2026-10-19T11:00:00Z","issuedAt":"2026-10-19T11:00:00Z","expiresAt":"2026-10-19T23:00:00Z","units":[{"id":"u","name":"Matriz","timeZone":"America/Belem"}]}}"""))
            val permitRequest = OfflinePermitRequest("request", "2026-10-19", "11111111-1111-4111-8111-111111111111",
                "a".repeat(64), java.util.Base64.getEncoder().encodeToString(ByteArray(80) { 1 }), "tee", 1, 10)
            assertEquals("p", api.offlinePermit(permitRequest).permit.permitId)
            val permitHttp = server.takeRequest(); assertEquals("/api/dp/time-recording/offline-permits", permitHttp.path)
            assertTrue(permitHttp.body.readUtf8().contains("\"keySecurity\":\"tee\""))
            server.enqueue(MockResponse().setHeader("Content-Type", "application/pdf").setBody("%PDF"))
            assertEquals("%PDF", api.receipt("r1").string()); assertEquals("/api/dp/time-recording/receipts/r1", server.takeRequest().path)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/zip").setBody("PK"))
            assertEquals("PK", api.receiptArchive("2026-10-01", "2026-10-31").string())
            assertEquals("/api/dp/time-recording/receipts/export?startDate=2026-10-01&endDate=2026-10-31", server.takeRequest().path)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"requests":[],"nextCursor":null}"""))
            api.absences(); assertEquals("/api/collaborator/absence-requests?scope=mine&limit=25", server.takeRequest().path)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"requests":[]}"""))
            api.vouchers(); assertEquals("/api/collaborator/requests?scope=own", server.takeRequest().path)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"policy":{"id":"p","version":1,"name":"Banco","enabled":true},"statement":{"balanceMinutes":80,"lines":[],"missing":[],"limits":{}},"previewCompetences":["2026-10"]}"""))
            assertEquals(80, api.timeBank("2026-10-20").statement?.balanceMinutes)
            assertEquals("/api/dp/time-recording/time-bank?date=2026-10-20", server.takeRequest().path)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"competence":"2026-10","closure":{"status":"closed","version":2},"mirror":{"snapshotHash":"h","generatedAt":"2026-10-21T00:00:00Z"},"package":{"status":"signed"}}"""))
            assertEquals("signed", api.mirror("2026-10").`package`?.status)
            assertEquals("/api/dp/time-recording/mirrors?competence=2026-10", server.takeRequest().path)
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"ownShifts":[{"scheduleId":"s","shiftId":"mine","unitId":"u","unitName":"Matriz","date":"2026-10-25","startTime":"08:00","endTime":"16:00","occupantUid":"me","occupantName":"Heucilene"}],"candidateShifts":[{"scheduleId":"s","shiftId":"other","unitId":"u","unitName":"Matriz","date":"2026-10-25","startTime":"14:00","endTime":"22:00","occupantUid":"other-user","occupantName":"Bia"}],"through":"2026-12-22"}"""))
            assertEquals("Bia", api.shiftSwapOptions().candidateShifts.single().occupantName)
            assertEquals("/api/collaborator/requests/shift-swaps/options", server.takeRequest().path)
        }
    }
}
