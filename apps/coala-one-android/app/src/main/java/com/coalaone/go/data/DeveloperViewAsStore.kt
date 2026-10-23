package com.coalaone.go.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

const val DEVELOPER_VIEW_AS_EMAIL = "administrativo@coalashakes.com"
const val DEVELOPER_VIEW_AS_HEADER = "X-Coala-View-As"

interface DeveloperViewAsSelectionStore {
    fun current(): String?
    fun select(userId: String)
    fun clear()
}

class InMemoryDeveloperViewAsStore : DeveloperViewAsSelectionStore {
    private var targetUserId: String? = null
    override fun current() = targetUserId
    override fun select(userId: String) { targetUserId = userId }
    override fun clear() { targetUserId = null }
}

@Singleton class DeveloperViewAsStore @Inject constructor(@ApplicationContext context: Context) : DeveloperViewAsSelectionStore {
    private val preferences = context.getSharedPreferences("developer-view-as", Context.MODE_PRIVATE)

    override fun current() = preferences.getString("targetUserId", null)
    override fun select(userId: String) {
        require(userId.isNotBlank() && !userId.contains('/')) { "Usuário inválido." }
        preferences.edit().putString("targetUserId", userId).apply()
    }
    override fun clear() {
        preferences.edit().remove("targetUserId").apply()
    }
}
