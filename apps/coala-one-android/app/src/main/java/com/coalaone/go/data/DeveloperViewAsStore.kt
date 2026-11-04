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

/**
 * "Ver como" vale só enquanto o app está aberto: a escolha fica na memória do processo e não é gravada. Ao fechar o app,
 * a próxima abertura volta ao perfil original sozinha. O valor que versões anteriores gravaram é apagado na criação.
 */
@Singleton class DeveloperViewAsStore @Inject constructor(@ApplicationContext context: Context) : DeveloperViewAsSelectionStore {
    @Volatile private var targetUserId: String? = null

    init { context.getSharedPreferences("developer-view-as", Context.MODE_PRIVATE).edit().clear().apply() }

    override fun current() = targetUserId
    override fun select(userId: String) {
        require(userId.isNotBlank() && !userId.contains('/')) { "Usuário inválido." }
        targetUserId = userId
    }
    override fun clear() { targetUserId = null }
}
