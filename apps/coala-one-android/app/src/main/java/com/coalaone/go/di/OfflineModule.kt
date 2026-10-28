package com.coalaone.go.di

import android.content.Context
import androidx.room.Room
import com.coalaone.go.offline.*
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module @InstallIn(SingletonComponent::class) object OfflineModule {
    @Provides @Singleton fun database(@ApplicationContext context: Context) = Room.databaseBuilder(context, QueueDatabase::class.java, "coala-go-queue.db").build()
    @Provides @Singleton fun timeOfflineDatabase(@ApplicationContext context: Context) =
        Room.databaseBuilder(context, TimeOfflineDatabase::class.java, "coala-go-time-offline.db")
            .addMigrations(TimeOfflineDatabase.MIGRATION_1_2).build()
    @Provides @Singleton fun queue(store: QueueStore): UploadQueue = store
    @Provides @Singleton fun timeOfflineQueue(store: TimeOfflineStore): TimeOfflineQueue = store
    @Provides @Singleton fun drafts(store: DraftStore): CountDraftStore = store
    @Provides @Singleton fun scheduler(scheduler: QueueScheduler): WorkScheduler = scheduler
    @Provides @Singleton fun timeOfflineScheduler(scheduler: TimeOfflineScheduler): TimeOfflineWorkScheduler = scheduler
}
