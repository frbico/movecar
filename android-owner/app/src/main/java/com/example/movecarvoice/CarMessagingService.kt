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
        const val PARKING_CHANNEL = "movecar_parking_alerts"
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
        fun ensureParkingChannel(context: android.content.Context) {
            val nm=context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(
                PARKING_CHANNEL,"挪车留言通知",NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description="路人扫码发送的挪车留言、照片和重要通知"
                enableVibration(true)
                lockscreenVisibility=Notification.VISIBILITY_PRIVATE
            })
        }
        fun postIncomingNotification(context:android.content.Context,callId:String,testing:Boolean=false,issuedAt:Long=0L):Boolean {
        val nm = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureIncomingCallChannel(context)
        // Android notification-channel importance is immutable. Never override
        // a user-disabled channel, but do expose its state in the APP settings.
        // Android 14+ may require the user to grant full-screen call notification
        // permission. No background activity launch: use the OS call notification.
        val fullScreenAllowed = Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()
        val prefs=context.getSharedPreferences("movecar_call_health",android.content.Context.MODE_PRIVATE)
        val receivedAt=System.currentTimeMillis()
        if(!testing) {
            // A previous FCM from the failed call can arrive after a fast retry.
            // Compare server-issued timestamps, not the client's clock offset.
            val previousIssue=prefs.getLong("lastIncomingIssuedAt",0L)
            if(issuedAt>0L && previousIssue>0L && issuedAt<previousIssue){
                Log.i("MoveCarIncoming","Out-of-order FCM call suppressed")
                return false
            }
            // FCM can redeliver one incoming_call. Reposting the same notification
            // after the user rejected/answered it can produce a phantom ring.
            if(prefs.getString("lastIncomingCallId","")==callId &&
                receivedAt-prefs.getLong("lastReceivedAt",0L) in 0L..45000L) {
                Log.i("MoveCarIncoming","Duplicate call notification suppressed")
                return prefs.getLong("lastCallPostedAt",0L)>=prefs.getLong("lastReceivedAt",0L)
            }
            prefs.edit().putLong("lastReceivedAt",receivedAt)
                .putLong("lastIncomingIssuedAt",if(issuedAt>0L)issuedAt else previousIssue)
                .putString("lastIncomingCallId",callId)
                .putBoolean("lastFullScreenAllowed",fullScreenAllowed)
                .putBoolean("lastNotificationsEnabled",nm.areNotificationsEnabled())
                .putInt("lastChannelImportance",nm.getNotificationChannel(CHANNEL)?.importance?:0)
                .apply()
        }else {
            // A local lock-screen simulator is not proof of successful real FCM.
            prefs.edit().putLong("lastTestReceivedAt",receivedAt).apply()
        }
        Log.i("MoveCarIncoming","Posted "+(if(testing)"test" else "FCM")+
            " incoming call; fullScreen="+fullScreenAllowed)
        val intent = Intent(context, IncomingCallActivity::class.java).apply {
            action = "com.example.movecarvoice.INCOMING_VOICE"
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("callId", callId)
            putExtra("testIncoming",testing)
            // Android PendingIntent equality ignores extras. A distinct data URI
            // prevents an old ringing notification's tap from becoming a new call.
            data=android.net.Uri.parse(if(testing)"movecar://test/incoming" else "movecar://call/$callId/incoming")
        }
        val view = PendingIntent.getActivity(context, if(testing)21 else 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val answer = PendingIntent.getActivity(context, if(testing)22 else 2, Intent(intent).apply {
            data=android.net.Uri.parse(if(testing)"movecar://test/answer" else "movecar://call/$callId/answer")
            putExtra("answer",true)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val decline = if(testing)
            PendingIntent.getActivity(context,23,Intent(intent).apply {
                data=android.net.Uri.parse("movecar://test/dismiss")
                putExtra("dismissTest",true)
            },PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        else PendingIntent.getBroadcast(context,3,Intent(context,CallActionReceiver::class.java).apply {
                data=android.net.Uri.parse("movecar://call/$callId/reject")
                putExtra("callId",callId)
            },PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
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
            if(!testing)prefs.edit().putLong("lastCallPostedAt",System.currentTimeMillis()).apply()
            // Strictly gated by the user's full-screen call entitlement; a
            // A short timeout lets the system wake the display before opening the call UI.
            // before Android starts the full-screen incoming-call Activity.
            if (IncomingCallPolicy.mayUseWakeFallback(fullScreenAllowed,
                    nm.areNotificationsEnabled(),nm.getNotificationChannel(CHANNEL)?.importance?:0)) {
                val power = context.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
                if (!power.isInteractive) {
                    @Suppress("DEPRECATION")
                    val wake = power.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                        "MoveCar:IncomingCallScreen")
                    // Never hold it for the entire ringing interval.
                    wake.acquire(3500L)
                    if(!testing)prefs.edit().putLong("lastWakeFallbackAt",System.currentTimeMillis()).apply()
                }
            }
            return true
        } catch (e: SecurityException) {
            if(!testing)prefs.edit().putLong("lastCallPostFailedAt",System.currentTimeMillis()).apply()
            Log.w("MoveCarCalls","Notification or wake-up permission denied",e)
            return false
        }
        }
        fun cancel(context: android.content.Context,expectedCallId:String) {
            // An old notification action must never clear a newer incoming call.
            val prefs=context.getSharedPreferences("movecar_call_health",android.content.Context.MODE_PRIVATE)
            if(prefs.getString("lastIncomingCallId","")!=expectedCallId)return
            (context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
        }
    }
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // A fire-and-forget Thread can be killed when this FCM callback returns.
        // JobScheduler retains the upload and retries when connectivity returns.
        if(VoiceApi.auth(this).isNotBlank())PushBindingJob.schedule(this)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        val kind=message.data["type"]
        val health=getSharedPreferences("movecar_call_health",MODE_PRIVATE)
        val arrived=System.currentTimeMillis()
        health.edit()
            .putLong(if(kind=="incoming_call")"lastCallMessageAt" else "lastParkingMessageAt",arrived)
            .putInt("lastFcmPriority",message.priority)
            .putInt("lastFcmOriginalPriority",message.originalPriority).apply()
        if (message.data["type"] == "move_request") {
            showParkingAlert(message)
            return
        }
        if (message.data["type"] != "incoming_call") return
        val callId = message.data["callId"] ?: return
        if (!VoiceApi.validCallId(callId) || VoiceApi.auth(this).isBlank()) {
            health.edit().putLong("lastCallDiscardedAt",arrived).apply()
            return
        }
        if(message.sentTime>0L && arrived-message.sentTime>35_000L){
            health.edit().putLong("lastCallDiscardedAt",arrived).apply()
            return
        }
        if(OngoingCallService.currentCallId==callId)return // Already answered; late FCM is not a new call.
        val issuedAt=message.data["sentAtMs"]?.toLongOrNull()?:0L
        if(!postIncomingNotification(this,callId,issuedAt=issuedAt))return
        // A short authenticated receipt lets the server avoid a second,
        // system-rendered notification when our full-screen alert was posted.
        runCatching {
            VoiceApi.post(VoiceApi.base(this),"/api/voice/calls/$callId/delivered",
                JSONObject(),VoiceApi.auth(this),3000)
        }.onFailure { Log.w("MoveCarIncoming","Call receipt failed",it) }
    }
    private fun showParkingAlert(message: RemoteMessage) {
        if (VoiceApi.mobileAuth(this).isBlank()) return
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        ensureParkingChannel(this)
        val title = message.data["title"]?.take(90) ?: "有人请求挪车"
        val text = (message.data["message"] ?: "点击查看挪车请求")
            .replace(Regex("!\\[[^]]*]\\([^)]*\\)"), "现场照片已上传")
            .replace(Regex("\\[([^]]+)]\\([^)]*\\)"), "\$1")
            .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s*"), "")
            .replace("**", "")
            .trim().take(1000)
        val view = PendingIntent.getActivity(this, 11,
            Intent(this, MainActivity::class.java).apply {
                putExtra("openPage","requests")
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, PARKING_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(view)
            .build()
        try {
            nm.notify((System.currentTimeMillis() % 2000000000).toInt(), notification)
            getSharedPreferences("movecar_call_health",MODE_PRIVATE).edit()
                .putLong("lastParkingPostedAt",System.currentTimeMillis()).apply()
        }catch (_: SecurityException) {
            getSharedPreferences("movecar_call_health",MODE_PRIVATE).edit()
                .putLong("lastParkingPostFailedAt",System.currentTimeMillis()).apply()
        }
    }
}
