package com.coalaone.go.offline

import com.coalaone.go.auth.AuthGateway
import com.coalaone.go.data.Errors
import com.coalaone.go.data.MobileRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

@Singleton class QueueSync @Inject constructor(private val auth: AuthGateway, private val queue: UploadQueue, private val repository: MobileRepository) {
    private val mutex = Mutex()
    suspend fun sync(uid: String): Boolean = mutex.withLock {
        if (auth.current?.uid != uid) return@withLock false
        var retry = false
        for (row in queue.list(uid).filter { it.state == "READY" }) {
            if (auth.current?.uid != uid) return@withLock false
            try {
                val payload = queue.payload(uid, row.id)
                if (auth.current?.uid != uid) return@withLock false
                val response = repository.upload(payload, uid)
                // Never attach an acknowledgement to a different logged-in owner.
                queue.markUploaded(uid, row.id, response)
            } catch (cause: kotlinx.coroutines.CancellationException) {
                throw cause
            } catch (cause: Exception) {
                val failure = Errors.classify(cause)
                queue.markFailed(uid, row.id, failure)
                retry = retry || failure.retryable
            }
        }
        !retry
    }
}
