package com.coalaone.go.auth

import javax.inject.Inject
import javax.inject.Singleton

@Singleton class RuntimeMode @Inject constructor(private val auth: AuthGateway) {
    var simulation = false
        private set
    fun simulate() { check(com.coalaone.go.BuildConfig.DEBUG); simulation = true }
    fun reset() { simulation = false }
    fun identity() = if (simulation) Identity("simulation", "simulation@invalid.local") else auth.current ?: error("Entre novamente.")
}
