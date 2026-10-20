package com.coalaone.go

import com.coalaone.go.auth.*
import com.coalaone.go.data.*
import com.coalaone.go.offline.*
import com.coalaone.go.ui.*
import com.coalaone.go.push.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.LocalDate

@OptIn(ExperimentalCoroutinesApi::class)
class ViewModelsTest {
    private val push = object : PushController {
        override val state = kotlinx.coroutines.flow.MutableStateFlow(PushStatus())
        override val permissionRequested = false
        override fun markPermissionRequested() {}
        override fun permissionGranted() = true
        override fun reflect(uid: String?) {}
        override fun enable(uid: String) {}
        override fun foreground(uid: String?) {}
        override fun disable(uid: String) {}
        override suspend fun logout(uid: String?) {}
    }
    @Before fun setup() { Dispatchers.setMain(StandardTestDispatcher()) }
    @After fun tearDown() { Dispatchers.resetMain() }
    private val auth = TestAuth()
    private val mode = RuntimeMode(auth)
    private val queue = MemoryQueue()
    private val scheduler = WorkScheduler { }

    @Test fun pendingWithdrawalLinkCanBeCancelledWithoutCallingServer() = runTest {
        var links = 0; var uploads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun upload(fields: Map<String, okhttp3.RequestBody>, documents: List<okhttp3.MultipartBody.Part>, expectedOwner: String?): UploadResponse { uploads++; return DemoApi().upload(fields, documents, expectedOwner) }
            override suspend fun link(request: LinkWithdrawal): PurchaseResponse { links++; return DemoApi().link(request) }
        }
        val vm = PurchaseViewModel(repository(auth, api), mode, queue, QueueSync(auth, queue, repository(auth, api)), scheduler)
        runCurrent()
        val withdrawal = vm.state.value.withdrawals!!.withdrawals.first()
        val purchase = vm.state.value.withdrawals!!.awaitingPurchases.firstOrNull()
            ?: AwaitingPurchase("purchase-1", withdrawal.unitId, "Mercado", withdrawal.date, withdrawal.amountCents)
        vm.prepareLink(purchase, withdrawal)
        assertNotNull(vm.state.value.pendingLink)
        assertEquals(0, links)
        vm.cancelLink()
        assertNull(vm.state.value.pendingLink)
        assertEquals(0, links)
        vm.select("cash_withdrawal", withdrawal)
        assertNotNull(vm.state.value.selected)
        vm.leaveReview()
        assertNull(vm.state.value.selected)
        assertEquals(0, uploads)
        vm.prepareLink(purchase, withdrawal)
        vm.link(); advanceUntilIdle()
        assertEquals(1, links)
        assertNull(vm.state.value.pendingLink)
    }

    @Test fun restoredSessionStartsLockedAndPasswordFailureDoesNotUnlock() = runTest {
        val biometric = object : BiometricPreferences {
            override fun enabled(uid: String) = false; override fun ready(uid: String) = false
            override fun record(uid: String, enabled: Boolean) {}; override fun clear() {}
        }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, DemoApi(), object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push)
        runCurrent(); assertTrue(vm.state.value.locked)
        auth.rejectPassword = true; vm.unlock("bad", false); advanceUntilIdle()
        assertTrue(vm.state.value.locked); assertNotNull(vm.state.value.error)
        auth.rejectPassword = false; vm.unlock("good", false); advanceUntilIdle()
        assertFalse(vm.state.value.locked)
        vm.signOut(); runCurrent(); assertNull(vm.state.value.identity)
    }
    @Test fun signOutRevokesPushBeforeAuthenticationEnds() = runTest {
        var ownerAtRevoke: String? = null
        val pushSpy = object : PushController by push {
            override suspend fun logout(uid: String?) { ownerAtRevoke = auth.current?.uid; assertEquals(uid, ownerAtRevoke) }
        }
        val biometric = object : BiometricPreferences { override fun enabled(uid: String) = false; override fun ready(uid: String) = false; override fun record(uid: String, enabled: Boolean) {}; override fun clear() {} }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, DemoApi(), object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, pushSpy)
        runCurrent(); vm.signOut(); advanceUntilIdle()
        assertEquals("test-owner", ownerAtRevoke)
        assertNull(auth.current)
    }
    @Test fun passwordUnlockBindsBiometricToCurrentUid() = runTest {
        var recorded = ""
        val biometric = object : BiometricPreferences {
            override fun enabled(uid: String) = false; override fun ready(uid: String) = false
            override fun record(uid: String, enabled: Boolean) { if (enabled) recorded = uid }; override fun clear() {}
        }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, DemoApi(), object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push)
        runCurrent(); vm.unlock("good", true); advanceUntilIdle()
        assertEquals("test-owner", recorded); assertFalse(vm.state.value.locked)
    }
    @Test fun resetUsesPublicContractAndReturnsNeutralConfirmation() = runTest {
        var requested = ""
        val api = object : ApiService by DemoApi() { override suspend fun reset(request: ResetRequest) { requested = request.email } }
        val biometric = object : BiometricPreferences { override fun enabled(uid: String) = false; override fun ready(uid: String) = false; override fun record(uid: String, enabled: Boolean) {}; override fun clear() {} }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, api, object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push)
        runCurrent(); vm.reset(" nobody@example.invalid "); advanceUntilIdle()
        assertEquals("nobody@example.invalid", requested); assertTrue(vm.state.value.resetSent)
    }
    @Test fun homeUsesServerModulesAndRejectsOversizeAvatarBeforeSending() = runTest {
        var uploads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun profile() = ProfileResponse(Profile("Ana"), Modules(stockCount = true))
            override suspend fun avatar(photo: okhttp3.MultipartBody.Part): AvatarResponse { uploads++; return AvatarResponse("https://example.invalid/avatar.jpg") }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler); runCurrent()
        assertTrue(vm.profile.value!!.modules.stockCount); assertFalse(vm.profile.value!!.modules.localPurchase)
        vm.avatar(Document("photo.jpg", "image/jpeg", ByteArray(5 * 1024 * 1024 + 1))); advanceUntilIdle()
        assertEquals(0, uploads); assertNotNull(vm.feedback.value.error)
        vm.avatar(pending().receipts.single()); advanceUntilIdle()
        assertEquals(1, uploads); assertEquals("https://example.invalid/avatar.jpg", vm.profile.value!!.profile.avatarUrl)
    }
    @Test fun countRehydratesNewerLocalDraftAndPersistsOwner() = runTest {
        val store = MemoryDrafts()
        val session = countSession()
        store.values[auth.current!!.uid to session.id] = StoredCountDraft(Instant.parse("2026-10-01T14:00:00Z").toEpochMilli(), mapOf("lot" to CountDraft(exit = "2")))
        val repo = object : MobileRepository by repository(auth) { override suspend fun startCount(kioskId: String) = session }
        val vm = CountViewModel(repo, mode, store); runCurrent(); vm.open("unit"); advanceUntilIdle()
        assertEquals("2", vm.state.value.drafts.getValue("lot").exit)
        vm.edit("lot", CountDraft(exit = "3")); advanceTimeBy(601); runCurrent()
        assertEquals("3", store.values.getValue("test-owner" to session.id).drafts.getValue("lot").exit)
    }
    @Test fun countKeepsLocalDraftOnNetworkFailureAndClearsAfterSuccessfulCompletion() = runTest {
        val store = MemoryDrafts(); var offline = true; var completed = false
        val repo = object : MobileRepository by repository(auth) {
            override suspend fun startCount(kioskId: String) = countSession()
            override suspend fun saveCount(input: SaveCountRequest): SavedCount { if (offline) throw IOException(); completed = input.complete; return SavedCount("completed", false, input.entries.size) }
        }
        val vm = CountViewModel(repo, mode, store); runCurrent(); vm.open("unit"); advanceUntilIdle(); vm.edit("lot", CountDraft(exit = "1"))
        vm.save(true); advanceUntilIdle(); assertNotNull(vm.state.value.session); assertTrue(store.values.isNotEmpty())
        offline = false; vm.save(true); advanceUntilIdle(); assertTrue(completed); assertNull(vm.state.value.session); assertTrue(store.values.isEmpty())
    }
    @Test fun countCancellationOnlyClearsLocalAfterServerAcknowledges() = runTest {
        val store = MemoryDrafts(); var ack = false
        val repo = object : MobileRepository by repository(auth) {
            override suspend fun startCount(kioskId: String) = countSession()
            override suspend fun cancelCount(sessionId: String) = CancelledCount(ack, false)
        }
        val vm = CountViewModel(repo, mode, store); runCurrent(); vm.open("unit"); advanceUntilIdle(); vm.edit("lot", CountDraft(exit = "1")); advanceTimeBy(601); runCurrent()
        vm.cancel(); advanceUntilIdle(); assertNotNull(vm.state.value.session); assertTrue(store.values.isNotEmpty())
        ack = true; vm.cancel(); advanceUntilIdle(); assertNull(vm.state.value.session); assertTrue(store.values.isEmpty())
    }
    @Test fun receiptFailureRetainsQuantitiesAndSuccessRemovesActivity() = runTest {
        var fail = true; var sends = 0
        val repo = object : MobileRepository by repository(auth) { override suspend fun receive(input: ReceiveRequest): Received { sends++; if (fail) throw IOException(); return Received("Recebido sem divergência", false, false) } }
        val vm = ReceiveViewModel(repo); runCurrent(); val activity = vm.state.value.list!!.activities.first(); vm.open(activity)
        vm.confirm(); advanceUntilIdle(); assertNotNull(vm.state.value.activity); assertEquals(activity.rows.size, vm.state.value.drafts.size)
        val before = vm.state.value.list!!.activities.size
        fail = false; vm.confirm(); advanceUntilIdle(); assertNull(vm.state.value.activity); assertTrue(vm.state.value.list!!.activities.none { it.id == activity.id }); assertEquals(before - 1, vm.state.value.list!!.activities.size); assertEquals(2, sends)
    }
    @Test fun receiptUnexplainedDivergenceDoesNotReachServer() = runTest {
        var sends = 0
        val repo = object : MobileRepository by repository(auth) { override suspend fun receive(input: ReceiveRequest): Received { sends++; return Received("ok", false, false) } }
        val vm = ReceiveViewModel(repo); runCurrent(); vm.open(vm.state.value.list!!.activities.first())
        val key = vm.state.value.drafts.keys.first(); vm.edit(key, "0", ""); vm.confirm(); advanceUntilIdle()
        assertEquals(0, sends); assertNotNull(vm.feedback.value.error)
    }
    @Test fun purchaseUploadKeepsUuidAndQueueUntilConfirmationThenRetriesPendingStock() = runTest {
        var sentId = ""; var confirms = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun upload(fields: Map<String, okhttp3.RequestBody>, documents: List<okhttp3.MultipartBody.Part>, expectedOwner: String?): UploadResponse {
                val buffer = okio.Buffer(); fields.getValue("submissionId").writeTo(buffer); sentId = buffer.readUtf8(); assertEquals("test-owner", expectedOwner)
                return UploadResponse(Submission("server", false, "pending_review", ReceiptAnalysis("Fornecedor", purchaseDate = "2026-10-01", amountCents = 5000, items = listOf(AnalysisItem("Leite", 10.0, "un", 500, 5000, aiTreatment = "item_not_found", aiConfidence = "high", aiReason = "Não há produto compatível.")))))
            }
            override suspend fun confirm(request: ConfirmPurchase): PurchaseResponse { confirms++; assertEquals(sentId, request.submissionId); return PurchaseResponse(PurchaseResult("p", "confirmed", stockEntry = if (confirms == 1) "pending" else "done")) }
        }
        val repo = repository(auth, api); val vm = PurchaseViewModel(repo, mode, queue, QueueSync(auth, queue, repo), scheduler)
        runCurrent(); vm.select("cash_withdrawal"); val id = vm.state.value.selected!!.submissionId; vm.attach(pending().receipts.single(), false); vm.upload(); advanceUntilIdle()
        assertEquals(id, sentId); assertEquals("UPLOADED", queue.rows.value.single().state); assertNotNull(vm.state.value.review)
        assertEquals("item_not_found", vm.state.value.review!!.items.single().aiTreatment)
        assertEquals("Não há produto compatível.", vm.state.value.review!!.items.single().aiReason)
        // The simulation has several units, so a purchase without a withdrawal needs the unit chosen in the review.
        vm.review(vm.state.value.review!!.copy(unitId = "simulation-unit", accountPlanId = "account", resultCenterId = "center")); vm.confirm(); advanceUntilIdle()
        assertEquals(2, confirms); assertTrue(queue.rows.value.isEmpty()); assertNull(vm.state.value.review)
    }
    @Test fun failedUploadIsRetainedAndResumesWithSameId() = runTest {
        val api = object : ApiService by DemoApi() { override suspend fun upload(fields: Map<String, okhttp3.RequestBody>, documents: List<okhttp3.MultipartBody.Part>, expectedOwner: String?): UploadResponse = throw IOException() }
        val repo = repository(auth, api); val vm = PurchaseViewModel(repo, mode, queue, QueueSync(auth, queue, repo), scheduler)
        runCurrent(); vm.select("cash_withdrawal"); vm.attach(pending().receipts.single(), false); val id = vm.state.value.selected!!.submissionId
        vm.upload(); advanceUntilIdle(); assertEquals(id, queue.rows.value.single().id); assertEquals("READY", queue.rows.value.single().state)
        vm.resume(queue.rows.value.single()); advanceUntilIdle(); assertEquals(id, vm.state.value.selected!!.submissionId)
    }
    @Test fun scheduleLoadsBothMonthsOfCrossingWeekWithoutPolling() = runTest {
        val loaded = mutableListOf<Pair<Int, Int>>()
        val api = object : ApiService by DemoApi() { override suspend fun schedule(year: Int, month: Int): MonthSchedule { loaded += year to month; return DemoApi().schedule(year, month) } }
        val vm = ModulesViewModel(repository(auth, api)); vm.schedule(LocalDate.of(2026, 11, 1)); advanceUntilIdle()
        assertEquals(listOf(2026 to 10, 2026 to 11), loaded)
        vm.schedule(LocalDate.of(2026, 11, 1)); advanceUntilIdle(); assertEquals(2, loaded.size)
    }
    @Test fun scheduleUnitSelectionKeepsLoadedUnitsAndOnlyMineState() = runTest {
        val vm = ModulesViewModel(repository(auth, DemoApi()))
        assertEquals(com.coalaone.go.domain.Rules.ALL_UNITS, vm.state.value.selectedScheduleUnit)
        vm.schedule(LocalDate.of(2026, 10, 12)); advanceUntilIdle()
        val loaded = vm.state.value.schedules
        assertEquals(8, loaded.getValue("2026-10").units.size)
        vm.scheduleFilter("sim-tirirical", false)
        assertEquals("sim-tirirical", vm.state.value.selectedScheduleUnit)
        assertFalse(vm.state.value.onlyMine)
        assertEquals(loaded, vm.state.value.schedules)
        vm.scheduleFilter(vm.state.value.selectedScheduleUnit, true)
        assertTrue(vm.state.value.onlyMine)
        vm.scheduleFilter(vm.state.value.selectedScheduleUnit, false)
        assertEquals("sim-tirirical", vm.state.value.selectedScheduleUnit)
        assertFalse(vm.state.value.onlyMine)
    }
    @Test fun goalsUseSelectedUnitAndSignageRejectsBadCodeWithoutSend() = runTest {
        var goalUnit = ""; var pairs = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun goals(kioskId: String): UnitGoals { goalUnit = kioskId; return DemoApi().goals(kioskId) }
            override suspend fun pair(request: PairScreen): PairResponse { pairs++; return DemoApi().pair(request) }
        }
        val vm = ModulesViewModel(repository(auth, api)); vm.goals("unit"); advanceUntilIdle(); assertEquals("unit", goalUnit)
        vm.pair("unit", null, "landscape", "bad"); advanceUntilIdle(); assertEquals(0, pairs)
        vm.pair("unit", null, "landscape", "COALA-SIGNAGE:ABCDEFGH"); advanceUntilIdle(); assertEquals(1, pairs)
    }
    @Test fun updateDownloadsOnlyPublishedReleaseAndPropagatesProgress() = runTest {
        val nextVersion = BuildConfig.VERSION_CODE + 1
        val api = object : ApiService by DemoApi() { override suspend fun release() = Release(nextVersion, "próxima", 0, "/app/CoalaGo.apk") }; var downloads = 0
        val vm = UpdateViewModel(api, InstallerDownloader { release, progress -> downloads++; assertEquals(nextVersion, release.versionCode); progress(0.5f); File("test.apk") })
        vm.check(); advanceUntilIdle(); var opened = false; vm.download { opened = true }; advanceUntilIdle()
        assertEquals(1, downloads); assertTrue(opened); assertEquals(0.5f, vm.progress.value)
    }
    @Test fun currentReleaseNeverInvokesDownloader() = runTest {
        val api = object : ApiService by DemoApi() { override suspend fun release() = Release(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME, 0, "/app/CoalaGo.apk") }
        var downloads = 0
        val vm = UpdateViewModel(api, InstallerDownloader { _, _ -> downloads++; File("test.apk") })
        vm.check(); advanceUntilIdle(); vm.download { fail("Already installed") }; advanceUntilIdle()
        assertEquals(0, downloads)
    }
    @Test fun unpublishedGoNeverInvokesDownloader() = runTest {
        val api = object : ApiService by DemoApi() { override suspend fun release() = Release(0, "Não publicado", 0, null) }
        var downloads = 0
        val vm = UpdateViewModel(api, InstallerDownloader { _, _ -> downloads++; File("test.apk") })
        vm.check(); advanceUntilIdle(); vm.download { fail("No installer exists") }; advanceUntilIdle()
        assertEquals(0, downloads)
    }
    @Test fun queueDoesNotSendForAnotherLoggedInUid() = runTest {
        queue.enqueue("original-owner", pending())
        val repo = repository(auth)
        assertFalse(QueueSync(auth, queue, repo).sync("original-owner"))
        assertEquals("READY", queue.rows.value.single().state); assertTrue(queue.acks.isEmpty())
    }
    @Test fun stoppingWorkerDoesNotBlockOrDeleteItsPendingUpload() = runTest {
        queue.enqueue(auth.current!!.uid, pending())
        val api = object : ApiService by DemoApi() {
            override suspend fun upload(fields: Map<String, okhttp3.RequestBody>, documents: List<okhttp3.MultipartBody.Part>, expectedOwner: String?): UploadResponse = throw kotlinx.coroutines.CancellationException("worker stopped")
        }
        val sync = QueueSync(auth, queue, repository(auth, api))
        try { sync.sync(auth.current!!.uid); fail("Cancellation must propagate") }
        catch (_: kotlinx.coroutines.CancellationException) { }
        assertEquals("READY", queue.rows.value.single().state)
        assertTrue(queue.acks.isEmpty())
    }
}
