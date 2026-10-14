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
    @Provides @Singleton fun queue(store: QueueStore): UploadQueue = store
    @Provides @Singleton fun drafts(store: DraftStore): CountDraftStore = store
    @Provides @Singleton fun scheduler(scheduler: QueueScheduler): WorkScheduler = scheduler
}
