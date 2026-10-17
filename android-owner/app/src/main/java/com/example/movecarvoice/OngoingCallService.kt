package com.example.movecarvoice

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Native audio engine. Unlike a WebView, the peer connection and microphone are owned by
 * a foreground service: locking the screen or leaving the Activity does not dispose them.
 * Only start this service AFTER the owner explicitly accepted the call from a visible Activity.
 */
class OngoingCallService : Service() {
    companion object {
        const val ACTION_START = "com.example.movecarvoice.START_CALL"
        const val ACTION_END = "com.example.movecarvoice.END_CALL"
        const val ACTION_SPEAKER = "com.example.movecarvoice.SPEAKER"
        const val CHANNEL = "movecar_active_calls"
        const val NOTIFICATION = 1002
        @Volatile var currentCallId: String? = null
            private set
        @Volatile var state: String = "已挂断"
            private set
        @Volatile var speakerEnabled = false
            private set
        private var rtcInitialized = false
    }

    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var ticker: ScheduledFuture<*>? = null
    private var base = ""
    private var callId = ""
    private var token = ""
    private var seq = 0L
    private var stopped = false
    private var audio: AudioManager? = null
    private var audioFocus: AudioFocusRequest? = null
    private var factory: PeerConnectionFactory? = null
    private var audioSource: AudioSource? = null
    private var localTrack: org.webrtc.AudioTrack? = null
    private var peer: PeerConnection? = null
    private val earlyCandidates = mutableListOf<IceCandidate>()
    private var answered = false

