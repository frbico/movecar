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


    private fun px(value: Int) = OwnerUi.dp(this, value)
    private fun spacer(size: Int = 12) {
        root.addView(android.view.View(this), LinearLayout.LayoutParams(1, px(size)))
    }
    private fun screen(heading: String) {
        window.statusBarColor = OwnerUi.canvas
        window.navigationBarColor = OwnerUi.white
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
            android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

        val frame = OwnerUi.vertical(this).apply { setBackgroundColor(OwnerUi.canvas) }
        val top = OwnerUi.horizontal(this).apply {
            setPadding(px(20), px(16), px(20), px(12))
        }
        val mark = OwnerUi.label(this, "M", 22f, OwnerUi.white, true).apply {
            gravity = Gravity.CENTER
            background = OwnerUi.bg(OwnerUi.blue, 15, this@MainActivity)
        }
        top.addView(mark, LinearLayout.LayoutParams(px(46), px(46)))
        val headingCol = OwnerUi.vertical(this).apply { setPadding(px(12), 0, 0, 0) }
        headingCol.addView(OwnerUi.label(this, "MOVE CAR  /  车主中心", 11f, OwnerUi.muted, true))
        headingCol.addView(OwnerUi.label(this, heading, 19f, OwnerUi.navy, true))
        top.addView(headingCol, LinearLayout.LayoutParams(0, -2, 1f))
        if (page != "login") top.addView(OwnerUi.pill(this, "● 已登录", true))
        frame.addView(top)

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
        }
        root = OwnerUi.vertical(this).apply {
            setPadding(px(20), px(4), px(20), px(30))
        }
        scroll.addView(root, android.widget.ScrollView.LayoutParams(-1, -2))
        frame.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        if (page != "login") frame.addView(bottomNav())
        setContentView(frame)
    }

    private fun bottomNav(): LinearLayout {
        val bar=OwnerUi.horizontal(this).apply {
            setBackgroundColor(OwnerUi.white)
            setPadding(px(7), px(8), px(7), px(9))
            elevation=px(12).toFloat()
        }
        val tabs=listOf(
            Triple("首页", "home", android.R.drawable.ic_menu_view),
            Triple("挪车", "requests", android.R.drawable.ic_menu_agenda),
            Triple("通话", "calls", android.R.drawable.sym_action_call),
            Triple("通知", "channels", android.R.drawable.ic_dialog_email),
            Triple("设置", "settings", android.R.drawable.ic_menu_manage)
        )
        for ((label, route, icon) in tabs) {
            val selected=page==route || (route=="settings"&&page=="account")
            val color=if(selected) OwnerUi.blue else OwnerUi.muted
            val item=OwnerUi.vertical(this).apply {
                gravity=Gravity.CENTER
                setPadding(px(3), px(7), px(3), px(5))
                background=OwnerUi.pressable(this@MainActivity,
                    if(selected)OwnerUi.softBlue else OwnerUi.white, 13)
                isClickable=true
                isFocusable=true
                contentDescription="切换到"+label
                setOnClickListener { if(page!=route)navigate(route) }
            }
            val iconView=OwnerUi.icon(this,icon,color,21)
            item.addView(iconView)
            item.addView(OwnerUi.label(this,label,11f,color,selected).apply {
                gravity=Gravity.CENTER
                setPadding(0,px(5),0,0)
            })
            bar.addView(item,LinearLayout.LayoutParams(0,px(59),1f).apply {
                marginStart=px(2);marginEnd=px(2)
            })
        }
        return bar
    }

    private fun title(value: String, size: Float = 18f) {
        root.addView(OwnerUi.label(this, value, size, OwnerUi.navy, true).apply {
            setPadding(0, px(10), 0, px(6))
        },LinearLayout.LayoutParams(-1,-2))
    }
    private fun note(value: String) {
        root.addView(OwnerUi.label(this, value, 13.5f, OwnerUi.muted).apply {
            setLineSpacing(px(2).toFloat(),1f)
            setPadding(0, px(3), 0, px(8))
        },LinearLayout.LayoutParams(-1,-2))
    }
    private inline fun <T> inCard(block: () -> T): T {
        val holder=OwnerUi.card(this)
        root.addView(holder,LinearLayout.LayoutParams(-1,-2).apply{
            bottomMargin=px(13)
        })
        val previous=root
        root=holder
        return try{block()}finally{root=previous}
    }
    private fun section(heading:String,caption:String="") {
        title(heading,18f)
        if(caption.isNotBlank())note(caption)
    }
    private fun field(hint: String, value: String = "", password: Boolean = false): EditText {
        val block=OwnerUi.vertical(this)
        block.addView(OwnerUi.label(this,hint,13f,OwnerUi.navy,true))
        val edit=EditText(this).apply {
            setSingleLine()
            setText(value)
            textSize=15f
            setTextColor(OwnerUi.navy)
            setHintTextColor(OwnerUi.muted)
            background=OwnerUi.bg(OwnerUi.canvas,12,this@MainActivity,OwnerUi.line)
            setPadding(px(13),px(12),px(13),px(12))
            minHeight=px(51)
            if(password)inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        block.addView(edit,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(7)})
        root.addView(block,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(15)})
        return edit
    }
    private fun check(label:String,enabled:Boolean):CheckBox =
        CheckBox(this).also {
            it.text=label
            it.textSize=14f
            it.setTextColor(OwnerUi.navy)
            it.isChecked=enabled
            it.minHeight=px(48)
            it.buttonTintList=android.content.res.ColorStateList.valueOf(OwnerUi.blue)
            root.addView(it,LinearLayout.LayoutParams(-1,-2))
        }
    private fun action(label:String,primary:Boolean=false,danger:Boolean=false,callback:()->Unit) {
        val surface=if(primary)OwnerUi.blue else if(danger)OwnerUi.softRed else OwnerUi.white
        val foreground=if(primary)OwnerUi.white else if(danger)OwnerUi.red else OwnerUi.blue
        val button=OwnerUi.label(this,label,14f,foreground,true).apply {
            gravity=Gravity.CENTER
            minHeight=px(48)
            setPadding(px(14),px(12),px(14),px(12))
            background=OwnerUi.pressable(this@MainActivity,surface,13,
                if(primary)null else if(danger)OwnerUi.softRed else OwnerUi.line)
            isClickable=true
            isFocusable=true
            setOnClickListener{callback()}
        }
        root.addView(button,LinearLayout.LayoutParams(-1,-2).apply {
            topMargin=px(6);bottomMargin=px(5)
        })
    }
    private fun status(text:String,good:Boolean?=null) {
        root.addView(OwnerUi.pill(this,text,good),LinearLayout.LayoutParams(-2,-2).apply{
            topMargin=px(2);bottomMargin=px(8)
        })
    }
    private fun empty(heading:String,description:String){
        inCard {root.addView(OwnerUi.centerEmpty(this,heading,description))}
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
        page = "login"
        screen("安全登录")
        val welcome=OwnerUi.vertical(this).apply {
            background=OwnerUi.gradient(this@MainActivity)
            setPadding(px(22),px(25),px(22),px(25))
        }
        welcome.addView(OwnerUi.label(this,"安心联系，随时挪车",23f,OwnerUi.white,true))
        welcome.addView(OwnerUi.label(this,"一站式管理通知、匿名来电与挪车请求",13f,0xFFDBEAFE.toInt()))
        root.addView(welcome,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(20)})
        section("欢迎回来","使用与网页版后台相同的管理员账号。")
        val site = field("HTTPS 服务器地址", base())
        val username = field("管理员账号", VoiceApi.username(this))
        val password = field("管理员密码", password = true)
        val status = TextView(this).apply {
            text = "先登录后台，成功后自动尝试绑定 Firebase 推送。"
            textSize = 15f
            setPadding(0, 12, 0, 12)
        }
        root.addView(status)
        val login=Button(this).apply {
            text="登录车主中心"
            isAllCaps=false
            textSize=16f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.blue,15)
            minHeight=px(54)
            elevation=0f
        }
        root.addView(login, LinearLayout.LayoutParams(-1, -2))
        login.setOnClickListener {
            val url = try {
                VoiceApi.normalizeBase(site.text.toString())
            } catch (e: Exception) {
                status.text = "网址不正确：" + (e.message ?: "请填写 HTTPS 站点地址")
                return@setOnClickListener
            }
            val name = username.text.toString().trim()
            val pass = password.text.toString()
            if (name.isEmpty() || pass.isEmpty()) {
                status.text = "请填写管理员账号和密码"
                return@setOnClickListener
            }
            login.isEnabled = false
            status.text = "正在验证账号密码，请稍候…"
            // Authenticate immediately: do not block login waiting for Google FCM Token.
            Thread {
                val result = runCatching {
                    VoiceApi.post(url, "/api/mobile/login",
                        JSONObject().put("username", name).put("password", pass))
                }
                runOnUiThread {
                    login.isEnabled = true
                    result.onSuccess { obj ->
                        val bearer = obj.optString("token")
                        if (!Regex("^[A-Za-z0-9_-]{43}$").matches(bearer)) {
                            status.text = "服务器没有返回有效登录令牌，请确认部署了新版服务端"
                            return@onSuccess
                        }
                        VoiceApi.prefs(this).edit()
                            .putString("base", url)
                            .putString("username", name)
                            .putString("mobileAuth", bearer)
                            .remove("auth")
                            .apply()
                        password.text.clear()
                        notify("后台登录成功，正在绑定消息推送")
                        navigate("home")
                        bindPushAfterLogin(url, bearer)
                    }.onFailure {
                        status.text = "登录失败：" + (it.message ?: "服务器连接异常")
                    }
                }
            }.start()
        }
        action("在浏览器打开管理后台") { browse(site.text.toString().trim().trimEnd('/') + "/admin") }
    }

    private fun bindPushAfterLogin(url: String, bearer: String) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                notify("后台已登录；Firebase 推送暂未绑定，可从首页重新绑定")
                return@addOnCompleteListener
            }
            val fcmToken = task.result
            if (fcmToken.isNullOrBlank()) {
                notify("后台已登录；FCM Token 为空，请从首页重新绑定")
                return@addOnCompleteListener
            }
            Thread {
                val result = runCatching {
                    VoiceApi.post(url, "/api/mobile/device",
                        JSONObject().put("fcmToken", fcmToken), bearer)
                }
                runOnUiThread {
                    result.onSuccess { obj ->
                        // Do not restore a device token if the user logged out meanwhile.
                        if (VoiceApi.mobileAuth(this) == bearer) {
                            VoiceApi.prefs(this).edit()
                                .putString("auth", obj.optString("deviceAuth")).apply()
                            notify("消息推送和来电已绑定成功")
                        }
                    }.onFailure {
                        notify("后台已登录，但推送绑定失败：" + (it.message ?: "网络异常"))
                    }
                }
            }.start()
        }
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

    private fun shell(title:String) { screen(title) }
    private fun navigate(next:String) {
        page=next
        val heading=when(next){
            "home"->"概览";"requests"->"挪车请求";"calls"->"来电记录"
            "channels"->"通知中心";"settings"->"设置";"account"->"账户安全"
            else->"车主中心"
        }
        screen(heading)
        inCard{ note("正在同步车主数据…") }
        when(next) {
            "home" -> api("/api/mobile/config"){if(page==next)home(it)}
            "requests" -> loadRequests()
            "calls" -> api("/api/mobile/calls"){if(page==next)calls(it)}
            "channels" -> api("/api/mobile/config"){if(page==next)channels(it)}
            "settings" -> api("/api/mobile/config"){if(page==next)settings(it)}
            "account" -> api("/api/mobile/config"){if(page==next)account(it)}
        }
    }
    private fun home(config:JSONObject) {
        shell("概览")
        val channel=config.getJSONObject("channels")
        val app=channel.getJSONObject("app")
        val paired=app.optBoolean("configured")&&app.optBoolean("enabled")
        val banner=OwnerUi.vertical(this).apply {
            background=OwnerUi.gradient(this@MainActivity)
            setPadding(px(22),px(22),px(22),px(21))
        }
        banner.addView(OwnerUi.label(this,"车主中心 · 在线守候",12f,0xFFE4EFFF.toInt(),true))
        banner.addView(OwnerUi.label(this,config.optString("siteName","MoveCar"),
            25f,OwnerUi.white,true).apply{setPadding(0,px(8),0,px(6))})
        banner.addView(OwnerUi.label(this,"扫码挪车、语音来电、消息提醒，一处管理",
            13f,0xFFE1EAFF.toInt()))
        val stats=OwnerUi.horizontal(this).apply {
            setPadding(0,px(18),0,0)
        }
        for((number,label) in listOf(config.optInt("requestCount").toString() to "挪车记录",
                        (if(paired)"已连接" else "待配置") to "推送状态")){
            val item=OwnerUi.vertical(this)
            item.addView(OwnerUi.label(this,number,21f,OwnerUi.white,true))
            item.addView(OwnerUi.label(this,label,11f,0xFFDEEAFF.toInt()))
            stats.addView(item,LinearLayout.LayoutParams(0,-2,1f))
        }
        banner.addView(stats)
        root.addView(banner,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(22)})

        section("快捷操作","最常用的操作，随手即达")
        fun shortcut(caption:String,detail:String,icon:Int,click:()->Unit):LinearLayout =
            OwnerUi.vertical(this).apply{
                background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,18,OwnerUi.line)
                setPadding(px(14),px(17),px(13),px(15))
                elevation=px(1).toFloat()
                isClickable=true;isFocusable=true;setOnClickListener{click()}
                addView(OwnerUi.icon(this@MainActivity,icon,OwnerUi.blue,26))
                addView(OwnerUi.label(this@MainActivity,caption,15f,OwnerUi.navy,true).apply{
                    setPadding(0,px(12),0,px(2))
                })
                addView(OwnerUi.label(this@MainActivity,detail,12f,OwnerUi.muted))
            }
        val grid1=OwnerUi.horizontal(this)
        grid1.addView(shortcut("挪车请求","确认或处理留言",android.R.drawable.ic_menu_agenda){navigate("requests")},
            LinearLayout.LayoutParams(0,px(136),1f).apply{marginEnd=px(7)})
        grid1.addView(shortcut("匿名通话","查看来电历史",android.R.drawable.sym_action_call){navigate("calls")},
            LinearLayout.LayoutParams(0,px(136),1f).apply{marginStart=px(7)})
        root.addView(grid1,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(14)})
        val grid2=OwnerUi.horizontal(this)
        grid2.addView(shortcut("测试通知","确认推送已送达",android.R.drawable.ic_dialog_email){testChannel("app")},
            LinearLayout.LayoutParams(0,px(136),1f).apply{marginEnd=px(7)})
        grid2.addView(shortcut("渠道设置","选择推送方式",android.R.drawable.ic_menu_manage){navigate("channels")},
            LinearLayout.LayoutParams(0,px(136),1f).apply{marginStart=px(7)})
        root.addView(grid2,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(18)})

        section("连接状态")
        inCard {
            status(if(paired)"● FCM 消息推送已启用" else "● FCM 推送尚未就绪",paired)
            note("账号："+config.optString("username","admin"))
            note("网站："+base())
            note("设备推送："+if(app.optBoolean("configured"))"已绑定" else "尚未绑定")
            action("重新绑定推送") {syncFcm()}
        }
        section("其他")
        inCard {action("打开网页版管理后台 ↗") {browse(base()+"/admin")}}
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
        val requestedPage=historyPage
        api("/api/mobile/requests?page="+requestedPage+"&size=20"){result->
            if(page!="requests"||historyPage!=requestedPage)return@api
            shell("挪车请求")
            val total=result.optInt("total")
            section("请求记录", "共 "+total+" 条 · 第 "+historyPage+" 页")
            inCard{
                action("⟳  刷新请求列表"){loadRequests()}
            }
            val items=result.optJSONArray("items")
            if(items==null||items.length()==0) {
                empty("目前没有挪车请求","收到新的扫码留言后，会显示在这里。")
            }else for(i in 0 until items.length()){
                val item=items.getJSONObject(i)
                val id=item.getString("id")
                val state=item.optString("status")
                val desc=when(state){
                    "waiting"->"待处理"
                    "confirmed"->"已确认"
                    "expired"->"已过期"
                    else->state
                }
                inCard{
                    val heading=OwnerUi.horizontal(this@MainActivity)
                    val date=DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT)
                        .format(Date(item.optLong("createdAt")))
                    heading.addView(OwnerUi.label(this@MainActivity,date,13f,OwnerUi.muted),
                        LinearLayout.LayoutParams(0,-2,1f))
                    heading.addView(OwnerUi.pill(this@MainActivity,desc,
                        if(state=="confirmed")true else if(state=="waiting")false else null))
                    root.addView(heading)
                    title(item.optString("message").ifBlank{"有人请求挪车"},16f)
                    if(item.optBoolean("photoSent"))note("已提交现场照片")
                    val photo=item.optString("photoUrl")
                    if(photo.startsWith("/"))
                        action("查看现场照片 ↗"){browse(base()+photo)}
                    if(state=="waiting")
                        action("确认已收到挪车请求",primary=true){
                            api("/api/mobile/requests/confirm",JSONObject().put("id",id)){
                                notify("挪车请求已确认");loadRequests()
                            }
                        }
                    action("删除这条记录",danger=true){confirm("删除该条挪车记录及照片？"){
                        api("/api/mobile/requests/delete",JSONObject().put("id",id)){loadRequests()}
                    }}
                }
            }
            if(historyPage>1)action("← 上一页"){historyPage--;loadRequests()}
            if(historyPage*20<total)action("下一页 →"){historyPage++;loadRequests()}
            spacer(15)
            inCard{
                title("管理数据",15f)
                note("清空操作无法恢复，建议先确认无待处理请求。")
                action("清空全部挪车记录",danger=true){
                    confirm("确认永久删除全部挪车记录和关联照片？"){
                        api("/api/mobile/requests/clear",JSONObject().put("confirm",true)){
                            historyPage=1;loadRequests()
                        }
                    }
                }
            }
        }
    }
    private fun confirm(message:String,yes:()->Unit){AlertDialog.Builder(this).setMessage(message).setNegativeButton("取消",null).setPositiveButton("确定") {_,_->yes()}.show()}
    private fun calls(result:JSONObject){
        shell("来电记录")
        section("匿名语音历史","来电接听状态由 MoveCar 服务器记录")
        inCard{action("⟳  刷新通话记录"){navigate("calls")}}
        val items=result.optJSONArray("items")
        if(items==null||items.length()==0){
            empty("暂无通话记录","扫码者通过网页呼叫后，记录会自动显示。")
            return
        }
        for(i in 0 until items.length()){
            val item=items.getJSONObject(i)
            val raw=item.optString("status")
            val state=when(raw){
                "ringing"->"振铃中"
                "active"->"已接通"
                "missed"->"未接听"
                "ended"->"已结束"
                "rejected"->"已拒绝"
                "failed"->"呼叫失败"
                else->raw
            }
            inCard{
                val header=OwnerUi.horizontal(this@MainActivity)
                val icon=OwnerUi.icon(this@MainActivity,
                    android.R.drawable.sym_action_call,
                    if(raw=="missed"||raw=="rejected")OwnerUi.red else OwnerUi.blue,26)
                header.addView(icon)
                val content=OwnerUi.vertical(this@MainActivity).apply{
                    setPadding(px(15),0,0,0)
                }
                content.addView(OwnerUi.label(this@MainActivity,
                    "匿名网络语音",16f,OwnerUi.navy,true))
                val date=DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT)
                    .format(Date(item.optLong("startedAt")))
                content.addView(OwnerUi.label(this@MainActivity,date,12f,OwnerUi.muted))
                header.addView(content,LinearLayout.LayoutParams(0,-2,1f))
                header.addView(OwnerUi.pill(this@MainActivity,state,raw=="ended"||raw=="active"))
                root.addView(header)
            }
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