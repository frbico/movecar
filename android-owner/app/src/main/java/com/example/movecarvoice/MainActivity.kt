package com.example.movecarvoice

import android.Manifest
import java.io.ByteArrayOutputStream
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.*
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/** Native owner console; WebRTC calling is still handled by OngoingCallService. */
class MainActivity : Activity() {
    private lateinit var root: LinearLayout
    private var page = "home"
    private var historyPage = 1
    private val homeUrl = "https://movecar.ssxi.de"
    private val iconPicker = 120

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }
        if (VoiceApi.mobileAuth(this).isEmpty()) loginPage() else navigate("home")
    }

    private fun screen(heading: String) {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 30, 28, 36)
        }
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(root) }
        setContentView(scroll)
        title(heading, 23f)
    }
    private fun title(value: String, size: Float = 19f) {
        root.addView(TextView(this).apply { text=value; textSize=size; setPadding(0,14,0,12) })
    }
    private fun note(value: String) {
        root.addView(TextView(this).apply { text=value; textSize=14f; setPadding(0,5,0,11) })
    }
    private fun field(hint: String, value: String = "", password: Boolean = false): EditText {
        return EditText(this).also {
            it.hint=hint; it.setText(value); it.setSingleLine()
            if (password) it.inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            root.addView(it,LinearLayout.LayoutParams(-1,-2))
        }
    }
    private fun check(label: String, enabled: Boolean): CheckBox = CheckBox(this).also {
        it.text=label; it.isChecked=enabled; root.addView(it)
    }
    private fun action(label: String, callback: () -> Unit) {
        root.addView(Button(this).apply { text=label; setOnClickListener { callback() } },LinearLayout.LayoutParams(-1,-2))
    }
    private fun notify(message: String) { Toast.makeText(this,message,Toast.LENGTH_LONG).show() }
    private fun base() = VoiceApi.base(this).ifBlank { homeUrl }
    private fun token() = VoiceApi.mobileAuth(this)
    private fun api(path:String, body:JSONObject?=null, done:(JSONObject)->Unit) {
        val host=base();val bearer=token()
        Thread {
            val result=runCatching {
                if(body==null)VoiceApi.get(host,path,bearer)
                else VoiceApi.post(host,path,body,bearer)
            }
            runOnUiThread {
                result.onSuccess(done).onFailure {
                    notify("操作失败："+(it.message ?: "网络异常"))
                    if(it.message?.contains("登录已过期")==true) { VoiceApi.prefs(this).edit().remove("mobileAuth").remove("auth").apply();loginPage() }
                }
            }
        }.start()
    }
    private fun loginPage() {
        screen("🚙 MoveCar 车主端")
        note("使用网页版后台的管理员账号与密码登录。首次账号为 admin；旧密码可通过原服务器后台找回或修改。")
        val site=field("HTTPS 服务器地址",base())
        val username=field("管理员账号",VoiceApi.username(this))
        val password=field("管理员密码",password=true)
        action("安全登录并绑定消息推送") {
            val url=try{VoiceApi.normalizeBase(site.text.toString())}catch(e:Exception){notify(e.message ?: "网站 URL 无效");return@action}
            val name=username.text.toString().trim()
            val pass=password.text.toString()
            if(name.isEmpty()||pass.isEmpty()){notify("请输入账号和密码");return@action}
            FirebaseMessaging.getInstance().token.addOnCompleteListener { fcmTask ->
                Thread {
                    val payload=JSONObject().put("username",name).put("password",pass)
                    if(fcmTask.isSuccessful)payload.put("fcmToken",fcmTask.result)
                    val result=runCatching {VoiceApi.post(url,"/api/mobile/login",payload)}
                    runOnUiThread {
                        result.onSuccess { resultJson ->
                            VoiceApi.prefs(this).edit()
                                .putString("base",url)
                                .putString("username",name)
                                .putString("mobileAuth",resultJson.getString("token"))
                                .putString("auth",resultJson.optString("deviceAuth"))
                                .apply()
                            password.text.clear()
                            notify(if(resultJson.optString("deviceAuth").isNotBlank())"登录成功，APP 通知和语音已绑定" else "登录成功；FCM 尚未绑定，请检查 Google Play 服务")
                            navigate("home")
                        }.onFailure { notify("登录失败："+(it.message ?: "网络异常")) }
                    }
                }.start()
            }
        }
        action("在浏览器打开管理后台") { browse(base()+"/admin") }
    }
    private fun browse(url:String){startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}
    @Deprecated("Uses platform result callback to avoid extra AndroidX dependency")
    override fun onActivityResult(requestCode:Int, resultCode:Int, data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(requestCode!=iconPicker||resultCode!=RESULT_OK)return
        val uri=data?.data ?: return
        val bytes=try {
            contentResolver.openInputStream(uri)?.use { input ->
                val output=ByteArrayOutputStream()
                val chunk=ByteArray(8192)
                while(true){
                    val n=input.read(chunk);if(n<0)break
                    if(output.size()+n>262144)throw IllegalArgumentException("图标不能大于 256 KB")
                    output.write(chunk,0,n)
                }
                output.toByteArray()
            } ?: throw IllegalStateException("无法读取文件")
        } catch(e:Exception){notify(e.message ?: "文件读取失败");return}
        val mime=contentResolver.getType(uri) ?: "application/octet-stream"
        val host=base();val bearer=token()
        Thread {
            val result=runCatching{VoiceApi.putBytes(host,"/api/mobile/site-icon",bytes,mime,bearer)}
            runOnUiThread{result.onSuccess{notify("站点图标已更新");navigate("settings")}.onFailure{notify("图标上传失败："+it.message)}}
        }.start()
    }

    private fun shell(title:String) {
        screen(title)
        val row=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL}
        listOf("首页" to "home","挪车" to "requests","通话" to "calls","通知" to "channels","设置" to "settings","账号" to "account").forEach { pair ->
            row.addView(Button(this).apply {text=pair.first;textSize=11f;setOnClickListener { navigate(pair.second) }},LinearLayout.LayoutParams(0,-2,1f))
        }
        root.addView(HorizontalScrollView(this).apply { addView(row) })
    }
    private fun navigate(next:String) {
        page=next
        when(next){
            "home" -> api("/api/mobile/config"){home(it)}
            "requests" -> loadRequests()
            "calls" -> api("/api/mobile/calls"){calls(it)}
            "channels" -> api("/api/mobile/config"){channels(it)}
            "settings" -> api("/api/mobile/config"){settings(it)}
            "account" -> api("/api/mobile/config"){account(it)}
        }
    }
    private fun home(config:JSONObject){
        shell("🚙 车主控制台")
        title(config.optString("siteName","MoveCar"))
        note("挪车记录："+config.optInt("requestCount")+" 条　｜　账号："+config.optString("username"))
        val channels=config.getJSONObject("channels")
        val app=channels.getJSONObject("app")
        note("APP 原生消息："+(if(app.optBoolean("configured"))"设备已配对" else "未配对")+" / "+(if(app.optBoolean("enabled"))"已启用" else "已关闭"))
        action("🔔 测试 APP 通知") { testChannel("app") }
        action("📋 查看挪车留言") { navigate("requests") }
        action("📞 查看通话记录") { navigate("calls") }
        action("⚙ 管理通知渠道") { navigate("channels") }
        action("🌐 网页管理后台") { browse(base()+"/admin") }
        action("🔄 重新绑定 Google FCM") { syncFcm() }
    }
    private fun syncFcm(){
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if(!task.isSuccessful){notify("无法获取 FCM Token");return@addOnCompleteListener}
            api("/api/mobile/device",JSONObject().put("fcmToken",task.result)) {
                VoiceApi.prefs(this).edit().putString("auth",it.optString("deviceAuth")).apply()
                notify("FCM 设备重新绑定成功")
            }
        }
    }
    private fun loadRequests(){
        api("/api/mobile/requests?page="+historyPage+"&size=20"){ result ->
            shell("📋 挪车记录")
            note("共 "+result.optInt("total")+" 条 · 第 "+historyPage+" 页")
            action("刷新") {loadRequests()}
            val items=result.optJSONArray("items")
            if(items==null||items.length()==0)note("暂无挪车记录")
            else for(i in 0 until items.length()){
                val item=items.getJSONObject(i)
                val id=item.getString("id")
                title(DateFormat.getDateTimeInstance().format(Date(item.optLong("createdAt"))),17f)
                note(item.optString("message")+"\n状态："+item.optString("status"))
                if(item.optString("status")=="waiting")action("✅ 确认这条挪车请求") {
                    api("/api/mobile/requests/confirm",JSONObject().put("id",id)){navigate("requests")}
                }
                val photo=item.optString("photoUrl")
                if(photo.startsWith("/"))action("📷 查看现场照片") {browse(base()+photo)}
                action("删除本条记录") { confirm("删除这条挪车记录？") {
                    api("/api/mobile/requests/delete",JSONObject().put("id",id)){navigate("requests")}
                }}
            }
            if(historyPage>1)action("上一页") {historyPage--;loadRequests()}
            if(historyPage*20<result.optInt("total"))action("下一页") {historyPage++;loadRequests()}
            action("清空所有记录") {confirm("不可恢复！确定删除全部挪车记录和关联照片？") {
                api("/api/mobile/requests/clear",JSONObject().put("confirm",true)){historyPage=1;navigate("requests")}
            }}
        }
    }
    private fun confirm(message:String,yes:()->Unit){AlertDialog.Builder(this).setMessage(message).setNegativeButton("取消",null).setPositiveButton("确定") {_,_->yes()}.show()}
    private fun calls(result:JSONObject){
        shell("📞 通话记录")
        action("刷新") {navigate("calls")}
        val items=result.optJSONArray("items")
        if(items==null||items.length()==0){note("暂无通话记录");return}
        for(i in 0 until items.length()){
            val obj=items.getJSONObject(i)
            title(DateFormat.getDateTimeInstance().format(Date(obj.optLong("startedAt"))),17f)
            note("匿名语音来电 · 状态："+obj.optString("status"))
        }
    }
    private fun channels(config:JSONObject){
        shell("🔔 通知渠道")
        note("APP FCM、Bark、Server酱³、微信 Server酱可独立启用。密钥留空表示保留原配置；语音来电独立于普通留言通知开关。")
        val status=config.getJSONObject("channels")
        fun channel(name:String,display:String):CheckBox {
            val obj=status.getJSONObject(name)
            return check(display+"（"+(if(obj.optBoolean("configured"))"已配置" else "未配置")+"）",obj.optBoolean("enabled"))
        }
        val app=channel("app","APP 原生 FCM")
        val bark=channel("bark","Bark · iOS")
        val sc3=channel("sc3","Server酱³")
        val turbo=channel("serverchan","微信 Server酱")
        val barkKey=field("新的 Bark HTTPS API 地址（留空保持）")
        val sc3Key=field("新的 Server酱³ SendKey（留空保持）")
        val turboKey=field("新的微信 Server酱 Turbo SendKey（留空保持）")
        val clearBark=check("清除 Bark 密钥",false)
        val clearSc3=check("清除 Server酱³ 密钥",false)
        val clearTurbo=check("清除微信 SendKey",false)
        action("💾 保存通知设置") {
            val data=JSONObject()
                .put("appEnabled",app.isChecked).put("barkEnabled",bark.isChecked)
                .put("sc3Enabled",sc3.isChecked).put("serverchanEnabled",turbo.isChecked)
                .put("barkUrl",barkKey.text.toString()).put("sc3SendKey",sc3Key.text.toString())
                .put("serverchanSendKey",turboKey.text.toString())
                .put("clearBark",clearBark.isChecked).put("clearSc3",clearSc3.isChecked)
                .put("clearServerchan",clearTurbo.isChecked)
            api("/api/mobile/channels",data) {notify("通知配置保存成功");navigate("channels")}
        }
        listOf("app" to "📲 测试 APP 推送","bark" to "测试 Bark","sc3" to "测试 Server酱³","serverchan" to "测试微信","all" to "测试全部已启用渠道").forEach { pair ->
            action(pair.second){testChannel(pair.first)}
        }
    }
    private fun testChannel(channel:String){
        api("/api/mobile/channels/test",JSONObject().put("channel",channel)){
            notify("已提交推送："+it.optJSONObject("channels")?.toString())
        }
    }
    private fun settings(config:JSONObject){
        shell("⚙ 网站基本设置")
        val site=field("站点名称",config.optString("siteName"))
        val url=field("HTTPS 公网地址",config.optString("publicUrl"))
        val phone=field("车主联系电话（可选）",config.optString("phoneNumber"))
        val wechat=field("微信号（可选）",config.optString("wechatId"))
        val rate=field("通知间隔：秒（0–3600）",config.optInt("rateLimitSeconds",60).toString())
        val limit=field("记录保留条数（1–500）",config.optInt("requestRetentionLimit",50).toString())
        action("💾 保存基本设置"){
            val r=rate.text.toString().toIntOrNull()
            val l=limit.text.toString().toIntOrNull()
            if(r==null||l==null){notify("请输入正确的数字");return@action}
            val payload=JSONObject().put("siteName",site.text.toString())
                .put("publicUrl",url.text.toString()).put("phoneNumber",phone.text.toString())
                .put("wechatId",wechat.text.toString()).put("rateLimitSeconds",r)
                .put("requestRetentionLimit",l)
            api("/api/mobile/settings",payload){notify("保存成功");navigate("settings")}
        }
        note("网站图标："+(if(config.optBoolean("siteIconConfigured"))"已上传" else "默认图标"))
        action("上传网站图标（PNG/JPEG/WebP/ICO，最大 256 KB）") {
            val intent=Intent(Intent.ACTION_GET_CONTENT).apply { type="*/*";addCategory(Intent.CATEGORY_OPENABLE) }
            @Suppress("DEPRECATION")
            startActivityForResult(Intent.createChooser(intent,"选择网站图标"),iconPicker)
        }
        action("恢复默认网站图标") { confirm("恢复默认图标？") {
            api("/api/mobile/site-icon/clear",JSONObject()){notify("已恢复默认图标");navigate("settings")}
        }}
        action("🌐 高级设置：打开网页版后台") {browse(base()+"/admin")}
    }
    private fun account(config:JSONObject){
        shell("🔐 账户安全")
        note("与网页端后台使用相同的管理员账号和密码。修改后会退出所有网页及 APP 会话。")
        val name=field("管理员用户名",config.optString("username","admin"))
        val old=field("当前密码",password=true)
        val newer=field("新密码（不修改请留空，至少 12 位）",password=true)
        action("保存管理员账号 / 密码"){
            val payload=JSONObject().put("newUsername",name.text.toString().trim())
                .put("currentPassword",old.text.toString()).put("newPassword",newer.text.toString())
            api("/api/mobile/account",payload) { notify("账号已更新，请重新登录");clearLogin() }
        }
        action("退出登录（停止本机后续通知绑定）") {
            api("/api/mobile/logout",JSONObject().put("deviceAuth",VoiceApi.auth(this))){ clearLogin() }
        }
    }
    private fun clearLogin(){
        VoiceApi.prefs(this).edit().remove("mobileAuth").remove("auth").apply()
        loginPage()
    }
}