package com.coalaone.go.data

import kotlinx.serialization.Serializable

@Serializable data class CorporateDeviceRequest(
    val installationId: String, val deviceKeyId: String, val devicePublicKey: String,
    val keySecurity: String, val appVersion: String, val model: String, val androidVersion: String,
)
@Serializable data class CorporateDeviceSummary(
    val id: String, val ownerUid: String, val status: String, val model: String,
    val androidVersion: String, val appVersion: String, val keySecurity: String,
    val requestedAt: String? = null, val approvedAt: String? = null,
    val updatedAt: String? = null, val lastSeenAt: String? = null,
)
@Serializable data class CorporateDeviceStatus(val device: CorporateDeviceSummary? = null, val autoEnrollAllowed: Boolean = false,
    val reviewRequired: Boolean = false)
@Serializable data class CorporateDeviceRequested(val deviceId: String, val status: String)
