package com.coalaone.go.data

import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.*

interface ApiService {
    @GET("api/app/version?packageName=coalaone.go") suspend fun release(): Release
    @POST("api/auth/forgot-password") suspend fun reset(@Body request: ResetRequest)
    @GET("api/mobile/profile") suspend fun profile(): ProfileResponse
    @GET("api/mobile/auth/google-migration") suspend fun googleMigrationStatus(): GoogleMigrationStatus
    @POST("api/mobile/auth/google-migration") suspend fun migrateGoogle(@Body request: GoogleMigrationRequest): GoogleMigrationResult
    @GET("api/mobile/corporate-device") suspend fun corporateDevice(@Query("installationId") installationId: String): CorporateDeviceStatus
    @POST("api/mobile/corporate-device") suspend fun requestCorporateDevice(@Body request: CorporateDeviceRequest): CorporateDeviceRequested
    @GET("api/auth/view-as") suspend fun developerViewAs(): DeveloperViewAsDirectory
    @POST("api/auth/view-as") suspend fun startDeveloperViewAs(@Body request: DeveloperViewAsSelection): DeveloperViewAsSelectionResponse
    @HTTP(method = "DELETE", path = "api/auth/view-as") suspend fun stopDeveloperViewAs(): DeveloperViewAsStopped
    @POST("api/mobile/push/devices") suspend fun registerPush(@Body request: PushDeviceRegistration, @Header("X-Coala-Local-Owner") expectedOwner: String): PushDeviceRegistered
    @HTTP(method = "DELETE", path = "api/mobile/push/devices", hasBody = true) suspend fun removePush(@Body request: PushDeviceRemoval, @Header("X-Coala-Local-Owner") expectedOwner: String): PushDeviceRemoved
    @Multipart @POST("api/mobile/profile/photo") suspend fun avatar(@Part photo: MultipartBody.Part): AvatarResponse
    @GET("api/stock/mobile-count") suspend fun countContext(): CountContext
    @POST("api/stock/mobile-count/start") suspend fun startCount(@Body request: StartCountRequest): StartedCount
    @POST("api/stock/mobile-count/save") suspend fun saveCount(@Body request: SaveCountRequest): SavedCount
    @POST("api/stock/mobile-count/cancel") suspend fun cancelCount(@Body request: SessionRequest): CancelledCount
    @GET("api/stock/mobile-reposition") suspend fun repositions(): Repositions
    @POST("api/stock/mobile-reposition/receive") suspend fun receive(@Body request: ReceiveRequest): Received
    @GET("api/purchasing/local-purchases/withdrawals") suspend fun withdrawals(): Withdrawals
    @GET("api/purchasing/local-purchases/context") suspend fun purchaseContext(): PurchaseContext
    @Multipart @POST("api/financial/inbox/mobile-upload") suspend fun upload(@PartMap fields: Map<String, @JvmSuppressWildcards RequestBody>, @Part documents: List<MultipartBody.Part>, @Header("X-Coala-Local-Owner") expectedOwner: String? = null): UploadResponse
    @POST("api/purchasing/local-purchases/confirm") suspend fun confirm(@Body request: ConfirmPurchase): PurchaseResponse
    @POST("api/purchasing/local-purchases/link-withdrawal") suspend fun link(@Body request: LinkWithdrawal): PurchaseResponse
    @POST("api/financial/inbox/mobile-upload/cancel") suspend fun cancelUpload(@Body request: CancelUpload): CancelUploadResponse
    @GET("api/dp/mobile-schedule") suspend fun schedule(@Query("year") year: Int, @Query("month") month: Int): MonthSchedule
    @GET("api/goals/mobile") suspend fun goalUnits(): GoalUnits
    @GET("api/goals/mobile") suspend fun goals(@Query("kioskId") kioskId: String): UnitGoals
    @GET("api/goals/mobile?scope=all") suspend fun goalsOverview(): GoalsOverview
    @GET("api/signage/mobile") suspend fun signage(): SignageUnits
    @POST("api/signage/mobile/screens") suspend fun pair(@Body request: PairScreen): PairResponse
    // Ponto and Solicitações reuse the web routes; the punch goes out as channel "mobile" (AFD collector 01).
    @GET("api/dp/time-recording/options") suspend fun timeOptions(@Query("workDate") workDate: String): TimeOptions
    @POST("api/dp/time-recording/offline-permits") suspend fun offlinePermit(@Body request: OfflinePermitRequest, @Header("X-Coala-Local-Owner") expectedOwner: String? = null): OfflinePermitResponse
    @POST("api/dp/time-recording/offline-cycles") suspend fun offlineCycle(@Body request: OfflineCycleAction, @Header("X-Coala-Local-Owner") expectedOwner: String? = null): OfflineCycleResponse
    @POST("api/dp/time-recording/markings") suspend fun mark(@Body request: MarkingRequest, @Header("X-Coala-Local-Owner") expectedOwner: String? = null): MarkingResponse
    @PATCH("api/dp/time-recording/markings/{receiptId}/classification") suspend fun classifyMarking(@Path("receiptId") receiptId: String, @Body request: ClassificationUpdate): ClassificationResult
    @GET("api/dp/time-recording/markings") suspend fun markings(@Query("startDate") startDate: String, @Query("endDate") endDate: String): OwnMarkings
    @GET("api/dp/time-recording/month") suspend fun timeMonth(@Query("month") month: String): OwnMonth
    @POST("api/dp/time-recording/journey-location") suspend fun journeyLocation(@Body request: JourneyLocationBatch): JourneyLocationAccepted
    @POST("api/dp/time-recording/journey-location/lease") suspend fun journeyLocationLease(@Body request: JourneyLocationLeaseRequest): JourneyLocationLease
    @Streaming @GET("api/dp/time-recording/receipts/{receiptId}") suspend fun receipt(@Path("receiptId") receiptId: String): ResponseBody
    @Streaming @GET("api/dp/time-recording/receipts/export") suspend fun receiptArchive(@Query("startDate") startDate: String, @Query("endDate") endDate: String): ResponseBody
    @GET("api/dp/time-recording/adjustments") suspend fun adjustments(@Query("month") month: String): OwnAdjustments
    @POST("api/dp/time-recording/adjustments") suspend fun requestAdjustment(@Body request: AdjustmentRequest): AdjustmentCreated
    @GET("api/dp/time-recording/time-bank") suspend fun timeBank(@Query("date") date: String): TimeBankResponse
    @GET("api/dp/time-recording/mirrors") suspend fun mirror(@Query("competence") competence: String): MirrorStatus
    @POST("api/dp/time-recording/mirrors") suspend fun generateMirror(@Body request: MirrorGenerateRequest): MirrorGenerated
    @Streaming @GET("api/dp/time-recording/mirrors/pdf") suspend fun mirrorPdf(@Query("competence") competence: String): ResponseBody
    @GET("api/collaborator/absence-requests/options") suspend fun absenceOptions(): AbsenceOptions
    @POST("api/collaborator/absence-requests/preview") suspend fun absencePreview(@Body request: AbsencePeriod): AbsencePreviewResponse
    @Multipart @POST("api/collaborator/absence-requests/preparations") suspend fun prepareAbsence(@Part("proposedRequestId") proposedRequestId: RequestBody, @Part files: List<MultipartBody.Part>): AbsencePreparation
    @POST("api/collaborator/absence-requests") suspend fun createAbsence(@Body request: AbsenceDraftRequest): AbsenceRequestEnvelope
    @PATCH("api/collaborator/absence-requests/{requestId}") suspend fun submitAbsence(@Path("requestId") requestId: String, @Body request: AbsenceSubmit): AbsenceRequestEnvelope
    @GET("api/collaborator/absence-requests?scope=mine&limit=25") suspend fun absences(): AbsenceRequests
    @GET("api/collaborator/requests?scope=own") suspend fun vouchers(): VoucherRequests
    @POST("api/collaborator/requests") suspend fun requestVoucher(@Body request: VoucherRequestCreate): VoucherCreated
    @GET("api/collaborator/requests/shift-swaps/options") suspend fun shiftSwapOptions(): ShiftSwapOptions
    @GET("api/collaborator/requests/shift-swaps") suspend fun shiftSwaps(): ShiftSwapRequests
    @POST("api/collaborator/requests/shift-swaps") suspend fun requestShiftSwap(@Body request: ShiftSwapCreate): ShiftSwapCreated
    @PATCH("api/collaborator/requests/shift-swaps/{requestId}") suspend fun decideShiftSwap(@Path("requestId") requestId: String, @Body request: ShiftSwapDecision): ShiftSwapCreated
}
