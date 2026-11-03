package com.example.movecarvoice

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Keeps a rotated FCM token registered even when the messaging callback ends. */
class PushBindingJob : JobService() {
    companion object {
        private const val JOB_ID = 2401
        const val LAST_SYNC_AT = "lastTokenSyncAt"
        const val LAST_FAILURE_AT = "lastTokenSyncFailureAt"

        fun schedule(context: Context) {
            if (VoiceApi.base(context).isBlank() || VoiceApi.mobileAuth(context).isBlank()) return
            val scheduler=context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            val job=JobInfo.Builder(JOB_ID,ComponentName(context,PushBindingJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setBackoffCriteria(30_000L,JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build()
            if(scheduler.schedule(job)!=JobScheduler.RESULT_SUCCESS)
                Log.w("MoveCarPush","Could not schedule token synchronization")
        }

        fun cancel(context: Context) {
            (context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler).cancel(JOB_ID)
        }
    }

    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            val result=runCatching {
                val base=VoiceApi.base(this)
                val login=VoiceApi.mobileAuth(this)
                if(base.isBlank() || login.isBlank())return@runCatching
                val fcmToken=Tasks.await(FirebaseMessaging.getInstance().token,20,TimeUnit.SECONDS)
                require(!fcmToken.isNullOrBlank()) { "FCM token unavailable" }
                val currentAuth=VoiceApi.auth(this)
                val response=VoiceApi.post(base,"/api/mobile/device",
                    JSONObject().put("fcmToken",fcmToken).put("deviceAuth",currentAuth),login)
                // A queued job must not restore a device binding after logout or server switch.
                if(VoiceApi.mobileAuth(this)==login && VoiceApi.base(this)==base){
                    VoiceApi.prefs(this).edit()
                        .putString("auth",response.getString("deviceAuth"))
                        .putLong(LAST_SYNC_AT,System.currentTimeMillis())
                        .remove(LAST_FAILURE_AT).apply()
                }
            }
            result.onFailure {
                VoiceApi.prefs(this).edit().putLong(LAST_FAILURE_AT,System.currentTimeMillis()).apply()
                Log.w("MoveCarPush","FCM token synchronization failed",it)
            }
            val retry=result.isFailure && VoiceApi.mobileAuth(this).isNotBlank() &&
                result.exceptionOrNull()?.message?.contains("登录已过期")!=true
            jobFinished(params,retry)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
