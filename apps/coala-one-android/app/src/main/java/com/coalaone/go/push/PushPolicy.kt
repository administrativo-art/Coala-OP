package com.coalaone.go.push

import java.net.URI
import java.security.MessageDigest
import java.util.UUID

object PushPolicy {
    fun eventKey(owner: String, eventId: String): String = MessageDigest.getInstance("SHA-256")
        .digest("${owner.length}:$owner:$eventId".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    fun requiresSystemSettings(apiLevel: Int, permitted: Boolean, permissionRequested: Boolean): Boolean =
        !permitted && (apiLevel < 33 || permissionRequested)

    fun safePath(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val uri = try { URI(url) } catch (_: Exception) { return null }
        if (uri.scheme != "https" || uri.host != "op.coalashakes.com" || uri.port != -1 || uri.rawQuery != null || uri.rawFragment != null || uri.userInfo != null) return null
        val path = uri.rawPath ?: return null
        if (path.contains('%') || path.contains('\\') || path.startsWith("//")) return null
        return path.takeIf { Regex("^/dashboard(?:/collaborator(?:/requests(?:/[A-Za-z0-9_-]+)?)?|/dp(?:/(?:collaborators|requests)(?:/[A-Za-z0-9_-]+)?)?)?$").matches(it) }
    }
    fun accept(data: Map<String, String>, owner: String?, optedIn: Boolean, permitted: Boolean, seen: Set<String>): Boolean {
        val event = data["eventId"] ?: return false
        return optedIn && permitted && !owner.isNullOrBlank() && owner == data["recipientId"]
            && runCatching { UUID.fromString(event) }.isSuccess && event !in seen
            && safePath(data["path"]) != null
    }
}
