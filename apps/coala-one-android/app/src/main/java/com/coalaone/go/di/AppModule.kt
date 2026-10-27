package com.coalaone.go.di

import android.content.Context
import com.coalaone.go.BuildConfig
import com.coalaone.go.auth.*
import com.coalaone.go.data.*
import com.coalaone.go.push.PushController
import com.coalaone.go.push.PushManager
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module @InstallIn(SingletonComponent::class) object AppModule {
    @Provides @Singleton fun json() = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true }
    @Provides @Singleton fun firebase(@ApplicationContext context: Context): FirebaseAuth {
        // No credentials are bundled. Empty config keeps the debug simulation usable.
        val app = FirebaseApp.getInstance()
        return FirebaseAuth.getInstance(app).also { if (BuildConfig.LOCAL_TEST) it.useEmulator("10.0.2.2", 9099) }
    }
    @Provides @Singleton fun auth(gateway: FirebaseGateway): AuthGateway = gateway
    @Provides @Singleton fun biometrics(store: BiometricStore): BiometricPreferences = store
    @Provides @Singleton fun attestation(impl: Attestation): AppAttestation = impl
    @Provides @Singleton fun updater(impl: AppUpdater): InstallerDownloader = impl
    @Provides @Singleton fun push(impl: PushManager): PushController = impl
    @Provides @Singleton fun developerViewAsStore(store: DeveloperViewAsStore): DeveloperViewAsSelectionStore = store
    @Provides @Singleton fun client(auth: AuthGateway, attestation: Attestation, viewAs: DeveloperViewAsSelectionStore): OkHttpClient {
        val base = BuildConfig.API_BASE_URL.toHttpUrl()
        require(base.isHttps || BuildConfig.DEBUG && BuildConfig.LOCAL_TEST) { "API de release exige HTTPS" }
        return OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(150, TimeUnit.SECONDS).writeTimeout(150, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).addInterceptor(AuthenticationInterceptor(base, viewAs::current) {
            val uid = auth.current?.uid
            if (uid == null) null else {
                val token = auth.token(); val proof = attestation.token()
                if (auth.current?.uid != uid) throw AppFailure(ErrorCategory.AUTHENTICATION, false, "A conta mudou. Tente novamente.")
                ApiCredentials(uid, token, proof, attestation.currentFailure())
            }
        }).build()
    }
    @Provides @Singleton fun api(client: OkHttpClient, json: Json): ApiService = Retrofit.Builder().baseUrl(BuildConfig.API_BASE_URL.trimEnd('/') + "/").client(client).addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(ApiService::class.java)
    @Provides @Singleton fun repository(repository: ApiRepository): MobileRepository = repository
    @Provides @Singleton fun images(@ApplicationContext context: Context, client: OkHttpClient): coil3.ImageLoader = coil3.ImageLoader.Builder(context).components { add(coil3.network.okhttp.OkHttpNetworkFetcherFactory(callFactory = { client })) }.diskCache(null).build()
}
