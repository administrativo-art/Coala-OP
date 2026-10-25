package com.coalaone.go.offline

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "time_offline_permits")
data class TimePermitRow(@PrimaryKey val owner: String, val permitId: String, val expiresAt: Long, val sealed: ByteArray)

@Entity(tableName = "time_offline_markings", primaryKeys = ["owner", "id"],
    indices = [Index(value = ["owner", "permitId", "sequence"], unique = true)])
data class TimeMarkingRow(val owner: String, val id: String, val permitId: String, val sequence: Int,
    val createdAt: Long, val state: String = "READY", val error: String? = null, val sealed: ByteArray)

@Dao interface TimeOfflineDao {
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner AND state != 'CONFIRMED' ORDER BY createdAt, sequence")
    fun observe(owner: String): Flow<List<TimeMarkingRow>>
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner ORDER BY createdAt, sequence")
    suspend fun list(owner: String): List<TimeMarkingRow>
    @Query("SELECT * FROM time_offline_markings WHERE owner = :owner AND permitId = :permitId ORDER BY sequence")
    suspend fun listPermit(owner: String, permitId: String): List<TimeMarkingRow>
    @Query("SELECT COUNT(*) FROM time_offline_markings WHERE owner = :owner AND state != 'CONFIRMED'")
    suspend fun pendingCount(owner: String): Int
    @Insert(onConflict = OnConflictStrategy.ABORT) suspend fun insert(row: TimeMarkingRow)
    @Query("UPDATE time_offline_markings SET state = :state, error = :error WHERE owner = :owner AND id = :id")
    suspend fun state(owner: String, id: String, state: String, error: String? = null)
    @Query("DELETE FROM time_offline_markings WHERE owner = :owner AND state = 'CONFIRMED' AND permitId != :currentPermitId")
    suspend fun removeOldConfirmed(owner: String, currentPermitId: String)
    @Query("SELECT * FROM time_offline_permits WHERE owner = :owner") suspend fun permit(owner: String): TimePermitRow?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun permit(row: TimePermitRow)
}

@Database(entities = [TimePermitRow::class, TimeMarkingRow::class], version = 1, exportSchema = true)
abstract class TimeOfflineDatabase : RoomDatabase() { abstract fun timeOffline(): TimeOfflineDao }
