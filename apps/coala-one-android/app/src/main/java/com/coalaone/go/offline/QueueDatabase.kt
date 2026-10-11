package com.coalaone.go.offline

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "pending", primaryKeys = ["owner", "id"])
data class QueueRow(val owner: String, val id: String, val createdAt: Long, val state: String = "READY", val retryCount: Int = 0, val error: String? = null, val acknowledgement: ByteArray? = null)
@Dao interface QueueDao {
    @Query("SELECT * FROM pending WHERE owner = :owner AND state != 'CONFIRMED' ORDER BY createdAt") fun observe(owner: String): Flow<List<QueueRow>>
    @Query("SELECT * FROM pending WHERE owner = :owner AND state != 'CONFIRMED' ORDER BY createdAt") suspend fun list(owner: String): List<QueueRow>
    @Query("SELECT * FROM pending WHERE owner = :owner AND id = :id") suspend fun get(owner: String, id: String): QueueRow?
    @Query("SELECT COUNT(*) FROM pending WHERE state != 'CONFIRMED'") suspend fun total(): Int
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insert(row: QueueRow): Long
    @Query("UPDATE pending SET state = 'UPLOADED', acknowledgement = :ack, error = NULL WHERE owner = :owner AND id = :id") suspend fun acknowledge(owner: String, id: String, ack: ByteArray)
    @Query("UPDATE pending SET retryCount = retryCount + 1, error = :error, state = :state WHERE owner = :owner AND id = :id") suspend fun failed(owner: String, id: String, error: String, state: String)
    @Query("UPDATE pending SET state = 'CONFIRMED', acknowledgement = NULL, error = NULL WHERE owner = :owner AND id = :id AND state = 'UPLOADED'") suspend fun removeConfirmed(owner: String, id: String): Int
    @Query("UPDATE pending SET state = 'READY', error = NULL WHERE owner = :owner AND id = :id AND state = 'BLOCKED'") suspend fun retry(owner: String, id: String)
}
@Database(entities = [QueueRow::class], version = 1, exportSchema = true)
abstract class QueueDatabase : RoomDatabase() { abstract fun queue(): QueueDao }
