package com.coalaone.go

import com.coalaone.go.auth.*
import com.coalaone.go.data.*
import com.coalaone.go.domain.TimeRules
import com.coalaone.go.offline.*
import com.coalaone.go.ui.*
import com.coalaone.go.push.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import okhttp3.ResponseBody.Companion.toResponseBody
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
    private val timeQueue = MemoryTimeOfflineQueue()
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
        assertEquals(withdrawal.unitId, vm.state.value.unitView)
        assertEquals(0, links)
        val focus = vm.state.value.linkFocusRequest
        vm.select("cash_withdrawal", withdrawal)
        assertNull(vm.state.value.selected)
        assertNotNull(vm.state.value.pendingLink)
        assertTrue(vm.state.value.linkFocusRequest > focus)
        vm.select("cash_withdrawal", vm.state.value.withdrawals!!.withdrawals[1])
        assertNull(vm.state.value.selected)
        assertEquals(withdrawal.sourceId, vm.state.value.pendingLink!!.withdrawal.sourceId)
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
    @Test fun biometricEnrollmentEnablesLocalUnlockWithoutNetwork() = runTest {
        var recorded = ""
        val biometric = object : BiometricPreferences {
            override fun enabled(uid: String) = false; override fun ready(uid: String) = false
            override fun record(uid: String, enabled: Boolean) { if (enabled) recorded = uid }; override fun clear() {}
        }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, DemoApi(), object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push)
        runCurrent(); vm.enableBiometricUnlock()
        assertEquals("test-owner", recorded); assertTrue(vm.state.value.localUnlockEnabled)
    }
    @Test fun resetUsesPublicContractAndReturnsNeutralConfirmation() = runTest {
        var requested = ""
        val api = object : ApiService by DemoApi() { override suspend fun reset(request: ResetRequest) { requested = request.email } }
        val biometric = object : BiometricPreferences { override fun enabled(uid: String) = false; override fun ready(uid: String) = false; override fun record(uid: String, enabled: Boolean) {}; override fun clear() {} }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, api, object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push)
        runCurrent(); vm.reset(" nobody@example.invalid "); advanceUntilIdle()
        assertEquals("nobody@example.invalid", requested); assertTrue(vm.state.value.resetSent)
    }
    @Test fun googleMigrationPreservesUidAndUsesOnlyAuthorizedCorporateEmail() = runTest {
        var requestToken = ""
        val api = object : ApiService by DemoApi() {
            override suspend fun googleMigrationStatus() = GoogleMigrationStatus(
                available = true,
                currentEmail = "heucillennysantos@gmail.com",
                targetEmail = "heucilene@coalashakes.com",
            )
            override suspend fun migrateGoogle(request: GoogleMigrationRequest): GoogleMigrationResult {
                requestToken = request.googleIdToken
                return GoogleMigrationResult(true, "test-owner", "heucilene@coalashakes.com", "google.com")
            }
        }
        val biometric = object : BiometricPreferences {
            override fun enabled(uid: String) = false; override fun ready(uid: String) = false
            override fun record(uid: String, enabled: Boolean) {}; override fun clear() {}
        }
        val vm = SessionViewModel(auth, SessionGate(), mode, biometric, api,
            object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push)
        runCurrent(); vm.loadGoogleMigration(); advanceUntilIdle()
        assertTrue(vm.googleMigration.value.available)
        vm.migrateGoogle("google-token", "outra@coalashakes.com"); advanceUntilIdle()
        assertEquals("", requestToken)
        assertNotNull(vm.googleMigration.value.error)
        auth.googleEmail = "heucilene@coalashakes.com"
        vm.migrateGoogle("google-token", "heucilene@coalashakes.com"); advanceUntilIdle()
        assertEquals("google-token", requestToken)
        assertEquals("test-owner", auth.googleExpectedUid)
        assertEquals("test-owner", vm.state.value.identity?.uid)
        assertTrue(vm.googleMigration.value.completed)
    }
    @Test fun persistedDeveloperViewAsIsRestoredBeforeHomeAndReconciledAtStartup() = runTest {
        val developerAuth = TestAuth().also { it.mutable.value = Identity("developer", DEVELOPER_VIEW_AS_EMAIL) }
        val storedSelection = InMemoryDeveloperViewAsStore().also { it.select("view-as-user") }
        val target = DeveloperViewAsUser("view-as-user", "Pessoa visualizada", "pessoa@example.invalid")
        var directoryReads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun developerViewAs(): DeveloperViewAsDirectory {
                directoryReads++
                assertEquals("view-as-user", storedSelection.current())
                return DeveloperViewAsDirectory(true, target.id, target, listOf(target))
            }
        }
        val biometric = object : BiometricPreferences {
            override fun enabled(uid: String) = false; override fun ready(uid: String) = false
            override fun record(uid: String, enabled: Boolean) {}; override fun clear() {}
        }
        val vm = SessionViewModel(developerAuth, SessionGate(), RuntimeMode(developerAuth), biometric, api,
            object : AppAttestation { override suspend fun token(): String? = null; override fun clear() {} }, push, storedSelection)

        // This assertion happens before the authentication flow or any network response can run.
        assertEquals("view-as-user", vm.developerViewAs.value.targetUserId)
        assertNull(vm.developerViewAs.value.targetName)
        advanceUntilIdle()
        assertEquals(1, directoryReads)
        assertEquals("view-as-user", vm.developerViewAs.value.targetUserId)
        assertEquals("Pessoa visualizada", vm.developerViewAs.value.targetName)
    }
    @Test fun homeUsesServerModulesAndRejectsOversizeAvatarBeforeSending() = runTest {
        var uploads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun profile() = ProfileResponse(Profile("Ana"), Modules(stockCount = true))
            override suspend fun avatar(photo: okhttp3.MultipartBody.Part): AvatarResponse { uploads++; return AvatarResponse("https://example.invalid/avatar.jpg") }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue); runCurrent()
        assertTrue(vm.profile.value.response!!.modules.stockCount); assertFalse(vm.profile.value.response!!.modules.localPurchase)
        vm.avatar(Document("photo.jpg", "image/jpeg", ByteArray(5 * 1024 * 1024 + 1))); advanceUntilIdle()
        assertEquals(0, uploads); assertNotNull(vm.feedback.value.error)
        vm.avatar(pending().receipts.single()); advanceUntilIdle()
        assertEquals(1, uploads); assertEquals("https://example.invalid/avatar.jpg", vm.profile.value.response!!.profile.avatarUrl)
    }
    @Test fun homeKeepsPointReachableWhenProfileCannotLoadOffline() = runTest {
        val cached = DemoApi().timeOptions(LocalDate.now().toString())
        val offlineQueue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = cached }
        val api = object : ApiService by DemoApi() {
            override suspend fun profile(): ProfileResponse = throw IOException("sem conexão")
            override suspend fun timeOptions(workDate: String): TimeOptions = throw IOException("sem conexão")
            override suspend fun markings(startDate: String, endDate: String): OwnMarkings = throw IOException("sem conexão")
            override suspend fun timeMonth(month: String): OwnMonth = throw IOException("sem conexão")
            override suspend fun adjustments(month: String): OwnAdjustments = throw IOException("sem conexão")
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, offlineQueue)
        advanceUntilIdle()
        assertNull(vm.profile.value.response)
        assertNotNull(vm.feedback.value.error)
        assertEquals("test-owner", vm.today.value.contextKey)
        assertEquals(cached, vm.today.value.timeOptions)
        assertEquals(com.coalaone.go.domain.ClockSource.LOCAL_PERMIT, vm.today.value.timeClockSource)
        assertEquals(false, vm.today.value.timeMarkingsAvailable)
    }
    @Test fun offlineHomeShowsOnlyPointAndNeverUsesFallbackForViewAs() {
        val modules = Modules(localPurchase = true, stockCount = true, schedule = true, timeRecording = true, requests = true)
        val failed = HomeProfile("test-owner", ProfileResponse(Profile("Ana"), modules), unavailable = true)
        val fallback = failed.modulesForHome("test-owner", viewingAnotherUser = false)
        assertNotNull(fallback)
        assertTrue(fallback!!.timeRecording)
        assertFalse(fallback.localPurchase)
        assertFalse(fallback.stockCount)
        assertFalse(fallback.schedule)
        assertFalse(fallback.requests)
        assertNull(failed.modulesForHome("test-owner", viewingAnotherUser = true))
        assertNull(failed.modulesForHome("another-context", viewingAnotherUser = false))
        assertEquals(modules, failed.copy(unavailable = false).modulesForHome("test-owner", viewingAnotherUser = false))
    }
    @Test fun failedRefreshReplacesPreviousModulesWithPointOnlyAndRecoversOnline() = runTest {
        var offline = false
        val api = object : ApiService by DemoApi() {
            override suspend fun profile(): ProfileResponse {
                if (offline) throw IOException("sem conexão")
                return ProfileResponse(Profile("Ana"), Modules(stockCount = true, timeRecording = true))
            }
            override suspend fun timeOptions(workDate: String): TimeOptions = if (offline) throw IOException("sem conexão")
                else DemoApi().timeOptions(workDate)
        }
        val cached = DemoApi().timeOptions(LocalDate.now().toString())
        val offlineQueue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = cached }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, offlineQueue)
        advanceUntilIdle()
        assertTrue(vm.profile.value.modulesForHome("test-owner", false)!!.stockCount)

        offline = true
        vm.refresh("test-owner"); advanceUntilIdle()
        val fallback = vm.profile.value.modulesForHome("test-owner", false)!!
        assertTrue(fallback.timeRecording)
        assertFalse(fallback.stockCount)
        assertEquals(cached, vm.today.value.timeOptions)

        offline = false
        vm.refresh("test-owner"); advanceUntilIdle()
        assertFalse(vm.profile.value.unavailable)
        assertTrue(vm.profile.value.modulesForHome("test-owner", false)!!.stockCount)
    }
    @Test fun failedRefreshFallbackWinsOverAnOlderHomeLoadInFlight() = runTest {
        val oldLoadStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseOldLoad = kotlinx.coroutines.CompletableDeferred<Unit>()
        var offline = false
        var optionReads = 0
        val cached = DemoApi().timeOptions(LocalDate.now().toString()).copy(mode = "pilot")
        val online = cached.copy(mode = "official")
        val api = object : ApiService by DemoApi() {
            override suspend fun profile(): ProfileResponse {
                if (offline) throw IOException("sem conexão")
                return ProfileResponse(Profile("Ana"), Modules(stockCount = true, timeRecording = true))
            }
            override suspend fun timeOptions(workDate: String): TimeOptions {
                optionReads++
                if (optionReads == 1) {
                    oldLoadStarted.complete(Unit)
                    releaseOldLoad.await()
                    return online.copy(workDate = workDate)
                }
                throw IOException("sem conexão")
            }
            override suspend fun markings(startDate: String, endDate: String): OwnMarkings {
                if (offline) throw IOException("sem conexão")
                return DemoApi().markings(startDate, endDate)
            }
        }
        val offlineQueue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = cached }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, offlineQueue)
        runCurrent()
        vm.loadToday(Modules(stockCount = true, timeRecording = true), null, "test-owner", force = true)
        runCurrent(); oldLoadStarted.await()

        offline = true
        vm.refresh("test-owner"); advanceUntilIdle()
        assertEquals("pilot", vm.today.value.timeOptions?.mode)
        assertFalse(vm.profile.value.modulesForHome("test-owner", false)!!.stockCount)

        releaseOldLoad.complete(Unit); advanceUntilIdle()
        assertEquals("pilot", vm.today.value.timeOptions?.mode)
        assertEquals(com.coalaone.go.domain.ClockSource.LOCAL_PERMIT, vm.today.value.timeClockSource)
        assertEquals(false, vm.today.value.timeMarkingsAvailable)
        assertEquals(2, optionReads)
    }
    @Test fun homeProfileHidesThePreviousTargetAndDiscardsALateResponse() = runTest {
        val firstStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseFirst = kotlinx.coroutines.CompletableDeferred<Unit>()
        var reads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun profile(): ProfileResponse {
                reads++
                return if (reads == 1) {
                    firstStarted.complete(Unit); releaseFirst.await()
                    ProfileResponse(Profile("Pessoa anterior"), Modules(stockCount = true))
                } else ProfileResponse(Profile("Pessoa atual"), Modules(schedule = true))
            }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue)
        runCurrent(); firstStarted.await()
        assertNull(vm.profile.value.visibleFor("view-as-user"))
        vm.refresh("view-as-user"); runCurrent()
        assertEquals("Pessoa atual", vm.profile.value.visibleFor("view-as-user")?.profile?.name)
        assertTrue(vm.profile.value.visibleFor("view-as-user")!!.modules.schedule)
        releaseFirst.complete(Unit); advanceUntilIdle()
        assertEquals("view-as-user", vm.profile.value.contextKey)
        assertEquals("Pessoa atual", vm.profile.value.response!!.profile.name)
        assertFalse(vm.profile.value.response!!.modules.stockCount)
    }
    @Test fun persistedViewAsKeysTheFirstHomeRequestAndCannotSurviveAContextChange() = runTest {
        val firstStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseFirst = kotlinx.coroutines.CompletableDeferred<Unit>()
        val storedSelection = InMemoryDeveloperViewAsStore().also { it.select("view-as-user") }
        var reads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun profile(): ProfileResponse {
                reads++
                return if (reads == 1) {
                    firstStarted.complete(Unit); releaseFirst.await()
                    ProfileResponse(Profile("Pessoa visualizada"), Modules(stockCount = true))
                } else ProfileResponse(Profile("Pessoa real"), Modules(schedule = true))
            }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue, storedSelection)
        assertEquals("view-as-user", vm.profile.value.contextKey)
        runCurrent(); firstStarted.await()
        storedSelection.clear(); vm.refresh("test-owner"); runCurrent()
        assertEquals("Pessoa real", vm.profile.value.visibleFor("test-owner")?.profile?.name)
        releaseFirst.complete(Unit); advanceUntilIdle()
        assertEquals("test-owner", vm.profile.value.contextKey)
        assertEquals("Pessoa real", vm.profile.value.response!!.profile.name)
        assertFalse(vm.profile.value.response!!.modules.stockCount)
    }
    @Test fun avatarCompletionCannotChangeTheNewViewAsContextOrItsFeedback() = runTest {
        val avatarStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseAvatar = kotlinx.coroutines.CompletableDeferred<Unit>()
        var profileReads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun profile(): ProfileResponse {
                profileReads++
                val name = if (profileReads == 1) "Pessoa real" else "Pessoa visualizada"
                return ProfileResponse(Profile(name), Modules(localPurchase = true))
            }
            override suspend fun avatar(photo: okhttp3.MultipartBody.Part): AvatarResponse {
                avatarStarted.complete(Unit); releaseAvatar.await()
                return AvatarResponse("https://example.invalid/new-avatar.jpg")
            }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue); runCurrent()
        vm.avatar(pending().receipts.single()); runCurrent(); avatarStarted.await()
        vm.refresh("view-as-user"); runCurrent()
        assertEquals("Pessoa visualizada", vm.profile.value.visibleFor("view-as-user")?.profile?.name)
        releaseAvatar.complete(Unit); advanceUntilIdle()
        assertEquals("Pessoa visualizada", vm.profile.value.response!!.profile.name)
        assertNull(vm.profile.value.response!!.profile.avatarUrl)
        assertNull(vm.feedback.value.notice)
    }
    @Test fun homeReloadsTodayForAViewAsTargetAndWhenReturningFromPoint() = runTest {
        var shift = "08:00" to "16:00"
        var optionReads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun profile() = ProfileResponse(Profile("Ana"), Modules(schedule = true, timeRecording = true))
            override suspend fun timeOptions(workDate: String): TimeOptions {
                optionReads++
                return TimeOptions(workDate, true, true, listOf(ExecutionUnit("unit", "Unidade", true)),
                    OfficialClock(true, "2026-10-23T18:00:00Z", "America/Belem"))
            }
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate, emptyList())
            override suspend fun timeMonth(month: String) = OwnMonth(month, listOf(OwnShift(LocalDate.now().toString(), "work",
                shift.first, shift.second, unitId = "unit", unitName = "Unidade", shiftName = "Turno")))
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue)
        runCurrent()
        val modules = Modules(schedule = true, timeRecording = true)
        vm.loadToday(modules, null, "real-user", force = true); advanceUntilIdle()
        assertEquals("08h–16h", vm.today.value.shiftShort)
        assertFalse(vm.today.value.visibleFor("view-as-user").loaded)
        assertNull(vm.today.value.visibleFor("view-as-user").shiftShort)
        shift = "14:00" to "22:00"
        vm.loadToday(modules, null, "view-as-user", force = true); advanceUntilIdle()
        assertEquals("view-as-user", vm.today.value.contextKey)
        assertEquals("14h–22h", vm.today.value.shiftShort)
        shift = "10:00" to "18:00"
        vm.loadToday(modules, null, "view-as-user", force = true); advanceUntilIdle()
        assertEquals("10h–18h", vm.today.value.shiftShort)
        assertEquals(3, optionReads)
    }
    @Test fun lateHomeResponseCannotReplaceTheCurrentViewAsTarget() = runTest {
        val firstStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseFirst = kotlinx.coroutines.CompletableDeferred<Unit>()
        var optionsReads = 0
        var monthReads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions {
                optionsReads++
                if (optionsReads == 1) { firstStarted.complete(Unit); releaseFirst.await() }
                return TimeOptions(workDate, true, true, listOf(ExecutionUnit("unit", "Unidade", true)),
                    OfficialClock(true, "2026-10-23T18:00:00Z", "America/Belem"))
            }
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate, emptyList())
            override suspend fun timeMonth(month: String): OwnMonth {
                monthReads++
                val hours = if (monthReads == 1) "14:00" to "22:00" else "08:00" to "16:00"
                return OwnMonth(month, listOf(OwnShift(LocalDate.now().toString(), "work", hours.first, hours.second,
                    unitId = "unit", unitName = "Unidade", shiftName = "Turno")))
            }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue); runCurrent()
        val modules = Modules(schedule = true, timeRecording = true)
        vm.loadToday(modules, null, "real-user", force = true); runCurrent(); firstStarted.await()
        vm.loadToday(modules, null, "view-as-user", force = true); runCurrent()
        assertEquals("14h–22h", vm.today.value.shiftShort)
        releaseFirst.complete(Unit); advanceUntilIdle()
        assertEquals("view-as-user", vm.today.value.contextKey)
        assertEquals("14h–22h", vm.today.value.shiftShort)
    }
    @Test fun homeDistinguishesAnUnavailableScheduleFromADayWithoutShift() = runTest {
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = TimeOptions(workDate, false, false, emptyList(),
                OfficialClock(true, "2026-10-23T18:00:00Z", "America/Belem"))
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate, emptyList())
            override suspend fun timeMonth(month: String): OwnMonth = throw IOException("indisponível")
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue); runCurrent()
        vm.loadToday(Modules(schedule = true, timeRecording = true), null, "real-user", force = true); advanceUntilIdle()
        assertTrue(vm.today.value.loaded)
        assertEquals(false, vm.today.value.scheduleAvailable)
        assertNull(vm.today.value.shift)
    }
    @Test fun homeShowsAConfirmedPunchImmediatelyAndKeepsItAcrossServerReconciliation() = runTest {
        val updates = TimeSummaryUpdates()
        val api = object : ApiService by DemoApi() {
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate, emptyList())
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue, InMemoryDeveloperViewAsStore(), updates)
        runCurrent()
        vm.loadToday(Modules(timeRecording = true), null, "test-owner", force = true); advanceUntilIdle()
        assertTrue(vm.today.value.timePunches.isEmpty())
        val date = LocalDate.now().toString()
        val marking = OwnMarking("receipt-now", date, 99, "${date}T12:00:00-03:00", "unit", "01", "available",
            classification = MarkingClassification("break_start"))
        updates.recorded("test-owner", marking); runCurrent()
        assertEquals(listOf("receipt-now"), vm.today.value.timePunches.map { it.receiptId })
        // An older/empty server response cannot make the just-confirmed count go backwards.
        vm.loadToday(Modules(timeRecording = true), null, "test-owner", force = true); advanceUntilIdle()
        assertEquals(listOf("receipt-now"), vm.today.value.timePunches.map { it.receiptId })
    }
    @Test fun homeDoesNotTreatAFailedTreatmentReadAsAnEmptyConfirmedList() = runTest {
        val api = object : ApiService by DemoApi() {
            override suspend fun adjustments(month: String): OwnAdjustments = throw IOException("indisponível")
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue); runCurrent()
        vm.loadToday(Modules(timeRecording = true), null, "test-owner", force = true); advanceUntilIdle()
        assertEquals(false, vm.today.value.timeTreatmentsAvailable)
    }
    @Test fun homeObservesOfflinePunchesWithoutPresentingThemAsOfficial() = runTest {
        val vm = HomeViewModel(repository(auth), mode, queue, scheduler, timeQueue); runCurrent()
        vm.loadToday(Modules(timeRecording = true), null, "test-owner", force = true); advanceUntilIdle()
        timeQueue.rows.value += TimeMarkingRow("test-owner", "offline-1", "permit", 1, 0, sealed = byteArrayOf())
        runCurrent()
        assertEquals(1, vm.today.value.timeOfflinePending)
    }
    @Test fun homeDoesNotOverwriteAnOfflineQueueChangeWhenRemoteReadsFinish() = runTest {
        val treatmentStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseTreatment = kotlinx.coroutines.CompletableDeferred<Unit>()
        val api = object : ApiService by DemoApi() {
            override suspend fun adjustments(month: String): OwnAdjustments {
                treatmentStarted.complete(Unit)
                releaseTreatment.await()
                return OwnAdjustments(emptyList())
            }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue); runCurrent()
        vm.loadToday(Modules(timeRecording = true), null, "test-owner", force = true); runCurrent()
        treatmentStarted.await()
        timeQueue.rows.value += TimeMarkingRow("test-owner", "offline-race", "permit", 1, 0, sealed = byteArrayOf())
        runCurrent()
        releaseTreatment.complete(Unit); advanceUntilIdle()
        assertEquals(1, vm.today.value.timeOfflinePending)
    }
    @Test fun homeDoesNotRestoreThePreviousJourneyAfterANewStartIsConfirmed() = runTest {
        val treatmentStarted = kotlinx.coroutines.CompletableDeferred<Unit>()
        val releaseTreatment = kotlinx.coroutines.CompletableDeferred<Unit>()
        val updates = TimeSummaryUpdates()
        val today = LocalDate.now()
        val previous = today.minusDays(1)
        fun marking(id: String, date: LocalDate, time: String, purpose: String) = OwnMarking(id, date.toString(),
            id.drop(1).toLong(), "${date}T$time:00-03:00", "unit", "01", "available",
            classification = MarkingClassification(purpose))
        val api = object : ApiService by DemoApi() {
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate, listOf(
                marking("r1", previous, "22:00", "journey_start"),
                marking("r2", today, "07:00", "journey_end"),
            ))
            override suspend fun timeMonth(month: String) = OwnMonth(month, listOf(
                OwnShift(previous.toString(), "work", "22:00", "07:00", overnight = true),
                OwnShift(today.toString(), "work", "22:00", "07:00", overnight = true),
            ))
            override suspend fun adjustments(month: String): OwnAdjustments {
                treatmentStarted.complete(Unit)
                releaseTreatment.await()
                return OwnAdjustments(emptyList())
            }
        }
        val vm = HomeViewModel(repository(auth, api), mode, queue, scheduler, timeQueue,
            InMemoryDeveloperViewAsStore(), updates); runCurrent()
        vm.loadToday(Modules(timeRecording = true), null, "test-owner", force = true); runCurrent()
        treatmentStarted.await()
        val newStart = marking("r3", today, "22:00", "journey_start")
        updates.recorded("test-owner", newStart); runCurrent()
        assertEquals(listOf("r3"), vm.today.value.timePunches.map { it.receiptId })
        releaseTreatment.complete(Unit); advanceUntilIdle()
        assertEquals(today.toString(), vm.today.value.timeWorkDate)
        assertEquals(listOf("r3"), vm.today.value.timePunches.map { it.receiptId })
    }
    @Test fun directDayLoadsAnOvernightContinuationAcrossTheMonthBoundary() = runTest {
        val monthReads = mutableListOf<String>(); val adjustmentReads = mutableListOf<String>()
        var requestedRange: Pair<String, String>? = null
        fun marking(id: String, date: String, at: String, purpose: String) = OwnMarking(id, date, id.drop(1).toLong(), at,
            "unit", "01", "available", classification = MarkingClassification(purpose))
        val api = object : ApiService by DemoApi() {
            override suspend fun markings(startDate: String, endDate: String): OwnMarkings {
                requestedRange = startDate to endDate
                return OwnMarkings(startDate, endDate, listOf(
                    marking("r9", "2026-01-31", "2026-01-31T07:00:00-03:00", "journey_end"),
                    marking("r1", "2026-01-31", "2026-01-31T22:00:00-03:00", "journey_start"),
                    marking("r2", "2026-02-01", "2026-02-01T02:00:00-03:00", "break_start"),
                    marking("r3", "2026-02-01", "2026-02-01T03:00:00-03:00", "break_end"),
                    marking("r4", "2026-02-01", "2026-02-01T07:00:00-03:00", "journey_end"),
                ))
            }
            override suspend fun timeMonth(month: String): OwnMonth {
                monthReads += month
                return OwnMonth(month, if (month == "2026-01") listOf(OwnShift("2026-01-31", "work", "22:00", "07:00", overnight = true)) else emptyList())
            }
            override suspend fun adjustments(month: String): OwnAdjustments { adjustmentReads += month; return OwnAdjustments(emptyList()) }
            override suspend fun timeBank(date: String) = TimeBankResponse()
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle())
        vm.loadDay("2026-01-31"); advanceUntilIdle()
        assertEquals("2026-01-31" to "2026-02-01", requestedRange)
        assertEquals(listOf("2026-01", "2026-02"), monthReads)
        assertEquals(listOf("2026-01", "2026-02"), adjustmentReads)
        val state = vm.state.value
        val shift = state.shifts.first { it.date == "2026-01-31" }
        assertEquals(listOf("r1", "r2", "r3", "r4"),
            TimeRules.journeyDay("2026-01-31", shift, state.markings, state.treatments).map { it.receiptId })
        assertEquals("2026-01-31", state.bankDate)
    }
    @Test fun directDayKeepsLoadedPunchesWhenTheBankReadFails() = runTest {
        val date = "2026-10-19"
        val api = object : ApiService by DemoApi() {
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate,
                listOf(OwnMarking("r1", date, 1, "${date}T08:00:00-03:00", "unit", "01", "available",
                    classification = MarkingClassification("journey_start"))))
            override suspend fun timeMonth(month: String) = OwnMonth(month,
                listOf(OwnShift(date, "work", "08:00", "17:00")))
            override suspend fun adjustments(month: String) = OwnAdjustments(emptyList())
            override suspend fun timeBank(date: String): TimeBankResponse = throw IOException("indisponível")
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle())
        vm.loadDay(date); advanceUntilIdle()
        assertEquals(listOf("r1"), vm.state.value.markings.map { it.receiptId })
        assertNull(vm.state.value.bankDate)
        assertNotNull(vm.feedback.value.error)
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
    @Test fun noteKeptForWithdrawalShowsOnItsCardAndCancelsOnServerThenPhone() = runTest {
        val cancelled = mutableListOf<String>(); var failCancel = true
        val api = object : ApiService by DemoApi() {
            override suspend fun cancelUpload(request: CancelUpload): CancelUploadResponse { if (failCancel) throw IOException(); cancelled += request.submissionId; return CancelUploadResponse(CancelledUpload("cancelled")) }
        }
        val repo = repository(auth, api); val vm = PurchaseViewModel(repo, mode, queue, QueueSync(auth, queue, repo), scheduler)
        runCurrent()
        val withdrawal = vm.state.value.withdrawals!!.withdrawals.first()
        vm.openUnit(withdrawal.unitId); assertEquals(withdrawal.unitId, vm.state.value.unitView)
        vm.select("cash_withdrawal", withdrawal); vm.attach(pending().receipts.single(), false); val id = vm.state.value.selected!!.submissionId
        vm.upload(); advanceUntilIdle()
        assertEquals(withdrawal.sourceId, vm.state.value.queueWithdrawals[id]); assertNotNull(vm.state.value.review)
        // Offline: nothing is dropped, so the server copy is never orphaned.
        vm.discard(id); advanceUntilIdle()
        assertEquals(id, queue.rows.value.single().id); assertNotNull(vm.feedback.value.error)
        failCancel = false; vm.discard(id); advanceUntilIdle()
        assertEquals(listOf(id), cancelled); assertTrue(queue.rows.value.isEmpty()); assertNull(vm.state.value.review)
        assertEquals(withdrawal.unitId, vm.state.value.unitView)
        vm.closeUnit(); assertNull(vm.state.value.unitView)
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
    @Test fun punchRetriesTheSameAttemptAndDateUntilTheServerAnswersAndStartsOverAfterConflict() = runTest {
        val sent = mutableListOf<MarkingRequest>(); var failures = mutableListOf<Throwable>(java.io.IOException("lost"))
        val api = object : ApiService by DemoApi() {
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse { sent += request; failures.removeFirstOrNull()?.let { throw it }; return DemoApi().mark(request) }
        }
        val saved = androidx.lifecycle.SavedStateHandle()
        val repository = repository(auth, api)
        val vm = timeViewModel(auth, repository, saved); vm.load(); advanceUntilIdle()
        vm.record(declaredPurpose = "journey_start"); advanceUntilIdle()
        assertNotNull(vm.feedback.value.error)
        // A new view model over the same saved state (process killed) resends the same attempt and date.
        val revived = timeViewModel(auth, repository, saved); revived.load(); advanceUntilIdle()
        revived.record(declaredPurpose = "journey_start"); advanceUntilIdle()
        assertEquals(sent[0], sent[1]); assertEquals("mobile", sent[1].channel)
        assertNotNull(revived.state.value.last); assertNull(saved.get<String>("attemptId"))
        failures = mutableListOf(retrofit2.HttpException(retrofit2.Response.error<Any>(409, "{}".toResponseBody())))
        revived.record(declaredPurpose = "journey_start"); advanceUntilIdle(); assertNull(saved.get<String>("attemptId"))
        revived.record(declaredPurpose = "journey_start"); advanceUntilIdle()
        assertNotEquals(sent[2].attemptId, sent[3].attemptId)
    }
    @Test fun locationIsPreservedWithThePunchAcrossNetworkFailureAndProcessRestart() = runTest {
        val sent = mutableListOf<MarkingRequest>(); var first = true
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions {
                val original = DemoApi().timeOptions(workDate)
                return original.copy(executionUnits = original.executionUnits.map { unit ->
                    unit.copy(locationPolicy = LocationPolicy("observe", 1, 10_000, 100.0, "https://example.test/privacidade"))
                })
            }
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sent += request
                if (first) { first = false; throw java.io.IOException("lost") }
                return DemoApi().mark(request)
            }
        }
        val saved = androidx.lifecycle.SavedStateHandle(); val repository = repository(auth, api)
        val location = LocationAttempt("capture-1", "captured", 300, "2026-10-19T11:00:00Z", -1.4558, -48.4902, 15.0)
        val vm = timeViewModel(auth, repository, saved); vm.load(); advanceUntilIdle()
        vm.record(true, location, "journey_start"); advanceUntilIdle(); assertTrue(vm.hasPendingLocationAttempt())
        val revived = timeViewModel(auth, repository, saved); revived.load(); advanceUntilIdle()
        revived.record(declaredPurpose = "journey_start"); advanceUntilIdle()
        assertEquals(sent[0].attemptId, sent[1].attemptId); assertEquals(location, sent[1].locationAttempt)
        assertFalse(revived.hasPendingLocationAttempt()); assertNull(saved.get<String>("attemptLocation"))
    }
    @Test fun todayIsReadBeforeAPunchIsSuggestedAndAPastMonthDoesNotCount() = runTest {
        val releaseMonth = kotlinx.coroutines.CompletableDeferred<Unit>()
        val api = object : ApiService by DemoApi() { override suspend fun markings(startDate: String, endDate: String): OwnMarkings {
            releaseMonth.await(); return DemoApi().markings(startDate, endDate)
        } }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle())
        vm.load(); advanceUntilIdle()
        // Options arrived, today's punches did not: the day is still unread.
        assertNotNull(vm.state.value.options); assertEquals(DayLoad.PENDING, vm.state.value.dayLoad)
        releaseMonth.complete(Unit); advanceUntilIdle()
        assertEquals(DayLoad.READ, vm.state.value.dayLoad)
        vm.month(java.time.YearMonth.now().minusMonths(1)); advanceUntilIdle()
        assertEquals(DayLoad.PENDING, vm.state.value.dayLoad)
        vm.load(); advanceUntilIdle()
        assertEquals(DayLoad.READ, vm.state.value.dayLoad); assertEquals(java.time.YearMonth.now(), vm.state.value.month)
    }
    @Test fun pendingAttemptSurvivesReloadingTheDaySoTheHomeSheetResendsTheSamePunch() = runTest {
        val sent = mutableListOf<MarkingRequest>(); var lose = true
        val api = object : ApiService by DemoApi() { override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
            sent += request; if (lose) { lose = false; throw java.io.IOException("lost") }; return DemoApi().mark(request)
        } }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle())
        vm.load(); advanceUntilIdle()
        vm.record(declaredPurpose = "break_start"); advanceUntilIdle()
        assertTrue(vm.hasPendingAttempt())
        // Opening the home sheet reloads the day; the attempt and its purpose stay.
        vm.load(); advanceUntilIdle()
        assertEquals("break_start", vm.pendingAttempt()?.purpose)
        vm.record(declaredPurpose = "journey_end"); advanceUntilIdle()
        assertEquals(2, sent.size); assertEquals(sent[0].attemptId, sent[1].attemptId)
        assertEquals("break_start", sent[1].declaredPurpose); assertFalse(vm.hasPendingAttempt())
    }
    @Test fun aFailedOptionsReadSettlesTheDayAsUnread() = runTest {
        val api = object : ApiService by DemoApi() { override suspend fun timeOptions(workDate: String): TimeOptions =
            throw retrofit2.HttpException(retrofit2.Response.error<Any>(500, "{}".toResponseBody())) }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle())
        vm.load(); advanceUntilIdle()
        assertEquals(DayLoad.UNREAD, vm.state.value.dayLoad)
    }
    @Test fun offlinePunchStaysLocalWithoutPretendingItHasAnNsr() = runTest {
        var sends = 0
        val api = object : ApiService by DemoApi() { override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
            sends++; return DemoApi().mark(request)
        } }
        val queue = MemoryTimeOfflineQueue().also {
            it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString())
        }; val repository = repository(auth, api)
        val vm = timeViewModel(auth, repository, androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle(); vm.record(false, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertEquals(0, sends); assertEquals(1, queue.rows.value.size)
        assertNotNull(vm.state.value.lastOffline); assertNull(vm.state.value.last)
    }
    @Test fun pilotPreservesLocallyWhenHlbIsUnavailableEvenWithInternet() = runTest {
        var sends = 0
        val unavailable = TimeOptions(LocalDate.now().toString(), true, true,
            listOf(ExecutionUnit("unit", "Unidade", true, "America/Fortaleza")),
            OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE"), mode = "pilot")
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = unavailable.copy(workDate = workDate)
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse { sends++; return DemoApi().mark(request) }
        }
        val queue = MemoryTimeOfflineQueue().also { memory -> memory.cachedOptionsValue = unavailable.copy(
            officialClock = OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza")) }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle()
        assertTrue(vm.state.value.offlineReady)
        vm.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertEquals(0, sends)
        assertEquals(1, queue.rows.value.size)
        assertNotNull(vm.state.value.lastOffline)
    }
    @Test fun pendingOnlineAttemptIsReplayedInsteadOfBecomingANewLocalPunchDuringHlbOutage() = runTest {
        var hlbUnavailable = false
        val sent = mutableListOf<MarkingRequest>()
        val healthy = TimeOptions(LocalDate.now().toString(), true, true,
            listOf(ExecutionUnit("unit", "Unidade", true, "America/Fortaleza")),
            OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza"), mode = "pilot")
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = healthy.copy(workDate = workDate,
                officialClock = if (hlbUnavailable) OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE") else healthy.officialClock)
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sent += request
                if (sent.size == 1) throw java.io.IOException("resposta perdida")
                return DemoApi().mark(request)
            }
        }
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = healthy }
        val saved = androidx.lifecycle.SavedStateHandle()
        val vm = timeViewModel(auth, repository(auth, api), saved, queue)
        vm.load(); advanceUntilIdle()
        vm.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertTrue(vm.hasPendingAttempt())

        hlbUnavailable = true
        vm.refreshClock(); advanceUntilIdle()
        assertTrue(TimeRules.canPreserve(vm.state.value.options, vm.state.value.unitId, vm.state.value.offlineReady))
        vm.record(true, declaredPurpose = "journey_end"); advanceUntilIdle()

        assertEquals(2, sent.size)
        assertEquals(sent[0], sent[1])
        assertTrue(queue.rows.value.isEmpty())
        assertFalse(vm.hasPendingAttempt())
        assertNull(saved.get<String>("attemptUnitId"))
        assertNull(saved.get<String>("attemptPurpose"))
    }
    @Test fun pendingAttemptShowsItsOriginalPurposeAndClockSourceNamesThePermitAnchor() = runTest {
        var hlbUnavailable = false
        val healthy = TimeOptions(LocalDate.now().toString(), true, true,
            listOf(ExecutionUnit("unit", "Unidade", true, "America/Fortaleza")),
            OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza"), mode = "pilot")
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = healthy.copy(workDate = workDate,
                officialClock = if (hlbUnavailable) OfficialClock(false, issue = "REP_P_TIME_UNAVAILABLE") else healthy.officialClock)
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse = throw java.io.IOException("resposta perdida")
        }
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = healthy }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle()
        assertEquals(com.coalaone.go.domain.ClockSource.OFFICIAL, vm.state.value.clockSource)
        vm.record(true, declaredPurpose = "break_start"); advanceUntilIdle()
        val pending = vm.pendingAttempt()
        assertEquals("break_start", pending?.purpose)
        assertEquals("unit", pending?.unitId)
        assertNotNull(pending?.firstTriedAt)
        assertEquals("OFFICIAL", pending?.firstTriedSource)

        hlbUnavailable = true
        vm.refreshClock(); advanceUntilIdle()
        // The permit anchor keeps the clock running, but under its own name.
        assertEquals(com.coalaone.go.domain.ClockSource.LOCAL_PERMIT, vm.state.value.clockSource)
        assertNotNull(vm.state.value.clockOffset)
        assertNull(TimeRules.blockedReason(vm.state.value.options, vm.state.value.offlineReady))
    }
    @Test fun changingUnitDoesNotDiscardOrMutateAPendingAttempt() = runTest {
        val options = TimeOptions(LocalDate.now().toString(), true, true,
            listOf(ExecutionUnit("unit-a", "Unidade A", true, "America/Fortaleza"),
                ExecutionUnit("unit-b", "Unidade B", false, "America/Fortaleza")),
            OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza"), mode = "pilot")
        val sent = mutableListOf<MarkingRequest>()
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = options.copy(workDate = workDate)
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sent += request
                if (sent.size == 1) throw java.io.IOException("resposta perdida")
                return DemoApi().mark(request)
            }
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(),
            MemoryTimeOfflineQueue().also { it.cachedOptionsValue = options })
        vm.load(); advanceUntilIdle()
        vm.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertTrue(vm.hasPendingAttempt())

        vm.unit("unit-b")
        assertEquals("unit-a", vm.state.value.unitId)
        assertEquals("unit-a", vm.pendingAttempt()?.unitId)
        vm.record(true, declaredPurpose = "journey_end"); advanceUntilIdle()

        assertEquals(2, sent.size)
        assertEquals(sent[0], sent[1])
    }
    @Test fun confirmedJourneyEndCanCloseLaterAndANewPunchReopensTheVisualCycle() = runTest {
        val saved = androidx.lifecycle.SavedStateHandle()
        val vm = timeViewModel(auth, repository(auth, DemoApi()), saved,
            MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString()) })
        vm.load(); advanceUntilIdle()
        vm.record(true, declaredPurpose = "journey_end"); advanceUntilIdle()
        val workDate = vm.state.value.last!!.marking.markedAt.take(10)
        assertEquals(workDate, vm.state.value.journeyClosurePromptDate)

        vm.deferJourneyClosure()
        assertNull(vm.state.value.journeyClosurePromptDate)
        assertNull(vm.state.value.closedJourneyDate)
        vm.closeJourneyCycle(workDate)
        advanceUntilIdle()
        assertEquals(workDate, vm.state.value.closedJourneyDate)
        assertEquals(workDate, saved.get<String>("closedJourneyDate"))

        vm.record(true, declaredPurpose = "journey_end"); advanceUntilIdle()
        assertNull(vm.state.value.closedJourneyDate)
        assertNull(saved.get<String>("closedJourneyDate"))
        assertEquals(workDate, vm.state.value.journeyClosurePromptDate)
    }
    @Test fun reclassifyingAnIntermediatePunchAsJourneyEndDoesNotOfferToCloseTheDay() = runTest {
        val workDate = LocalDate.now().toString()
        var firstPurpose = "journey_start"
        var secondPurpose = "break_start"
        fun rows() = listOf(
            OwnMarking("r1", workDate, 1, "${workDate}T08:00:00-03:00", "unit", "01", "available",
                classification = MarkingClassification(firstPurpose)),
            OwnMarking("r2", workDate, 2, "${workDate}T12:00:00-03:00", "unit", "01", "available",
                classification = MarkingClassification(secondPurpose)),
        )
        val api = object : ApiService by DemoApi() {
            override suspend fun markings(startDate: String, endDate: String) = OwnMarkings(startDate, endDate, rows())
            override suspend fun timeMonth(month: String) = OwnMonth(month,
                listOf(OwnShift(workDate, "work", "08:00", "17:00")))
            override suspend fun adjustments(month: String) = OwnAdjustments(emptyList())
            override suspend fun classifyMarking(receiptId: String, request: ClassificationUpdate): ClassificationResult {
                if (receiptId == "r1") firstPurpose = request.purpose else secondPurpose = request.purpose
                return ClassificationResult(MarkingClassification(request.purpose))
            }
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(),
            MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(workDate) })
        vm.load(); advanceUntilIdle()
        vm.classify("r1", "journey_end"); advanceUntilIdle()
        assertNull(vm.state.value.journeyClosurePromptDate)
        vm.classify("r2", "journey_end"); advanceUntilIdle()
        assertEquals(workDate, vm.state.value.journeyClosurePromptDate)
    }
    @Test fun coldOfflineStartWithoutPermitExplainsTheBlockAndDoesNotClaimEmptyHistory() = runTest {
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions = throw IOException("sem conexão")
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle())
        vm.load(); advanceUntilIdle()
        assertFalse(vm.state.value.offlineReady)
        assertFalse(vm.state.value.monthDataAvailable)
        assertTrue(vm.state.value.offlineIssue.orEmpty().contains("ainda não recebeu autorização"))
        assertNull(vm.feedback.value.error)
    }
    @Test fun offlineClockResumeRestoresThePermitInsteadOfShowingAGenericNetworkFailure() = runTest {
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString()) }
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions = throw IOException("sem conexão")
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.refreshClock(); advanceUntilIdle()
        assertTrue(vm.state.value.offlineReady)
        assertEquals(com.coalaone.go.domain.ClockSource.LOCAL_PERMIT, vm.state.value.clockSource)
        assertNull(vm.feedback.value.error)
    }
    @Test fun authorizationRefusalIsNotHandledAsOfflineNetworkFallback() = runTest {
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString()) }
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions = throw AppFailure(ErrorCategory.PERMISSION, false, "Sem acesso")
        }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle()
        assertFalse(vm.state.value.offlineReady)
        assertEquals("Sem acesso", vm.feedback.value.error)
    }
    @Test fun failedHistoryReadCannotReplaceAnExplicitServerBlockWithAnOlderPermit() = runTest {
        for (blocked in listOf(
            DemoApi().timeOptions(LocalDate.now().toString()).copy(eligible = false),
            DemoApi().timeOptions(LocalDate.now().toString()).copy(markingEnabled = false),
            DemoApi().timeOptions(LocalDate.now().toString()).copy(officialClock = OfficialClock(false, issue = "REP_P_TIME_NOT_CONFIGURED")),
        )) {
            val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString()) }
            val api = object : ApiService by DemoApi() {
                override suspend fun timeOptions(workDate: String) = blocked
                override suspend fun markings(startDate: String, endDate: String): OwnMarkings = throw IOException("sem conexão")
            }
            val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
            vm.load(); advanceUntilIdle()
            assertFalse(vm.state.value.offlineReady)
            assertEquals(blocked, vm.state.value.options)
        }
    }
    @Test fun coldOfflineStartUsesAStillValidLocalAuthorization() = runTest {
        val cached = DemoApi().timeOptions(LocalDate.now().toString())
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions = throw IOException("sem conexão")
        }
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = cached }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle()
        assertTrue(vm.state.value.offlineReady)
        assertEquals(com.coalaone.go.domain.ClockSource.LOCAL_PERMIT, vm.state.value.clockSource)
        vm.record(false, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertEquals(1, queue.rows.value.size)
        assertNotNull(vm.state.value.lastOffline)
    }
    @Test fun lostOnlineReplyIsRecoveredFromTheDurableOriginalWithoutAnotherCapture() = runTest {
        val base = MemoryTimeOfflineQueue()
        val queued = object : TimeOfflineQueue by base {
            override suspend fun beginOnline(uid: String, request: MarkingRequest, scope: String) {
                val row = TimeMarkingRow(uid, request.attemptId, "online:$scope:${request.attemptId}", 0, 0, sealed = byteArrayOf())
                base.rows.value = listOf(row); base.readyRows = listOf(row to request)
            }
            override suspend fun hasPending(uid: String) = base.readyRows.isNotEmpty()
            override suspend fun confirmed(uid: String, id: String, request: MarkingRequest, response: MarkingResponse) {
                base.synced(uid, id); base.readyRows = base.readyRows.filterNot { it.first.id == id }
            }
        }
        val requests = mutableListOf<MarkingRequest>()
        val api = object : ApiService by DemoApi() {
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                requests += request
                if (requests.size == 1) throw java.io.IOException("synthetic lost reply")
                return MarkingResponse("replayed", "confirmed-original", "pending", null,
                    RecordedMarking(3, "${request.workDate}T08:00:00-0300", request.executionUnitId))
            }
        }
        val repo = repository(auth, api)
        val vm = TimeViewModel(repo, androidx.lifecycle.SavedStateHandle(), auth, queued,
            TimeOfflineSync(auth, queued, repo), TimeOfflineWorkScheduler { })
        vm.load(); advanceUntilIdle()
        vm.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertTrue(vm.hasPendingAttempt())
        assertEquals(1, base.readyRows.size)
        vm.load(); advanceUntilIdle()
        assertEquals(2, requests.size)
        assertEquals(requests[0], requests[1])
        assertNull(requests[1].offline)
        assertFalse(vm.hasPendingAttempt())
        assertTrue(base.readyRows.isEmpty())
    }

    @Test fun failedOnlineJournalDoesNotSendAndRetriesTheSameAttempt() = runTest {
        val base = MemoryTimeOfflineQueue()
        var failJournal = true
        val protected = mutableListOf<MarkingRequest>()
        val queue = object : TimeOfflineQueue by base {
            override suspend fun beginOnline(uid: String, request: MarkingRequest, scope: String) {
                protected += request
                if (failJournal) throw java.io.IOException("synthetic vault unavailable")
            }
        }
        val sent = mutableListOf<MarkingRequest>()
        val api = object : ApiService by DemoApi() {
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sent += request
                return DemoApi().mark(request, expectedOwner)
            }
        }
        val repo = repository(auth, api)
        val vm = TimeViewModel(repo, androidx.lifecycle.SavedStateHandle(), auth, queue,
            TimeOfflineSync(auth, queue, repo), TimeOfflineWorkScheduler { })
        vm.load(); advanceUntilIdle()
        vm.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertTrue(vm.hasPendingAttempt()); assertTrue(sent.isEmpty())
        failJournal = false
        vm.record(true, declaredPurpose = "journey_end"); advanceUntilIdle()
        assertEquals(1, sent.size)
        assertEquals(protected[0], sent[0])
    }

    @Test fun versionTwoClosureRequiresClosedAcknowledgementBeforeSuccess() = runTest {
        val base = MemoryTimeOfflineQueue()
        var confirmed = 0
        val queued = object : TimeOfflineQueue by base {
            override suspend fun closeCycleAction(uid: String, elapsedRealtimeMs: Long) = OfflineCycleAction("close", "official",
                "permit", "cycle", 1000, 2000, 7, "key", "receipt", 0, "synthetic")
            override suspend fun confirmCycle(uid: String, response: OfflineCycleResponse) { confirmed++ }
        }
        var closed = false
        val api = object : ApiService by DemoApi() {
            override suspend fun offlineCycle(request: OfflineCycleAction, expectedOwner: String?) = OfflineCycleResponse(
                OfflineCycle("cycle", "2026-10-27T08:00:00Z", "2026-10-28T08:00:00Z"), if (closed) "closed" else "active")
        }
        val repo = repository(auth, api)
        val vm = TimeViewModel(repo, androidx.lifecycle.SavedStateHandle(), auth, queued,
            TimeOfflineSync(auth, queued, repo), TimeOfflineWorkScheduler { })
        val date = LocalDate.now().toString()
        vm.closeJourneyCycle(date); advanceUntilIdle()
        assertNull(vm.state.value.closedJourneyDate)
        assertEquals(0, confirmed)
        closed = true
        vm.closeJourneyCycle(date); advanceUntilIdle()
        assertEquals(date, vm.state.value.closedJourneyDate)
        assertEquals(1, confirmed)
    }

    @Test fun syncedOfflineJourneyEndReopensAClosedCycleAndAsksAgain() = runTest {
        val workDate = "2026-10-19"
        val saved = androidx.lifecycle.SavedStateHandle(mapOf("closedJourneyDate" to workDate))
        val queue = MemoryTimeOfflineQueue().also {
            val row = TimeMarkingRow("test-owner", "offline-end", "permit", 1, 0, sealed = byteArrayOf())
            it.rows.value = listOf(row)
            it.readyRows = listOf(row to MarkingRequest("offline-end", workDate, "unit", declaredPurpose = "journey_end"))
            it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString())
        }
        val vm = timeViewModel(auth, repository(auth, DemoApi()), saved, queue)
        vm.load(); advanceUntilIdle()
        assertEquals(listOf("offline-end"), queue.syncedIds)
        assertNull(vm.state.value.closedJourneyDate)
        assertNull(saved.get<String>("closedJourneyDate"))
        assertEquals(workDate, vm.state.value.journeyClosurePromptDate)
    }
    @Test fun offlinePunchWithoutAValidPermitIsRejectedBeforeCapture() = runTest {
        val queue = MemoryTimeOfflineQueue()
        val vm = timeViewModel(auth, repository(auth, DemoApi()), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle()
        queue.cachedOptionsValue = null
        // Simulate a permit that became invalid after the screen had loaded.
        val field = TimeViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val state = field.get(vm) as kotlinx.coroutines.flow.MutableStateFlow<TimeState>
        state.value = state.value.copy(offlineReady = false)
        vm.record(false, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertTrue(queue.rows.value.isEmpty())
        assertTrue(vm.feedback.value.error.orEmpty().contains("Conecte-se à internet"))
    }
    @Test fun definitiveHlbRejectionBecomesALocalPunchButAmbiguousFailureDoesNot() = runTest {
        var calls = 0
        val healthy = TimeOptions(LocalDate.now().toString(), true, true,
            listOf(ExecutionUnit("unit", "Unidade", true, "America/Fortaleza")),
            OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza"), mode = "pilot")
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = healthy.copy(workDate = workDate)
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                calls++
                throw retrofit2.HttpException(retrofit2.Response.error<Any>(422,
                    """{"error":{"code":"REP_P_TIME_UNAVAILABLE","message":"Hora oficial indisponível."}}""".toResponseBody()))
            }
        }
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = healthy }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(); advanceUntilIdle()
        vm.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()

        assertEquals(1, calls)
        assertEquals(1, queue.rows.value.size)
        assertNotNull(vm.state.value.lastOffline)
        assertFalse(vm.hasPendingAttempt())
    }
    @Test fun lostResponseThenDefinitiveHlbRejectionPreservesOnePunchWithTheOriginalUnitAndPurpose() = runTest {
        var calls = 0
        val sent = mutableListOf<MarkingRequest>()
        val options = TimeOptions(LocalDate.now().toString(), true, true,
            listOf(ExecutionUnit("unit-a", "Unidade A", true, "America/Fortaleza"),
                ExecutionUnit("unit-b", "Unidade B", true, "America/Fortaleza")),
            OfficialClock(true, java.time.Instant.now().toString(), "America/Fortaleza"), mode = "pilot")
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String) = options.copy(workDate = workDate)
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sent += request; calls++
                if (calls == 1) throw java.io.IOException("resposta perdida")
                throw retrofit2.HttpException(retrofit2.Response.error<Any>(422,
                    """{"error":{"code":"REP_P_TIME_UNAVAILABLE","message":"Hora oficial indisponível."}}""".toResponseBody()))
            }
        }
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = options }
        val saved = androidx.lifecycle.SavedStateHandle()
        val first = timeViewModel(auth, repository(auth, api), saved, queue)
        first.load(); advanceUntilIdle()
        first.unit("unit-b")
        first.record(true, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertTrue(first.hasPendingAttempt())

        val restored = timeViewModel(auth, repository(auth, api), saved, queue)
        restored.load(); advanceUntilIdle()
        restored.record(true, declaredPurpose = "journey_end"); advanceUntilIdle()

        assertEquals(2, sent.size)
        assertEquals(sent[0], sent[1])
        assertEquals(1, queue.rows.value.size)
        assertEquals(listOf("unit-b"), queue.capturedUnitIds)
        assertEquals(listOf("journey_start"), queue.capturedPurposes)
        assertFalse(restored.hasPendingAttempt())
    }
    @Test fun openingOfflineReadsTheLocalPermitWithoutWaitingForAnyNetworkRequest() = runTest {
        var reads = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun timeOptions(workDate: String): TimeOptions { reads++; error("Network must not be called") }
        }
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString()) }
        val vm = timeViewModel(auth, repository(auth, api), androidx.lifecycle.SavedStateHandle(), queue)
        vm.load(online = false); advanceUntilIdle()
        assertTrue(vm.state.value.offlineReady)
        assertEquals(com.coalaone.go.domain.ClockSource.LOCAL_PERMIT, vm.state.value.clockSource)
        assertEquals(0, reads)
        vm.refreshClock(online = false); advanceUntilIdle()
        assertEquals(0, reads)
    }
    @Test fun aSchedulingFailureCannotHideAnAlreadySavedPunch() = runTest {
        val queue = MemoryTimeOfflineQueue().also { it.cachedOptionsValue = DemoApi().timeOptions(LocalDate.now().toString()) }
        val repo = repository(auth)
        val vm = TimeViewModel(repo, androidx.lifecycle.SavedStateHandle(), auth, queue, TimeOfflineSync(auth, queue, repo),
            TimeOfflineWorkScheduler { error("scheduler interrupted") })
        vm.load(online = false); advanceUntilIdle()
        vm.record(online = false, declaredPurpose = "journey_start"); advanceUntilIdle()
        assertEquals(1, queue.rows.value.size)
        assertNotNull(vm.state.value.lastOffline)
        assertNull(vm.feedback.value.error)
    }
    @Test fun invalidConfirmationAndViewAsNeverMarkLocalPunchesAsSent() = runTest {
        val queue = MemoryTimeOfflineQueue()
        queue.readyRows = listOf(TimeMarkingRow("test-owner", "first", "permit", 1, 0, sealed = byteArrayOf()) to
            MarkingRequest("first", "2026-10-27", "unit"))
        var sends = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sends++
                return MarkingResponse("unknown", "", "pending", marking = RecordedMarking(1, "2026-10-27T12:00:00-0300", "other-unit"))
            }
        }
        val viewAs = InMemoryDeveloperViewAsStore().also { it.select("other") }
        val sync = TimeOfflineSync(auth, queue, repository(auth, api), viewAs)
        assertFalse(sync.sync("test-owner")); assertEquals(0, sends)
        viewAs.clear()
        sync.sync("test-owner")
        assertEquals(1, sends); assertTrue(queue.syncedIds.isEmpty())
        assertEquals(1, queue.failures.size)
    }
    @Test fun switchingAccountOrViewAsDuringTheReplyKeepsTheOriginalAttemptPending() = runTest {
        for (switchAccount in listOf(true, false)) {
            auth.mutable.value = Identity("test-owner", "test@example.invalid")
            val queue = MemoryTimeOfflineQueue()
            val request = MarkingRequest("original-attempt", "2026-10-27", "unit")
            queue.readyRows = listOf(TimeMarkingRow("test-owner", request.attemptId, "permit", 1, 0, sealed = byteArrayOf()) to request)
            val viewAs = InMemoryDeveloperViewAsStore()
            var expected: String? = null
            val api = object : ApiService by DemoApi() {
                override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                    expected = expectedOwner
                    if (switchAccount) auth.mutable.value = Identity("other", null) else viewAs.select("other")
                    return MarkingResponse("recorded", "receipt", "available",
                        marking = RecordedMarking(1, "2026-10-27T12:00:00-0300", "unit"))
                }
            }
            assertFalse(TimeOfflineSync(auth, queue, repository(auth, api), viewAs).sync("test-owner"))
            assertEquals("test-owner", expected)
            assertTrue(queue.syncedIds.isEmpty()); assertTrue(queue.failures.isEmpty())
            assertEquals(request, queue.readyRows.single().second)
        }
    }
    @Test fun offlineSyncStopsAtFirstFailureToPreserveTheSignedSequence() = runTest {
        val queue = MemoryTimeOfflineQueue()
        fun pending(id: String, sequence: Int) = TimeMarkingRow("test-owner", id, "permit", sequence, sequence.toLong(), sealed = byteArrayOf()) to
            MarkingRequest(id, "2026-10-19", "unit")
        queue.readyRows = listOf(pending("first", 1), pending("second", 2))
        var sends = 0
        val api = object : ApiService by DemoApi() {
            override suspend fun mark(request: MarkingRequest, expectedOwner: String?): MarkingResponse {
                sends++
                throw IOException("offline")
            }
        }
        val completed = TimeOfflineSync(auth, queue, repository(auth, api)).sync("test-owner")
        assertFalse(completed)
        assertEquals(1, sends)
        assertEquals(listOf("first"), queue.failures.map { it.first })
        assertTrue(queue.syncedIds.isEmpty())
    }
}
