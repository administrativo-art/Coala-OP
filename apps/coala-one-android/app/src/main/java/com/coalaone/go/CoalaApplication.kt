package com.coalaone.go

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp class CoalaApplication : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    override fun onCreate() {
        super.onCreate()
        val options = FirebaseOptions.Builder()
            .setApiKey(BuildConfig.FIREBASE_API_KEY.ifBlank { "unconfigured-public-api-key" })
            .setApplicationId(BuildConfig.FIREBASE_APP_ID.ifBlank { "1:000000000:android:unconfigured" })
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID.ifBlank { "demo-coala-go" })
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID.ifBlank { "000000000" })
            .build()
        if (FirebaseApp.getApps(this).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
            FirebaseApp.initializeApp(this, options)
        }
        if (BuildConfig.FIREBASE_SENDER_ID.isNotBlank() && !BuildConfig.LOCAL_TEST) {
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
        }
    }
    override val workManagerConfiguration get() = Configuration.Builder().setWorkerFactory(workerFactory).build()
}
