package com.coalaone.go

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coalaone.go.offline.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** No account, network or hardware-key substitution: only the real Room migration and transactions. */
@RunWith(AndroidJUnit4::class)
class TimeOfflineMigrationInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private fun database(name: String) = Room.databaseBuilder(context, TimeOfflineDatabase::class.java, name)
        .addMigrations(TimeOfflineDatabase.MIGRATION_1_2).build()

    private inline fun <T> withDatabase(name: String, block: (TimeOfflineDatabase) -> T): T {
        val db = database(name)
        return try { block(db) } finally { db.close() }
    }
    @Test fun migrationKeepsEveryLegacyCiphertextAndAddsDurableCycleState() = runBlocking<Unit> {
        val name = "demo-cycle-migration-${UUID.randomUUID()}.db"
        val path = context.getDatabasePath(name).also { it.parentFile!!.mkdirs() }
        val cipher = byteArrayOf(1, 12, 7, 8, 9, 10)
        SQLiteDatabase.openOrCreateDatabase(path, null).use { old ->
            old.execSQL("CREATE TABLE time_offline_permits (owner TEXT NOT NULL, permitId TEXT NOT NULL, expiresAt INTEGER NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY(owner))")
            old.execSQL("CREATE TABLE time_offline_markings (owner TEXT NOT NULL, id TEXT NOT NULL, permitId TEXT NOT NULL, sequence INTEGER NOT NULL, createdAt INTEGER NOT NULL, state TEXT NOT NULL, error TEXT, sealed BLOB NOT NULL, PRIMARY KEY(owner,id))")
            old.execSQL("CREATE UNIQUE INDEX index_time_offline_markings_owner_permitId_sequence ON time_offline_markings(owner,permitId,sequence)")
            old.execSQL("INSERT INTO time_offline_permits VALUES (?,?,?,?)", arrayOf("owner", "legacy-permit", 100L, cipher))
            old.execSQL("INSERT INTO time_offline_markings VALUES (?,?,?,?,?,?,?,?)", arrayOf("owner", "legacy-first", "legacy-permit", 1, 100L, "READY", null, cipher))
            old.execSQL("INSERT INTO time_offline_markings VALUES (?,?,?,?,?,?,?,?)", arrayOf("owner", "legacy-blocked", "legacy-permit", 2, 50L, "BLOCKED", "retained", cipher))
            old.version = 1
        }
        try {
            withDatabase(name) { db ->
                val rows = db.timeOffline().list("owner")
                assertEquals(listOf("legacy-first", "legacy-blocked"), rows.map { it.id })
                assertEquals(listOf("READY", "BLOCKED"), rows.map { it.state })
                assertArrayEquals(cipher, rows[0].sealed)
                assertArrayEquals(cipher, db.timeOffline().permit("owner")!!.sealed)
                db.timeOffline().cycle(TimeCycleRow("owner", "cycle-v2", cipher))
            }
            withDatabase(name) { reopened ->
                assertEquals(2, reopened.timeOffline().pendingCount("owner"))
                assertEquals("cycle-v2", reopened.timeOffline().cycle("owner")!!.cycleId)
                assertArrayEquals(cipher, reopened.timeOffline().cycle("owner")!!.sealed)
            }
        } finally { context.deleteDatabase(name) }
    }

    @Test fun cycleAndFirstPendingMarkingCommitOrRollBackTogether() = runBlocking<Unit> {
        val name = "demo-cycle-atomic-${UUID.randomUUID()}.db"
        try {
            withDatabase(name) { db ->
                var failed = false
                try {
                    db.withTransaction {
                        db.timeOffline().cycle(TimeCycleRow("owner", "first", byteArrayOf(1)))
                        db.timeOffline().insert(TimeMarkingRow("owner", "first", "permit", 1, 10, sealed = byteArrayOf(2)))
                        error("synthetic interruption")
                    }
                } catch (_: IllegalStateException) { failed = true }
                assertTrue(failed)
                assertNull(db.timeOffline().cycle("owner"))
                assertEquals(0, db.timeOffline().pendingCount("owner"))
                db.withTransaction {
                    db.timeOffline().cycle(TimeCycleRow("owner", "first", byteArrayOf(1)))
                    db.timeOffline().insert(TimeMarkingRow("owner", "first", "permit", 1, 10, sealed = byteArrayOf(2)))
                }
                assertEquals(1, db.timeOffline().pendingCount("owner"))
                assertEquals("first", db.timeOffline().cycle("owner")!!.cycleId)
                // A pending online original is explicit and prevents silent offline conversion after restart.
                db.timeOffline().insert(TimeMarkingRow("owner", "online", "online:official:online", 0, 1, sealed = byteArrayOf(3)))
                assertEquals(1, db.timeOffline().onlinePendingCount("owner"))
                db.timeOffline().discardUnrecordedOnline("owner", "first")
                assertNotNull(db.timeOffline().marking("owner", "first"))
                db.timeOffline().discardUnrecordedOnline("owner", "online")
                assertEquals(0, db.timeOffline().onlinePendingCount("owner"))
            }
        } finally { context.deleteDatabase(name) }
    }
}
