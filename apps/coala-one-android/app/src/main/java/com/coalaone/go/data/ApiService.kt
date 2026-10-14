package com.coalaone.go.data

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.*

interface ApiService {
    @GET("api/app/version?packageName=coalaone.go") suspend fun release(): Release
    @POST("api/auth/forgot-password") suspend fun reset(@Body request: ResetRequest)
    @GET("api/mobile/profile") suspend fun profile(): ProfileResponse
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
    @GET("api/dp/mobile-schedule") suspend fun schedule(@Query("year") year: Int, @Query("month") month: Int): MonthSchedule
    @GET("api/goals/mobile") suspend fun goalUnits(): GoalUnits
    @GET("api/goals/mobile") suspend fun goals(@Query("kioskId") kioskId: String): UnitGoals
    @GET("api/goals/mobile?scope=all") suspend fun goalsOverview(): GoalsOverview
    @GET("api/signage/mobile") suspend fun signage(): SignageUnits
    @POST("api/signage/mobile/screens") suspend fun pair(@Body request: PairScreen): PairResponse
}
