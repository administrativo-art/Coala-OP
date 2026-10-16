package com.coalaone.go.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.coalaone.go.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint class CoalaMessagingService : FirebaseMessagingService() {
    @Inject lateinit var push: PushManager
    override fun onNewToken(token: String) { push.onNewToken() }
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.notification != null) return
        val data = message.data
        if (!PushPolicy.accept(data, push.currentAuthenticatedOwner, push.optedIn, push.permissionGranted(), emptySet())) return
        val eventId = data["eventId"] ?: return
        if (push.seen(eventId)) return
        val path = PushPolicy.safePath(data["path"]) ?: return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("coala_updates", "Atualizações do Coala", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://op.coalashakes.com$path"))
        val pending = PendingIntent.getActivity(this, eventId.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, "coala_updates")
            .setSmallIcon(R.drawable.coala_icon)
            .setContentTitle("Coala Go")
            .setContentText("Você tem uma atualização no Coala.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true).setContentIntent(pending).build()
        manager.notify(eventId.hashCode(), notification)
    }
}
