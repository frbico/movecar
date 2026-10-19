package com.example.movecarvoice

import android.app.*
import android.content.Intent
import android.media.RingtoneManager
import android.media.AudioAttributes
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

class CarMessagingService : FirebaseMessagingService() {
    companion object {
        const val CHANNEL = "movecar_voice_calls_v3"
        const val NOTIFICATION_ID = 1001
        const val TEST_NOTIFICATION_ID = 1003
        fun ensureIncomingCallChannel(context: android.content.Context) {
            val nm=context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL, "挪车语音来电（响铃与亮屏）", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description="扫码者发起的匿名语音呼叫"
                enableVibration(true)
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
                lockscreenVisibility=Notification.VISIBILITY_PUBLIC
            })
        }
        fun postIncomingNotification(context:android.content.Context,callId:String,testing:Boolean=false) {
        val nm = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureIncomingCallChannel(context)
        // Android notification-channel importance is immutable. Never override
        // a user-disabled channel, but do expose its state in the APP settings.
        // Android 14+ may require the user to grant full-screen call notification
        // permission. No background activity launch: use the OS call notification.
        val fullScreenAllowed = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()
        context.getSharedPreferences("movecar_call_health",android.content.Context.MODE_PRIVATE)
            .edit().putLong("lastReceivedAt",System.currentTimeMillis())
            .putBoolean("lastFullScreenAllowed",fullScreenAllowed)
            .putBoolean("lastNotificationsEnabled",nm.areNotificationsEnabled())
            .putInt("lastChannelImportance",nm.getNotificationChannel(CHANNEL)?.importance?:0)
            .apply()
        Log.i("MoveCarIncoming","Posted "+(if(testing)"test" else "FCM")+
            " incoming call; fullScreen="+fullScreenAllowed)
        val intent = Intent(context, IncomingCallActivity::class.java).apply {
            action = "com.example.movecarvoice.INCOMING_VOICE"
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("callId", callId)
            putExtra("testIncoming",testing)
        }
        val view = PendingIntent.getActivity(context, if(testing)21 else 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val answer = PendingIntent.getActivity(context, if(testing)22 else 2, Intent(intent).putExtra("answer", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val decline = PendingIntent.getBroadcast(context, if(testing)23 else 3, Intent(context, CallActionReceiver::class.java).putExtra("callId", callId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(if(testing)"锁屏来电显示测试" else "有人请求挪车")
            .setContentText(if(testing)"仅测试来电界面和屏幕唤醒" else "扫码者正在呼叫车主，点击接听")
            .setCategory(Notification.CATEGORY_CALL)
            .setPriority(Notification.PRIORITY_HIGH)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            // Clear a missed-call notification automatically; the server stops ringing at 35s.
            .setTimeoutAfter(if(testing) 20_000L else 35_000L)
            .setOngoing(false)
            .setContentIntent(view)
            .setFullScreenIntent(view, true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
        if (Build.VERSION.SDK_INT >= 31) {
            val person = android.app.Person.Builder().setName("挪车语音呼叫").setImportant(true).build()
            builder.setStyle(Notification.CallStyle.forIncomingCall(person, decline, answer))
        } else {
            builder.addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "拒绝", decline).build())
            builder.addAction(Notification.Action.Builder(android.R.drawable.sym_action_call, "接听", answer).build())
        }
        try {
            nm.notify(if(testing) TEST_NOTIFICATION_ID else NOTIFICATION_ID, builder.build())
            // Strictly gated by the user's full-screen call entitlement; a
            // short timeout gives Samsung/One UI a chance to wake the display
            // before Android starts the full-screen incoming-call Activity.
            if (fullScreenAllowed && nm.areNotificationsEnabled() &&
                nm.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_HIGH) {
                val power = context.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
                if (!power.isInteractive) {
                    @Suppress("DEPRECATION")
                    val wake = power.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                        "MoveCar:IncomingCallScreen")
                    // Never hold it for the entire ringing interval.
                    wake.acquire(3500L)
                }
            }
        } catch (e: SecurityException) {
            Log.w("MoveCarCalls","Notification or wake-up permission denied",e)
        }
        }
        fun cancel(context: android.content.Context) {
            (context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
        }
    }
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val base = VoiceApi.base(this)
        val login = VoiceApi.mobileAuth(this)
        if (base.isNotBlank() && login.isNotBlank()) {
            Thread {
                runCatching {
                    VoiceApi.post(base, "/api/mobile/device", JSONObject().put("fcmToken", token), login)
                }.onSuccess { data ->
                    VoiceApi.prefs(this).edit().putString("auth", data.optString("deviceAuth")).apply()
                }
            }.start()
        } else {
            val oldAuth = VoiceApi.auth(this)
            if (base.isNotBlank() && oldAuth.isNotBlank()) {
                Thread { runCatching { VoiceApi.post(base, "/api/voice/device/token", JSONObject().put("fcmToken", token), oldAuth) } }.start()
            }
        }
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["type"] == "move_request") {
            showParkingAlert(message)
            return
        }
        if (message.data["type"] != "incoming_call") return
        val callId = message.data["callId"] ?: return
        if (!VoiceApi.validCallId(callId) || VoiceApi.auth(this).isBlank()) return
        postIncomingNotification(this,callId)
    }
    private fun showParkingAlert(message: RemoteMessage) {
        if (VoiceApi.mobileAuth(this).isBlank()) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val channel = "movecar_parking_alerts"
        nm.createNotificationChannel(NotificationChannel(
            channel, "挪车留言通知", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "路人扫码发送的挪车留言、照片和重要通知"
            enableVibration(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        })
        val title = message.data["title"]?.take(90) ?: "有人请求挪车"
        val text = message.data["message"]?.take(1000) ?: "点击查看挪车请求"
        val view = PendingIntent.getActivity(this, 11,
            Intent(this, MainActivity::class.java).apply {
                putExtra("openPage","requests")
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(view)
            .build()
        try { nm.notify((System.currentTimeMillis() % 2000000000).toInt(), notification) }
        catch (_: SecurityException) { /* notification permission disabled */ }
    }
}
