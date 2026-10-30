package com.coalaone.go.data

import kotlinx.serialization.Serializable

@Serializable data class GoogleMigrationStatus(
    val available: Boolean = false,
    val required: Boolean = false,
    val currentEmail: String? = null,
    val targetEmail: String? = null,
    val completed: Boolean = false,
    val provider: String? = null,
    val accountKind: String? = null,
)
@Serializable data class GoogleMigrationRequest(val googleIdToken: String)
@Serializable data class GoogleMigrationResult(val migrated: Boolean, val uid: String, val email: String, val provider: String)
