package com.coalaone.go.offline

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "time_offline_permits")
data class TimePermitRow(@PrimaryKey val owner: String, val permitId: String, val expiresAt: Long, val sealed: ByteArray)

@Entity(tableName = "time_offline_cycles")
data class TimeCycleRow(@PrimaryKey val owner: String, val cycleId: String, val sealed: ByteArray)

@Entity(tableName = "time_offline_markings", primaryKeys = ["owner", "id"],
    indices = [Index(value = ["owner", "permitId", "sequence"], unique = true)])
data class TimeMarkingRow(val owner: String, val id: String, val permitId: String, val sequence: Int,
    val createdAt: Long, val state: String = "READY", val error: String? = null, val sealed: ByteArray)

@Dao interface TimeOfflineDao {
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner AND state != 'CONFIRMED' ORDER BY createdAt, sequence")
    fun observe(owner: String): Flow<List<TimeMarkingRow>>
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner ORDER BY rowid")
    suspend fun list(owner: String): List<TimeMarkingRow>
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner AND permitId = :permitId ORDER BY sequence")
    suspend fun listPermit(owner: String, permitId: String): List<TimeMarkingRow>
    @Query("SELECT COUNT(*) FROM time_offline_markings WHERE owner = :owner AND state != 'CONFIRMED'")
    suspend fun pendingCount(owner: String): Int
    @Query("SELECT COUNT(*) FROM time_offline_markings WHERE owner = :owner AND state != 'CONFIRMED' AND sequence = 0")
    suspend fun onlinePendingCount(owner: String): Int
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(row: TimeMarkingRow)
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner AND id = :id") suspend fun marking(owner: String, id: String): TimeMarkingRow?
    @Query("DELETE FROM time_offline_markings WHERE owner = :owner AND id = :id AND sequence = 0 AND state != 'CONFIRMED'") suspend fun discardUnrecordedOnline(owner: String, id: String)
    @Query("UPDATE time_offline_markings SET state = :state, error = :error WHERE owner = :owner AND id = :id")
    suspend fun state(owner: String, id: String, state: String, error: String? = null)
    @Query("DELETE FROM time_offline_markings WHERE owner = :owner AND state = 'CONFIRMED' AND permitId != :currentPermitId")
    suspend fun removeOldConfirmed(owner: String, currentPermitId: String)
    @Query("SELECT * FROM time_offline_permits WHERE owner = :owner") suspend fun permit(owner: String): TimePermitRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun permit(row: TimePermitRow)
    @Query("SELECT * FROM time_offline_cycles WHERE owner = :owner") suspend fun cycle(owner: String): TimeCycleRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun cycle(row: TimeCycleRow)
    @Query("DELETE FROM time_offline_cycles WHERE owner = :owner") suspend fun clearCycle(owner: String)
}

@Database(entities = [TimePermitRow::class, TimeMarkingRow::class, TimeCycleRow::class], version = 2, exportSchema = true)
abstract class TimeOfflineDatabase : RoomDatabase() {
    abstract fun timeOffline(): TimeOfflineDao
    companion object {
        val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `time_offline_cycles` (`owner` TEXT NOT NULL, `cycleId` TEXT NOT NULL, `sealed` BLOB NOT NULL, PRIMARY KEY(`owner`))")
            }
        }
    }
}