    override fun onBind(intent: Intent?) = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL,"正在通话",NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_END -> { finishCall(true); return START_NOT_STICKY }
            ACTION_SPEAKER -> { toggleSpeaker(); return START_NOT_STICKY }
            ACTION_START -> {
                val id = intent.getStringExtra("callId") ?: ""
                val auth = intent.getStringExtra("ownerToken") ?: ""
                if (!VoiceApi.validCallId(id) || !Regex("^[A-Za-z0-9_-]{43}$").matches(auth) ||
                    VoiceApi.base(this).isBlank() || currentCallId != null) {
                    stopSelf(); return START_NOT_STICKY
                }
                callId = id; token = auth; base = VoiceApi.base(this)
                currentCallId = id; state = "正在连接…"; stopped = false
                // Called while the accepting Activity is visible: required for API 34+ microphone FGS.
                try {
                    val note = ongoingNotification()
                    if (Build.VERSION.SDK_INT >= 34)
                        startForeground(NOTIFICATION,note,ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                    else startForeground(NOTIFICATION,note)
                } catch (e: Exception) {
                    Log.e("MoveCarVoice","Foreground microphone service unavailable",e)
                    finishCall(false); return START_NOT_STICKY
                }
                configureAudio()
                worker.execute {
                    try {
                        makePeer()
                        ticker = worker.scheduleWithFixedDelay({ pollSafely() },0,900,TimeUnit.MILLISECONDS)
                    } catch (e: Exception) {
                        Log.e("MoveCarVoice","Native WebRTC initialization failed",e)
                        finishCall(true)
                    }
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun ongoingNotification(): Notification {
        val screen = PendingIntent.getActivity(this, 201,
            Intent(this,VoiceActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val end = PendingIntent.getService(this, 202,
            Intent(this,OngoingCallService::class.java).setAction(ACTION_END),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle("挪车语音通话中")
            .setContentText("锁屏后仍保持通话 · 点击返回通话")
            .setContentIntent(screen)
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,"挂断",end).build())
            .build()
    }

    private fun configureAudio() {
        audio = getSystemService(AUDIO_SERVICE) as AudioManager
        val am = audio ?: return
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 26) {
            audioFocus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .build()
            audioFocus?.let { am.requestAudioFocus(it) }
        }
        updateSpeaker(false)
    }

    private fun toggleSpeaker() { updateSpeaker(!speakerEnabled) }
    private fun updateSpeaker(enabled: Boolean) {
        speakerEnabled = enabled
        val am = audio ?: return
        if (Build.VERSION.SDK_INT >= 31) {
            if (enabled) {
                am.availableCommunicationDevices.firstOrNull {
                    it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                }?.let { am.setCommunicationDevice(it) }
            } else am.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = enabled
        }
    }

    @Synchronized private fun makePeer() {
        if (!rtcInitialized) {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).createInitializationOptions())
            rtcInitialized = true
        }
        val adm = JavaAudioDeviceModule.builder(applicationContext).createAudioDeviceModule()
        factory = PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory()
        adm.release()
        // Avoid hard-coding a blocked Google STUN server. Regional STUN/TURN
        // comes from the authenticated /events response before SDP answer.
        val ice = mutableListOf<PeerConnection.IceServer>()
        // Fetch short-lived coturn credentials only after owner authentication via /events.
        // Never embed a permanent TURN secret in the Android APK.
        val rtcConfig = PeerConnection.RTCConfiguration(ice)
        rtcConfig.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        peer = factory!!.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {
                state = when(s) {
                    PeerConnection.IceConnectionState.CONNECTED,PeerConnection.IceConnectionState.COMPLETED -> "通话中"
                    PeerConnection.IceConnectionState.DISCONNECTED -> "网络重连中…"
                    PeerConnection.IceConnectionState.FAILED -> "ICE 连接失败，准备结束并允许重拨"
                    else -> state
                }
                if (s == PeerConnection.IceConnectionState.FAILED) {
                    // Allow transient network changes to recover before failing.
                    worker.schedule({
                        if (!stopped &&
                            peer?.iceConnectionState() == PeerConnection.IceConnectionState.FAILED) {
                            Log.w("MoveCarVoice","ICE remained failed; release failed call")
                            finishCall(true, "ice_failed")
                        }
                    },4,TimeUnit.SECONDS)
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
            override fun onIceCandidate(c: IceCandidate) {
                if (stopped) return
                worker.execute {
                    sendSignal("ice", JSONObject().put("candidate",c.sdp)
                        .put("sdpMid",c.sdpMid).put("sdpMLineIndex",c.sdpMLineIndex))
                }
            }
            override fun onIceCandidatesRemoved(candidates: Array<IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onDataChannel(channel: DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<MediaStream>) {}
        }) ?: throw IllegalStateException("PeerConnection could not be created")
        audioSource = factory!!.createAudioSource(MediaConstraints())
        localTrack = factory!!.createAudioTrack("movecar-owner-audio",audioSource)
        peer!!.addTrack(localTrack,listOf("movecar-owner-stream"))
    }

    private fun endpoint(action: String) = "/api/voice/calls/$callId/$action"
    private fun sendSignal(kind: String, payload: JSONObject) {
        if (stopped) return
        runCatching { VoiceApi.post(base,endpoint("signal"),JSONObject()
            .put("token",token).put("kind",kind).put("payload",payload)) }
            .onFailure { Log.w("MoveCarVoice","Signaling request failed: ${it.javaClass.simpleName}") }
    }

    private fun pollSafely() {
        if (stopped) return
        try {
            val result = VoiceApi.post(base,endpoint("events"),JSONObject().put("token",token).put("after",seq))
            val status = result.optString("status")
            if (status != "active") {
                state = "通话已结束 ($status)"
                finishCall(false); return
            }
            // Credentials refreshed on each poll; supports coturn across different mobile networks.
            val newIce = result.optJSONArray("iceServers")
            if (newIce != null && !answered) updateIce(newIce)
            val events = result.getJSONArray("events")
            for (i in 0 until events.length()) {
                val e = events.getJSONObject(i)
                seq = maxOf(seq,e.getLong("seq"))
                val payload = e.getJSONObject("payload")
                when(e.getString("kind")) {
                    "offer" -> if (!answered) receiveOffer(payload)
                    "ice" -> receiveIce(payload)
                }
            }
        } catch (e: Exception) {
            Log.w("MoveCarVoice","Polling failed: ${e.javaClass.simpleName}")
        }
    }

    private fun updateIce(json: JSONArray) {
        val servers = mutableListOf<PeerConnection.IceServer>()
        for (i in 0 until json.length()) {
            val item = json.getJSONObject(i)
            val urls = item.optJSONArray("urls") ?: JSONArray().put(item.optString("urls"))
            for (j in 0 until urls.length()) {
                val u = urls.optString(j)
                if (!(u.startsWith("turn:") || u.startsWith("turns:") || u.startsWith("stun:"))) continue
                servers.add(PeerConnection.IceServer.builder(u)
                    .setUsername(item.optString("username"))
                    .setPassword(item.optString("credential")).createIceServer())
            }
        }
        if (servers.isNotEmpty()) {
            val config = PeerConnection.RTCConfiguration(servers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            }
            val ok = peer?.setConfiguration(config) ?: false
            if (!ok) Log.w("MoveCarVoice","ICE server configuration not applied")
            else Log.i("MoveCarVoice","ICE configured: "+servers.size+" regional endpoints")
        }
    }

    private fun receiveIce(payload: JSONObject) {
        val candidate = IceCandidate(payload.optString("sdpMid"),payload.getInt("sdpMLineIndex"),payload.getString("candidate"))
        val connection = peer ?: return
        if (connection.remoteDescription == null) earlyCandidates.add(candidate)
        else connection.addIceCandidate(candidate)
    }

    private fun receiveOffer(payload: JSONObject) {
        val connection = peer ?: return
        answered = true
        connection.setRemoteDescription(object: SimpleSdpObserver() {
            override fun onSetSuccess() {
                worker.execute {
                    earlyCandidates.forEach { connection.addIceCandidate(it) }
                    earlyCandidates.clear()
                    connection.createAnswer(object: SimpleSdpObserver() {
                        override fun onCreateSuccess(description: SessionDescription) {
                            connection.setLocalDescription(object: SimpleSdpObserver() {
                                override fun onSetSuccess() {
                                    worker.execute { sendSignal("answer",JSONObject()
                                        .put("type","answer").put("sdp",description.description)) }
                                }
                            },description)
                        }
                    },MediaConstraints())
                }
            }
            override fun onSetFailure(error: String) {
                state="SDP 协商失败"
                Log.e("MoveCarVoice","setRemoteDescription: $error")
            }
        },SessionDescription(SessionDescription.Type.OFFER,payload.getString("sdp")))
    }

    private open class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) { Log.e("MoveCarVoice","SDP create failed: $error") }
        override fun onSetFailure(error: String) { Log.e("MoveCarVoice","SDP set failed: $error") }
    }

    private fun finishCall(notifyOther: Boolean, failureReason: String? = null) {
        if (stopped) return
        stopped = true
        if (notifyOther && callId.isNotBlank()) {
            // Do not block onDestroy or the UI thread.
            Thread {
                runCatching {
                    val body=JSONObject().put("token",token)
                    if (failureReason != null) body.put("reason",failureReason)
                    VoiceApi.post(base,endpoint("end"),body)
                }
            }.start()
        }
        ticker?.cancel(false)
        worker.execute {
            try { peer?.close(); peer?.dispose(); localTrack?.dispose(); audioSource?.dispose(); factory?.dispose() }
            catch (_:Exception) {}
        }
        currentCallId = null
        state = "通话已结束"
        audio?.let { am ->
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
            if (Build.VERSION.SDK_INT >= 26) audioFocus?.let { am.abandonAudioFocusRequest(it) }
            am.mode = AudioManager.MODE_NORMAL
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (!stopped) finishCall(true)
        worker.shutdown()
        super.onDestroy()
    }
}
