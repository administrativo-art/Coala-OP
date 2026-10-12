package com.coalaone.go.offline

import android.content.Context
import android.util.AtomicFile
import com.coalaone.go.data.StoredCountDraft
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import javax.inject.Inject

interface CountDraftStore {
    suspend fun load(uid: String, sessionId: String): StoredCountDraft?
    suspend fun save(uid: String, sessionId: String, draft: StoredCountDraft)
    suspend fun clear(uid: String, sessionId: String)
}
class DraftStore @Inject constructor(@ApplicationContext context: Context, private val vault: Vault, private val json: Json) : CountDraftStore {
    private val directory = File(context.noBackupFilesDir, "coala-go-count").apply { mkdirs() }
    private fun file(uid: String, id: String) = File(directory, "${vault.owner(uid)}-${id.replace(Regex("[^a-zA-Z0-9_-]"), "_")}.enc")
    override suspend fun load(uid: String, sessionId: String): StoredCountDraft? = withContext(Dispatchers.IO) {
        val stored = file(uid, sessionId)
        if (!stored.exists()) null else json.decodeFromString<StoredCountDraft>(vault.open(uid, "count:$sessionId", stored.readBytes()).decodeToString())
    }
    override suspend fun save(uid: String, sessionId: String, draft: StoredCountDraft) = withContext(Dispatchers.IO) {
        val atomic = AtomicFile(file(uid, sessionId)); val stream = atomic.startWrite()
        try { stream.write(vault.seal(uid, "count:$sessionId", json.encodeToString(draft).toByteArray())); atomic.finishWrite(stream) }
        catch (cause: Exception) { atomic.failWrite(stream); throw cause }
    }
    override suspend fun clear(uid: String, sessionId: String) { withContext(Dispatchers.IO) { file(uid, sessionId).delete() } }
}
