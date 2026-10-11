package com.coalaone.go.auth

import javax.inject.Inject
import javax.inject.Singleton

@Singleton class SessionGate @Inject constructor() {
    @Volatile private var unlockedUid: String? = null
    @Volatile private var unlockedAt: Long = 0
    fun unlock(uid: String) { unlockedUid = uid; unlockedAt = System.currentTimeMillis() }
    fun lock() { unlockedUid = null; unlockedAt = 0 }
    fun permits(uid: String) = unlockedUid == uid && System.currentTimeMillis() - unlockedAt < 7 * 86_400_000L
}
