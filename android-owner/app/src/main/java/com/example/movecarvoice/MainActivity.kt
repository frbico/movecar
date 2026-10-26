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
import android.os.Handler
import android.os.Looper
import android.view.WindowInsets
import android.view.View
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
    private val iconPicker = 120
    private val refreshHandler = Handler(Looper.getMainLooper())
    private var loadingPath: String? = null
    private val periodicRefresh = object : Runnable {
        override fun run() {
            if (!isFinishing && page != "login" && token().isNotEmpty()) refreshCurrent(false)
            refreshHandler.postDelayed(this, 120_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        }
        if (VoiceApi.mobileAuth(this).isEmpty()) loginPage() else {
            navigate(if(intent.getStringExtra("openPage")=="requests")"requests" else "home")
        }
    }


    override fun onResume() {
        super.onResume()
        refreshHandler.removeCallbacks(periodicRefresh)
        refreshHandler.postDelayed(periodicRefresh, 120_000)
        // Returning from system notification/full-screen settings must
        // re-read actual OS grants instead of displaying cached checkmarks.
        if ((page=="settings_permissions" || page=="home") && token().isNotBlank())
            refreshHandler.post { if(page=="settings_permissions" || page=="home")refreshCurrent(false) }
        if (page!="login" && token().isNotBlank())
            refreshHandler.post { if(!isFinishing && page!="login")promptCallPermissionsIfNeeded() }
    }
    override fun onPause() {
        refreshHandler.removeCallbacks(periodicRefresh)
        super.onPause()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getStringExtra("openPage") == "requests" && token().isNotBlank()) {
            OwnerCache.invalidate(this)
            historyPage=1
            navigate("requests")
        }
    }
    @Deprecated("Uses platform back handling without an extra dependency")
    override fun onBackPressed() {
        val parent=when {
            page.startsWith("channel_")->"channels"
            page=="account"||page=="device"||page.startsWith("settings_")->"settings"
            page!="home"&&page!="login"->"home"
            else->null
        }
        if(parent==null)super.onBackPressed() else navigate(parent)
    }
    private fun px(value: Int) = OwnerUi.dp(this, value)
    private fun spacer(size: Int = 12) {
        root.addView(android.view.View(this), LinearLayout.LayoutParams(1, px(size)))
    }
    private fun screen(heading: String) {
        window.statusBarColor = if(Build.VERSION.SDK_INT>=35) android.graphics.Color.TRANSPARENT else OwnerUi.canvas
        window.navigationBarColor = if(Build.VERSION.SDK_INT>=35) android.graphics.Color.TRANSPARENT else OwnerUi.white
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility =
            android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
            android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

        val frame = OwnerUi.vertical(this).apply { setBackgroundColor(OwnerUi.canvas) }
        // Android 15 enforces edge-to-edge. The top toolbar and the bottom nav
        // must reserve physical system-bar insets on every device.
        if (Build.VERSION.SDK_INT >= 35) {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
                View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            frame.setOnApplyWindowInsetsListener { v, insets ->
                val bars=insets.getInsets(WindowInsets.Type.systemBars())
                v.setPadding(0, bars.top, 0, bars.bottom)
                insets
            }
        }
        val top = OwnerUi.horizontal(this).apply {
            setPadding(px(20), px(24), px(20), px(20))
        }
        val parent=when {
            page.startsWith("channel_")->"channels"
            page=="account"||page.startsWith("settings_")||page=="device"->"settings"
            else->null
        }
        if(parent!=null)top.addView(OwnerUi.horizontal(this).apply {
            gravity=Gravity.CENTER
            addView(OwnerUi.icon(this@MainActivity,R.drawable.ic_chevron_left,OwnerUi.navy,22))
            contentDescription="返回"
            isClickable=true;isFocusable=true
            setOnClickListener{navigate(parent)}
        },LinearLayout.LayoutParams(px(40),px(44)))
        val headingCol = OwnerUi.vertical(this).apply {
            setPadding(if(parent==null)px(2) else 0, 0, 0, 0)
            if(parent!=null)gravity=Gravity.CENTER
        }
        if(page=="home")headingCol.addView(OwnerUi.label(this,"车主中心",13f,OwnerUi.muted).apply{
            setPadding(0,0,0,px(6))
        })
        headingCol.addView(OwnerUi.headline(this,heading,if(parent==null)32f else 23f).apply {
            if(parent!=null)gravity=Gravity.CENTER
        })
        top.addView(headingCol, LinearLayout.LayoutParams(0, -2, 1f))
        if (page=="home" || page=="channels") top.addView(OwnerUi.icon(this,R.drawable.ic_refresh,OwnerUi.navy,21).apply {
            setPadding(px(11),px(11),px(11),px(11))
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,16,OwnerUi.line)
            isClickable=true;isFocusable=true
            contentDescription="手动同步当前页面"
            setOnClickListener{refreshCurrent(true);notify("已请求同步最新数据")}
        },LinearLayout.LayoutParams(px(44),px(44)))
        else if(parent!=null)top.addView(View(this),LinearLayout.LayoutParams(px(40),px(44)))
        frame.addView(top)

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
        }
        root = OwnerUi.vertical(this).apply {
            setPadding(px(20), px(2), px(20), px(24))
        }
        scroll.addView(root, android.widget.FrameLayout.LayoutParams(-1, -2))
        frame.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        if (page != "login") frame.addView(bottomNav(),LinearLayout.LayoutParams(-1,-2))
        setContentView(frame)
    }

    private fun bottomNav(): LinearLayout {
        val bar=OwnerUi.horizontal(this).apply {
            background=OwnerUi.bg(OwnerUi.white,24,this@MainActivity,OwnerUi.line).apply {
                cornerRadii=floatArrayOf(px(24).toFloat(),px(24).toFloat(),
                    px(24).toFloat(),px(24).toFloat(),0f,0f,0f,0f)
            }
            setPadding(px(8), px(5), px(8), px(4))
            elevation=0f
        }
        val tabs=listOf(
            Triple("首页", "home", R.drawable.ic_nav_home),
            Triple("挪车", "requests", R.drawable.ic_nav_car),
            Triple("通话", "calls", R.drawable.ic_nav_call),
            Triple("通知", "channels", R.drawable.ic_nav_bell),
            Triple("设置", "settings", R.drawable.ic_nav_settings)
        )
        for ((label, route, icon) in tabs) {
            val selected=page==route || (route=="settings"&&(page=="account"||page=="device"||page.startsWith("settings_"))) ||
                (route=="channels"&&page.startsWith("channel_"))
            val color=if(selected) OwnerUi.navy else OwnerUi.muted
            val item=OwnerUi.vertical(this).apply {
                gravity=Gravity.CENTER
                setPadding(px(3), px(5), px(3), px(3))
                background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,12)
                isClickable=true
                isFocusable=true
                contentDescription="切换到"+label
                setOnClickListener { if(page!=route)navigate(route) else refreshCurrent(true) }
            }
            val iconBox=OwnerUi.horizontal(this).apply{
                gravity=Gravity.CENTER
                background=OwnerUi.bg(if(selected)OwnerUi.softAmber else OwnerUi.white,23,this@MainActivity)
            }
            iconBox.addView(OwnerUi.icon(this,icon,color,23))
            item.addView(iconBox,LinearLayout.LayoutParams(px(42),px(42)))
            item.addView(OwnerUi.label(this,label,11f,color,selected).apply {
                gravity=Gravity.CENTER
                setPadding(0,px(3),0,0)
            })
            bar.addView(item,LinearLayout.LayoutParams(0,px(68),1f).apply {
                marginStart=px(2);marginEnd=px(2)
            })
        }
        return bar
    }

    private fun title(value: String, size: Float = 18f) {
        root.addView(OwnerUi.headline(this, value, size).apply {
            setPadding(0, px(11), 0, px(5))
        },LinearLayout.LayoutParams(-1,-2))
    }
    private fun note(value: String) {
        root.addView(OwnerUi.label(this, value, 13.5f, OwnerUi.muted).apply {
            setLineSpacing(px(2).toFloat(),1f)
            setPadding(0, px(2), 0, px(5))
        },LinearLayout.LayoutParams(-1,-2))
    }
    private inline fun <T> inCard(block: () -> T): T {
        val holder=OwnerUi.card(this)
        root.addView(holder,LinearLayout.LayoutParams(-1,-2).apply{
            bottomMargin=px(12)
        })
        val previous=root
        root=holder
        return try{block()}finally{root=previous}
    }
    private fun section(heading:String,caption:String="") {
        title(heading,20f)
        if(caption.isNotBlank())note(caption)
    }
    private inline fun menuGroup(block:()->Unit){
        val holder=OwnerUi.vertical(this).apply{
            background=OwnerUi.bg(OwnerUi.white,18,this@MainActivity,OwnerUi.line)
            clipToOutline=true
        }
        root.addView(holder,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(10)})
        val previous=root
        root=holder
        try{block()}finally{root=previous}
    }
    private fun menuRow(heading:String,detail:String,last:Boolean=false,onClick:()->Unit) {
        val row=OwnerUi.horizontal(this).apply {
            setPadding(px(17),px(14),px(17),px(14))
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,0)
            isClickable=true;isFocusable=true
            contentDescription="$heading，$detail"
            setOnClickListener{onClick()}
        }
        val labels=OwnerUi.vertical(this)
        labels.addView(OwnerUi.label(this,heading,15f,OwnerUi.navy,true))
        if(detail.isNotBlank())labels.addView(OwnerUi.label(this,detail,12.5f,OwnerUi.muted).apply{
            setPadding(0,px(3),0,0)
        })
        row.addView(labels,LinearLayout.LayoutParams(0,-2,1f))
        row.addView(OwnerUi.icon(this,R.drawable.ic_chevron_right,OwnerUi.muted,20))
        root.addView(row,LinearLayout.LayoutParams(-1,-2))
        if(!last)root.addView(OwnerUi.line(this),LinearLayout.LayoutParams(-1,px(1)).apply{
            marginStart=px(17);marginEnd=px(17)
        })
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
            background=OwnerUi.bg(OwnerUi.white,14,this@MainActivity,OwnerUi.inputLine)
            setPadding(px(13),px(12),px(13),px(12))
            minHeight=px(51)
            if(password)inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        block.addView(edit,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(7)})
        root.addView(block,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(10)})
        return edit
    }
    private fun iconField(hint:String,value:String,icon:Int,surface:Int):EditText {
        val row=OwnerUi.horizontal(this).apply{gravity=Gravity.TOP}
        row.addView(OwnerUi.iconCircle(this,icon,surface,40),
            LinearLayout.LayoutParams(px(40),px(40)).apply{marginEnd=px(14)})
        val content=OwnerUi.vertical(this)
        val previous=root
        root=content
        val input=try{field(hint,value)}finally{root=previous}
        input.inputType=InputType.TYPE_CLASS_NUMBER
        row.addView(content,LinearLayout.LayoutParams(0,-2,1f))
        root.addView(row,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(15)})
        return input
    }
    private fun noticeStrip(text:String,icon:Int,surface:Int,tint:Int):LinearLayout =
        OwnerUi.horizontal(this).apply {
            minimumHeight=px(48)
            background=OwnerUi.bg(surface,12,this@MainActivity)
            setPadding(px(14),px(11),px(14),px(11))
            addView(OwnerUi.icon(this@MainActivity,icon,tint,19),
                LinearLayout.LayoutParams(px(19),px(19)).apply{marginEnd=px(12)})
            addView(OwnerUi.label(this@MainActivity,text,12.5f,OwnerUi.navy),
                LinearLayout.LayoutParams(0,-2,1f))
        }
    private fun check(label:String,enabled:Boolean):Switch =
        Switch(this).also {
            it.text=label
            it.textSize=14f
            it.setTextColor(OwnerUi.navy)
            it.isChecked=enabled
            it.minHeight=px(52)
            it.showText=false
            it.thumbTintList=android.content.res.ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked),intArrayOf()),
                intArrayOf(OwnerUi.green,OwnerUi.muted))
            root.addView(it,LinearLayout.LayoutParams(-1,-2))
        }
    private fun action(label:String,primary:Boolean=false,danger:Boolean=false,callback:()->Unit) {
        val surface=if(primary)OwnerUi.green else OwnerUi.white
        val foreground=if(primary)OwnerUi.white else if(danger)OwnerUi.red else OwnerUi.blueDeep
        val button=(if(primary)OwnerUi.headline(this,label,16f,foreground)
            else OwnerUi.label(this,label,15f,foreground,true)).apply {
            gravity=Gravity.CENTER
            minHeight=px(50)
            setPadding(px(14),px(12),px(14),px(12))
            background=OwnerUi.pressable(this@MainActivity,surface,17,
                if(primary)null else if(danger)OwnerUi.inputLine else OwnerUi.line)
            isClickable=true
            isFocusable=true
            setOnClickListener{callback()}
        }
        root.addView(button,LinearLayout.LayoutParams(-1,-2).apply {
            topMargin=px(3);bottomMargin=px(3)
        })
    }
    private fun status(text:String,good:Boolean?=null) {
        root.addView(OwnerUi.pill(this,text,good),LinearLayout.LayoutParams(-2,-2).apply{
            topMargin=px(2);bottomMargin=px(5)
        })
    }
    private fun helpIcon(title:String,explanation:String):TextView =
        OwnerUi.label(this,"?",15f,OwnerUi.muted,true).apply {
            gravity=Gravity.CENTER
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,20,OwnerUi.line)
            isClickable=true;isFocusable=true
            contentDescription="关于$title"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle(title)
                    .setMessage(explanation).setPositiveButton("知道了",null).show()
            }
        }
    private fun permissionRow(label:String,enabled:Boolean,help:String,onClick:()->Unit) {
        val row=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
        val state=if(enabled)"已开启" else "去开启"
        val main=OwnerUi.horizontal(this).apply {
            gravity=Gravity.CENTER_VERTICAL
            minimumHeight=px(60)
            isClickable=true;isFocusable=true
            contentDescription="$label，$state"
            setOnClickListener{onClick()}
        }
        main.addView(OwnerUi.label(this,label,15f,OwnerUi.navy,true),
            LinearLayout.LayoutParams(0,-2,1f))
        main.addView(OwnerUi.label(this,state,13f,if(enabled)OwnerUi.green else OwnerUi.amber,true))
        main.addView(OwnerUi.icon(this,R.drawable.ic_chevron_right,OwnerUi.muted,18),
            LinearLayout.LayoutParams(px(18),px(18)).apply{marginStart=px(7)})
        row.addView(main,LinearLayout.LayoutParams(0,-2,1f))
        row.addView(helpIcon(label,help),LinearLayout.LayoutParams(px(32),px(32)).apply{marginStart=px(10)})
        root.addView(row,LinearLayout.LayoutParams(-1,-2))
        root.addView(OwnerUi.line(this),LinearLayout.LayoutParams(-1,px(1)))
    }
    private fun empty(heading:String,description:String){
        inCard {root.addView(OwnerUi.centerEmpty(this,heading,description))}
    }
    private fun notify(message: String) { Toast.makeText(this,message,Toast.LENGTH_LONG).show() }
    private fun base() = VoiceApi.base(this)
    private fun fetchPage(path: String, force: Boolean = false, render: (JSONObject)->Unit) {
        val cached=OwnerCache.get(this,path)
        if(cached!=null)render(cached)
        else if(!force)note("首次加载中，数据将保存到本机…")
        if(!force && OwnerCache.fresh(this,path))return
        if(loadingPath==path)return
        loadingPath=path
        api(path){ data ->
            loadingPath=null
            OwnerCache.put(this,path,data)
            render(data)
        }
    }
    private fun refreshCurrent(force: Boolean) {
        when(page) {
            "requests" -> loadRequests(force)
            "calls" -> fetchPage("/api/mobile/calls",force){if(page=="calls")calls(it)}
            "home","channels","settings","account","device","settings_site","settings_calls",
            "settings_icon","settings_update","settings_permissions","channel_app","channel_bark",
            "channel_sc3","channel_serverchan" -> {
                val current=page
                fetchPage("/api/mobile/config",force){if(page==current)renderConfig(current,it)}
            }
        }
    }
    private fun renderConfig(destination:String,data:JSONObject) {
        when(destination){
            "home"->home(data)
            "channels"->channels(data)
            "settings"->settings(data)
            "account"->account(data)
            "device"->device(data)
            "settings_site"->settingsSite(data)
            "settings_calls"->settingsCalls(data)
            "settings_icon"->settingsIcon(data)
            "settings_update"->settingsUpdate()
            "settings_permissions"->settingsPermissions()
            "channel_app","channel_bark","channel_sc3","channel_serverchan"->channelDetail(destination.removePrefix("channel_"),data)
        }
    }
    private fun token() = VoiceApi.mobileAuth(this)
    private fun api(path:String, body:JSONObject?=null, done:(JSONObject)->Unit) {
        val host=base();val bearer=token()
        Thread {
            val result=runCatching {
                if(body==null)VoiceApi.get(host,path,bearer)
                else VoiceApi.post(host,path,body,bearer)
            }
            runOnUiThread {
                result.onSuccess {
                    if(body!=null)OwnerCache.invalidate(this)
                    done(it)
                }.onFailure {
                    if(body==null)loadingPath=null
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
            setPadding(px(22),px(24),px(22),px(24))
        }
        welcome.addView(OwnerUi.label(this,"MoveCar 车主端",12f,OwnerUi.blueDeep,true))
        welcome.addView(OwnerUi.label(this,"安心联系，及时挪车",24f,OwnerUi.navy,true).apply {
            setPadding(0,px(10),0,0)
        })
        root.addView(welcome,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(17)})
        section("欢迎回来")
        val credentials=inCard {
            Triple(field("HTTPS 服务器地址", base()),
                field("管理员账号", VoiceApi.username(this)),
                field("管理员密码", password = true))
        }
        val site=credentials.first
        val username=credentials.second
        val password=credentials.third
        val status = TextView(this).apply {
            text = ""
            textSize = 13f
            setTextColor(OwnerUi.muted)
            setPadding(px(5), px(8), px(5), px(12))
        }
        root.addView(status)
        val login=Button(this).apply {
            text="登录车主中心"
            isAllCaps=false
            textSize=16f
            setTextColor(OwnerUi.white)
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.green,18)
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
                        OwnerCache.invalidate(this)
                        notify("后台登录成功，正在绑定消息推送")
                        navigate("home")
                        window.decorView.post { promptCallPermissionsIfNeeded() }
                        bindPushAfterLogin(url, bearer)
                    }.onFailure {
                        status.text = "登录失败：" + (it.message ?: "服务器连接异常")
                    }
                }
            }.start()
        }
        action("打开管理后台") {
            runCatching { VoiceApi.normalizeBase(site.text.toString()) }
                .onSuccess { browse(it+"/admin") }
                .onFailure { notify("请先填写 HTTPS 服务器地址") }
        }
    }

    private fun bindPushAfterLogin(url: String, bearer: String) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                notify("推送绑定未完成，请在设置中重新绑定")
                return@addOnCompleteListener
            }
            val fcmToken = task.result
            if (fcmToken.isNullOrBlank()) {
                notify("推送绑定未完成，请在设置中重新绑定")
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
            runOnUiThread{result.onSuccess{notify("站点图标已更新");navigate("settings_icon")}.onFailure{notify("图标上传失败："+it.message)}}
        }.start()
    }

    private fun shell(title:String) { screen(title) }
    private fun navigate(next:String) {
        page=next
        val heading=when(next){
            "home"->"概览";"requests"->"挪车请求";"calls"->"来电记录"
            "channels"->"通知";"settings"->"设置";"account"->"账户安全"
            "device"->"设备与服务";"settings_site"->"站点与记录";"settings_calls"->"通话规则"
            "settings_icon"->"网站图标";"settings_update"->"版本更新";"settings_permissions"->"来电权限"
            "channel_app"->"APP 通知";"channel_bark"->"Bark 通知"
            "channel_sc3"->"Server酱³";"channel_serverchan"->"微信通知"
            else->"车主中心"
        }
        screen(heading)
        refreshCurrent(false)
    }
    private fun home(config:JSONObject) {
        shell("概览")
        if(Build.VERSION.SDK_INT>=26){
            CarMessagingService.ensureIncomingCallChannel(this)
            val manager=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            val ready=manager.areNotificationsEnabled() &&
                (manager.getNotificationChannel(CarMessagingService.CHANNEL)?.importance?:0)>=
                android.app.NotificationManager.IMPORTANCE_HIGH &&
                (Build.VERSION.SDK_INT<34 || manager.canUseFullScreenIntent())
            if(!ready){
                val warning=OwnerUi.horizontal(this).apply {
                    gravity=Gravity.CENTER_VERTICAL
                    setPadding(px(14),px(10),px(14),px(10))
                    minimumHeight=px(48)
                    background=OwnerUi.pressable(this@MainActivity,OwnerUi.warningSurface,14)
                    isClickable=true;isFocusable=true
                    contentDescription="来电亮屏权限未开启，前往设置"
                    setOnClickListener{navigate("settings_permissions")}
                }
                warning.addView(OwnerUi.label(this,"!",16f,OwnerUi.amber,true).apply{
                    gravity=Gravity.CENTER
                    background=OwnerUi.bg(OwnerUi.white,18,this@MainActivity)
                },LinearLayout.LayoutParams(px(30),px(30)).apply{marginEnd=px(10)})
                warning.addView(OwnerUi.label(this,"来电亮屏权限未开启",13.5f,OwnerUi.navy,true),
                    LinearLayout.LayoutParams(0,-2,1f))
                warning.addView(OwnerUi.icon(this,R.drawable.ic_chevron_right,OwnerUi.muted,18))
                root.addView(warning,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(12)})
            }
        }
        val channel=config.getJSONObject("channels")
        val app=channel.getJSONObject("app")
        val paired=app.optBoolean("configured")&&app.optBoolean("enabled")
        val count=config.optInt("requestCount")
        val limit=config.optInt("requestRetentionLimit",50)
        val banner=OwnerUi.vertical(this).apply {
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,22,OwnerUi.line)
            setPadding(px(20),px(26),px(20),px(18))
            isClickable=true;isFocusable=true
            contentDescription="查看挪车记录，共 $count 条"
            setOnClickListener{navigate("requests")}
        }
        val hero=OwnerUi.horizontal(this)
        val heroText=OwnerUi.vertical(this)
        heroText.addView(OwnerUi.headline(this,config.optString("siteName","呼叫车主挪车"),
            24f).apply{maxLines=2})
        heroText.addView(OwnerUi.pill(this,if(paired)"●  通知已开启" else "●  通知待配置",paired).apply{
            setPadding(px(11),px(6),px(11),px(6))
        },LinearLayout.LayoutParams(-2,-2).apply{topMargin=px(18)})
        hero.addView(heroText,LinearLayout.LayoutParams(0,-2,1f))
        hero.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_hero_car)
            scaleType=ImageView.ScaleType.FIT_CENTER
            contentDescription=null
        },LinearLayout.LayoutParams(px(96),px(76)).apply{marginStart=px(4)})
        banner.addView(hero)
        banner.addView(OwnerUi.line(this),LinearLayout.LayoutParams(-1,px(1)).apply{topMargin=px(20)})
        val footer=OwnerUi.horizontal(this).apply{gravity=Gravity.RIGHT or Gravity.CENTER_VERTICAL}
        footer.addView(OwnerUi.label(this,"$count / $limit 条记录",13f,OwnerUi.muted))
        footer.addView(OwnerUi.icon(this,R.drawable.ic_chevron_right,OwnerUi.muted,20),
            LinearLayout.LayoutParams(px(20),px(20)).apply{marginStart=px(8)})
        banner.addView(footer,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(10)})
        root.addView(banner,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(22)})

        section("快捷入口")
        fun tile(caption:String,value:String,detail:String,tint:Int,icon:Int,click:()->Unit):LinearLayout =
            OwnerUi.vertical(this).apply {
                background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,20,OwnerUi.line)
                setPadding(px(16),px(18),px(16),px(17))
                minimumHeight=px(158)
                isClickable=true;isFocusable=true
                contentDescription="$caption，$value，$detail"
                setOnClickListener { click() }
                addView(OwnerUi.iconCircle(this@MainActivity,icon,tint,44),
                    LinearLayout.LayoutParams(px(44),px(44)))
                addView(OwnerUi.headline(this@MainActivity,caption,16f).apply {
                    setPadding(0,px(15),0,px(5))
                })
                val valueRow=OwnerUi.horizontal(this@MainActivity)
                valueRow.addView(OwnerUi.headline(this@MainActivity,value,25f),
                    LinearLayout.LayoutParams(0,-2,1f))
                valueRow.addView(OwnerUi.icon(this@MainActivity,
                    R.drawable.ic_chevron_right,OwnerUi.muted,19))
                addView(valueRow)
                addView(OwnerUi.label(this@MainActivity,detail,13f,OwnerUi.muted).apply{
                    maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END
                    setPadding(0,px(5),0,0)
                })
            }
        fun tileRow(left:LinearLayout,right:LinearLayout) {
            val row=OwnerUi.horizontal(this)
            row.addView(left,LinearLayout.LayoutParams(0,-2,1f).apply{marginEnd=px(6)})
            row.addView(right,LinearLayout.LayoutParams(0,-2,1f).apply{marginStart=px(6)})
            root.addView(row,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(12)})
        }
        tileRow(
            tile("挪车请求","$count 条","查看与确认留言",OwnerUi.softBlue,
                R.drawable.ic_nav_car){navigate("requests")},
            tile("来电记录","查看","匿名语音联系",OwnerUi.softGreen,
                R.drawable.ic_nav_call){navigate("calls")}
        )
        tileRow(
            tile("消息通知",if(paired)"已连接" else "待配置","管理接收渠道",OwnerUi.softAmber,
                R.drawable.ic_nav_bell){navigate("channels")},
            tile("站点设置","管理","名称、联系与安全",OwnerUi.softRed,
                R.drawable.ic_nav_settings){navigate("settings")}
        )

    }
    private fun syncFcm(){
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if(!task.isSuccessful){notify("无法绑定手机推送");return@addOnCompleteListener}
            api("/api/mobile/device",JSONObject().put("fcmToken",task.result)) {
                VoiceApi.prefs(this).edit().putString("auth",it.optString("deviceAuth")).apply()
                notify("手机推送已重新绑定")
                refreshCurrent(true)
            }
        }
    }
    private fun compactControl(text:String, color:Int=OwnerUi.blue, task:()->Unit):TextView =
        OwnerUi.label(this,text,12.5f,color,true).apply {
            minHeight=px(44)
            setPadding(px(12),px(8),px(12),px(8))
            gravity=Gravity.CENTER
            isClickable=true;isFocusable=true
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,7)
            setOnClickListener{task()}
        }
    private fun requestButton(text:String,primary:Boolean=false,danger:Boolean=false,task:()->Unit):TextView =
        (if(primary)OwnerUi.headline(this,text,14f,OwnerUi.white)
            else OwnerUi.label(this,text,13.5f,
                if(danger)OwnerUi.red else OwnerUi.blueDeep,true)).apply {
            gravity=Gravity.CENTER
            minHeight=px(44)
            setPadding(px(10),px(9),px(10),px(9))
            background=OwnerUi.pressable(this@MainActivity,
                if(primary)OwnerUi.green else if(danger)OwnerUi.softRed else OwnerUi.white,12,
                if(primary)null else if(danger)OwnerUi.softRed else OwnerUi.line)
            isClickable=true;isFocusable=true
            setOnClickListener{task()}
        }
    private fun deleteControl(text:String,task:()->Unit):LinearLayout =
        OwnerUi.horizontal(this).apply {
            minimumHeight=px(44)
            setPadding(px(2),px(8),px(6),px(8))
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,10)
            addView(OwnerUi.icon(this@MainActivity,R.drawable.ic_trash,OwnerUi.red,19))
            addView(OwnerUi.label(this@MainActivity,text,13.5f,OwnerUi.red,true).apply{
                setPadding(px(8),0,0,0)
            })
            isClickable=true;isFocusable=true
            contentDescription=text
            setOnClickListener{task()}
        }

    private fun formattedTime(time:Long):String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM,DateFormat.SHORT)
            .format(Date(time))

    private fun loadRequests(force:Boolean=false){
        val requestedPage=historyPage
        fetchPage("/api/mobile/requests?page="+requestedPage+"&size=20",force){result->
            if(page!="requests"||historyPage!=requestedPage)return@fetchPage
            shell("挪车请求")
            val total=result.optInt("total")
            note("共 $total 条 · 第 $historyPage 页")
            val items=result.optJSONArray("items")
            if(items==null||items.length()==0){
                empty("目前没有挪车请求","收到扫码留言后，这里将自动保存记录。")
            }else {
                for(i in 0 until items.length()){
                    val item=items.getJSONObject(i)
                    val id=item.optString("id")
                    val state=item.optString("status")
                    val label=when(state){"waiting"->"待处理";"confirmed"->"已确认";"expired"->"已过期";else->state}
                    val itemRow=OwnerUi.vertical(this@MainActivity)
                    val header=OwnerUi.horizontal(this@MainActivity)
                    header.addView(OwnerUi.iconCircle(this@MainActivity,R.drawable.ic_nav_car,OwnerUi.softBlue,42),
                        LinearLayout.LayoutParams(px(42),px(42)).apply{marginEnd=px(12)})
                    header.addView(OwnerUi.label(this@MainActivity,
                        formattedTime(item.optLong("createdAt")),13f,OwnerUi.muted).apply{
                            maxLines=2
                        },
                        LinearLayout.LayoutParams(0,-2,1f))
                    header.addView(OwnerUi.pill(this@MainActivity,label,
                        if(state=="confirmed")true else if(state=="waiting")false else null),
                        LinearLayout.LayoutParams(-2,-2).apply{marginStart=px(6)})
                    itemRow.addView(header)
                    val message=OwnerUi.label(this@MainActivity,
                        item.optString("message").ifBlank{"有人请求挪车"},16f,OwnerUi.navy).apply {
                            setPadding(0,px(17),0,px(17));maxLines=5;ellipsize=android.text.TextUtils.TruncateAt.END
                        }
                    itemRow.addView(message)
                    itemRow.addView(OwnerUi.line(this@MainActivity))
                    val actions=OwnerUi.horizontal(this@MainActivity)
                    val photo=item.optString("photoUrl")
                    actions.addView(deleteControl("删除") {
                        confirm("删除该条挪车记录及其照片？"){
                            api("/api/mobile/requests/delete",JSONObject().put("id",id)){loadRequests(true)}
                        }
                    })
                    actions.addView(android.view.View(this@MainActivity),LinearLayout.LayoutParams(0,1,1f))
                    if(photo.startsWith("/"))actions.addView(requestButton("查看照片"){
                        browse(base()+photo)
                    },LinearLayout.LayoutParams(-2,-2).apply{marginEnd=px(8)})
                    else if(item.optBoolean("photoSent"))
                        itemRow.addView(OwnerUi.label(this@MainActivity,"照片已过期",12f,OwnerUi.muted))
                    if(state=="waiting")actions.addView(requestButton("确认收到",primary=true) {
                        api("/api/mobile/requests/confirm",JSONObject().put("id",id)){
                            notify("已确认");loadRequests(true)
                        }
                    })
                    itemRow.addView(actions,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(8)})
                    inCard { root.addView(itemRow) }
                }
            }
            val paging=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER}
            if(historyPage>1)paging.addView(compactControl("← 上一页") {historyPage--;navigate("requests")})
            if(historyPage*20<total)paging.addView(compactControl("下一页 →") {historyPage++;navigate("requests")})
            root.addView(paging,LinearLayout.LayoutParams(-1,-2))
            if(total>0){
                val clear=OwnerUi.horizontal(this).apply{
                    minimumHeight=px(54)
                    setPadding(px(17),px(8),px(17),px(8))
                    background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,18,OwnerUi.line)
                    isClickable=true;isFocusable=true
                    contentDescription="清空全部挪车记录"
                    setOnClickListener{
                        confirm("永久删除所有挪车记录和照片？"){
                            api("/api/mobile/requests/clear",JSONObject().put("confirm",true)){
                                historyPage=1;loadRequests(true)
                            }
                        }
                    }
                }
                clear.addView(OwnerUi.icon(this,R.drawable.ic_trash,OwnerUi.red,20))
                clear.addView(OwnerUi.label(this,"清空全部挪车记录",14f,OwnerUi.red,true).apply{
                    setPadding(px(12),0,0,0)
                },LinearLayout.LayoutParams(0,-2,1f))
                clear.addView(OwnerUi.icon(this,R.drawable.ic_chevron_right,OwnerUi.muted,20))
                root.addView(clear,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(17)})
            }
        }
    }

    private fun confirm(message:String,yes:()->Unit){
        AlertDialog.Builder(this).setMessage(message)
            .setNegativeButton("取消",null)
            .setPositiveButton("确定") {_,_->yes()}.show()
    }
    private fun calls(result:JSONObject){
        shell("来电记录")
        val items=result.optJSONArray("items")
        val header=OwnerUi.horizontal(this).apply {
            gravity=Gravity.CENTER_VERTICAL
            setPadding(0,px(1),0,px(7))
        }
        header.addView(OwnerUi.label(this,"共 "+(items?.length()?:0)+" 条通话记录",13.5f,OwnerUi.muted),
            LinearLayout.LayoutParams(0,-2,1f))
        if((items?.length()?:0)>0)header.addView(compactControl("清空",OwnerUi.red){
            confirm("确定清空全部通话记录吗？此操作无法撤销。"){
                api("/api/mobile/calls/clear",JSONObject().put("confirm",true)){
                    notify("通话记录已清空")
                    refreshCurrent(true)
                }
            }
        })
        root.addView(header)
        if(items==null||items.length()==0){
            empty("暂无通话记录","接收到的语音来电会显示在这里。")
            return
        }
        for(i in 0 until items.length()){
            val item=items.getJSONObject(i)
            val raw=item.optString("status")
            val state=when(raw){
                "ringing"->"振铃中";"active"->"通话中";"missed"->"未接听"
                "ended"->"已结束";"rejected"->"已拒绝";"failed"->"连接失败";else->raw
            }
            val problem=raw=="missed"||raw=="rejected"||raw=="failed"
            inCard {
                val row=OwnerUi.horizontal(this@MainActivity)
                row.addView(OwnerUi.iconCircle(this@MainActivity,R.drawable.ic_nav_call,OwnerUi.softBlue,44),
                    LinearLayout.LayoutParams(px(44),px(44)).apply{marginEnd=px(14)})
                val info=OwnerUi.vertical(this@MainActivity)
                info.addView(OwnerUi.headline(this@MainActivity,"语音来电",16f))
                info.addView(OwnerUi.label(this@MainActivity,
                    formattedTime(item.optLong("startedAt")),13f,OwnerUi.muted).apply{
                    setPadding(0,px(6),0,0);maxLines=2
                })
                row.addView(info,LinearLayout.LayoutParams(0,-2,1f))
                row.addView(OwnerUi.pill(this@MainActivity,state,if(raw=="active")true else if(problem)false else null),
                    LinearLayout.LayoutParams(-2,-2).apply{marginStart=px(7)})
                root.addView(row)
            }
        }
    }
    private fun channels(config:JSONObject){
        shell("通知")
        val state=config.getJSONObject("channels")
        val options=listOf(
            Triple("app","APP 推送","本机消息"),
            Triple("bark","Bark","iPhone / iPad"),
            Triple("sc3","Server酱³","Android 推送"),
            Triple("serverchan","微信推送","Server酱")
        )
        for((key,label,description) in options){
            val channel=state.getJSONObject(key)
            val stateText=when {
                !channel.optBoolean("configured")->"未配置"
                !channel.optBoolean("enabled")->"已关闭"
                else->"已启用"
            }
            val icon=when(key){"app"->R.drawable.ic_nav_bell;"bark"->R.drawable.ic_devices;
                "sc3"->R.drawable.ic_android;else->R.drawable.ic_chat}
            val tint=when(key){"app"->OwnerUi.softBlue;"bark"->OwnerUi.softAmber;
                "sc3"->OwnerUi.softGreen;else->OwnerUi.softRed}
            inCard {
                root.background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,20,OwnerUi.line)
                root.isClickable=true;root.isFocusable=true
                root.contentDescription="$label，$stateText，打开配置"
                root.setOnClickListener{navigate("channel_"+key)}
                val row=OwnerUi.horizontal(this@MainActivity).apply{minimumHeight=px(58)}
                row.addView(OwnerUi.iconCircle(this@MainActivity,icon,tint,48),
                    LinearLayout.LayoutParams(px(48),px(48)).apply{marginEnd=px(14)})
                val info=OwnerUi.vertical(this@MainActivity)
                info.addView(OwnerUi.headline(this@MainActivity,label,17f))
                val detail=OwnerUi.horizontal(this@MainActivity)
                detail.addView(OwnerUi.label(this@MainActivity,"$description · $stateText",12.5f,
                    OwnerUi.muted).apply{
                    maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END
                },LinearLayout.LayoutParams(0,-2,1f))
                if(stateText=="已启用")detail.addView(OwnerUi.pill(this@MainActivity,"● 已启用",true).apply{
                    minHeight=px(26)
                    setPadding(px(8),px(4),px(8),px(4))
                },LinearLayout.LayoutParams(-2,-2).apply{marginStart=px(6)})
                info.addView(detail,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(7)})
                row.addView(info,LinearLayout.LayoutParams(0,-2,1f))
                row.addView(OwnerUi.icon(this@MainActivity,
                    R.drawable.ic_chevron_right,OwnerUi.muted,20),
                    LinearLayout.LayoutParams(px(20),px(20)).apply{marginStart=px(8)})
                root.addView(row)
            }
        }
        spacer(10)
        val test=OwnerUi.horizontal(this).apply{
            minimumHeight=px(56)
            setPadding(px(16),px(8),px(16),px(8))
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,18,OwnerUi.line)
            isClickable=true;isFocusable=true
            contentDescription="测试全部已启用渠道"
            setOnClickListener{testChannel("all")}
        }
        test.addView(OwnerUi.iconCircle(this,R.drawable.ic_send,OwnerUi.softPurple,40),
            LinearLayout.LayoutParams(px(40),px(40)).apply{marginEnd=px(13)})
        test.addView(OwnerUi.label(this,"测试全部已启用渠道",15f,OwnerUi.navy,true),
            LinearLayout.LayoutParams(0,-2,1f))
        test.addView(OwnerUi.icon(this,R.drawable.ic_chevron_right,OwnerUi.muted,20))
        root.addView(test)
    }
    private fun channelDetail(key:String,config:JSONObject){
        val names=mapOf("app" to "APP 推送","bark" to "Bark","sc3" to "Server酱³","serverchan" to "微信推送")
        val name=names[key]?:return
        shell(name)
        val current=config.getJSONObject("channels").getJSONObject(key)
        inCard {
            status(if(current.optBoolean("configured"))"已配置" else "未配置",current.optBoolean("configured"))
            val enabled=check("启用通知",current.optBoolean("enabled"))
            if(key!="app"){
                val row=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
                row.addView(OwnerUi.label(this,"配置密钥",12.5f,OwnerUi.muted),
                    LinearLayout.LayoutParams(0,-2,1f))
                row.addView(helpIcon("配置密钥",
                    "填写新密钥并保存；留空会保留现有密钥。需要移除时打开下方开关。"),
                    LinearLayout.LayoutParams(px(32),px(32)))
                root.addView(row)
            }
            val secret=when(key){
                "bark"->field("Bark API 地址",password=true)
                "sc3"->field("SendKey",password=true)
                "serverchan"->field("SendKey",password=true)
                else->null
            }
            val clear=if(secret!=null)check("移除现有密钥",false) else null
            action("保存设置",primary=true){
                val data=JSONObject().put(key+"Enabled",enabled.isChecked)
                if(secret!=null){
                    val fieldName=when(key){"bark"->"barkUrl";"sc3"->"sc3SendKey";else->"serverchanSendKey"}
                    val clearName=when(key){"bark"->"clearBark";"sc3"->"clearSc3";else->"clearServerchan"}
                    data.put(fieldName,secret.text.toString().trim()).put(clearName,clear!!.isChecked)
                }
                api("/api/mobile/channels",data){notify("通知设置已保存");navigate("channels")}
            }
            action("发送测试通知"){testChannel(key)}
            if(key=="app")action("重新绑定当前手机"){syncFcm()}
        }
    }
    private fun testChannel(channel:String){
        api("/api/mobile/channels/test",JSONObject().put("channel",channel)){
            val results=it.optJSONObject("channels")
            val names=listOf("app","bark","sc3","serverchan")
                .filter{key->results?.optString(key)=="ok"}
                .map{key->when(key){"app"->"APP";"bark"->"Bark";"sc3"->"Server酱³";else->"微信"}}
            notify(if(names.isEmpty())"测试未发送，请检查渠道配置" else "测试通知已发送至："+names.joinToString("、"))
        }
    }
    private fun copySafeCallDiagnostics(){
        val nm=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel=nm.getNotificationChannel(CarMessagingService.CHANNEL)
        val saved=getSharedPreferences("movecar_call_health",MODE_PRIVATE)
        @Suppress("DEPRECATION")
        val version=packageManager.getPackageInfo(packageName,0).versionName?:"unknown"
        // No call IDs, access tokens, FCM tokens, phone numbers or URLs.
        val report=listOf(
            "MoveCar Owner "+version,
            "Device: "+Build.MANUFACTURER+" "+Build.MODEL+" / SDK "+Build.VERSION.SDK_INT,
            "Notifications: "+nm.areNotificationsEnabled(),
            "Call channel importance: "+(channel?.importance?:0),
            "Full-screen permission: "+(Build.VERSION.SDK_INT<34||nm.canUseFullScreenIntent()),
            "Real FCM received at: "+saved.getLong("lastReceivedAt",0L),
            "Short wake fallback at: "+saved.getLong("lastWakeFallbackAt",0L),
            "Incoming UI opened at: "+saved.getLong("lastUiOpenedAt",0L),
            "Simulated call at: "+saved.getLong("lastTestReceivedAt",0L),
            "Active native call: "+(OngoingCallService.currentCallId!=null),
            "Call state: "+OngoingCallService.state
        ).joinToString("\n")
        val clipboard=getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("MoveCar diagnostics",report))
        notify("诊断信息已复制（不含号码、域名、Token 或密钥）")
    }

    private fun showCallPermissionStatus() {
        if(Build.VERSION.SDK_INT<26)return
        CarMessagingService.ensureIncomingCallChannel(this)
        val nm=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel=nm.getNotificationChannel(CarMessagingService.CHANNEL)
        val notifications=nm.areNotificationsEnabled()
        val high=channel?.importance?.let { it>=android.app.NotificationManager.IMPORTANCE_HIGH }==true
        val full=Build.VERSION.SDK_INT<34||nm.canUseFullScreenIntent()
        section("来电提醒")
        inCard {
            permissionRow("APP 通知",notifications,
                "允许应用发送通知，才能及时收到挪车来电。"){
                startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,packageName))
            }
            permissionRow("来电通知",high,
                "来电通知需要高优先级。部分系统还提供锁屏显示选项。"){
                startActivity(Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,packageName)
                    .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,CarMessagingService.CHANNEL))
            }
            permissionRow("全屏提醒",full,
                "允许全屏提醒后，锁屏时来电页面才能自动显示。系统设置名称可能有所不同。"){
                try {
                    if(Build.VERSION.SDK_INT>=34)
                        startActivity(Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                            .setData(Uri.parse("package:"+packageName)))
                    else startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:"+packageName)))
                }catch(_:Exception){
                    startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:"+packageName)))
                }
            }
        }
        section("测试与排查")
        inCard {
            val recent=getSharedPreferences("movecar_call_health",MODE_PRIVATE)
            val received=recent.getLong("lastReceivedAt",0L)
            val shown=received>0L && recent.getLong("lastUiOpenedAt",0L)>=received
            val last=if(received==0L)"暂无来电记录" else
                "最近来电 · "+formattedTime(received)+" · "+(if(shown)"已显示" else "未显示")
            val lastRow=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
            lastRow.addView(OwnerUi.label(this,last,13.5f,OwnerUi.muted),
                LinearLayout.LayoutParams(0,-2,1f))
            lastRow.addView(helpIcon("最近来电",
                "这里显示手机最近一次收到来电通知的时间，以及来电页面是否打开。"),
                LinearLayout.LayoutParams(px(32),px(32)).apply{marginStart=px(10)})
            root.addView(lastRow,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(10)})
            action("模拟锁屏来电",primary=true){
                CarMessagingService.ensureIncomingCallChannel(this)
                notify("请锁屏，7 秒后将显示测试来电")
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    CarMessagingService.postIncomingNotification(applicationContext,"",testing=true)
                },7000L)
            }
            val help=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
            help.addView(OwnerUi.label(this,"测试前请锁屏",12.5f,OwnerUi.muted),
                LinearLayout.LayoutParams(0,-2,1f))
            help.addView(helpIcon("模拟锁屏来电",
                "点击后 7 秒内锁屏。测试只检查本机来电提醒，不会发起真实通话。"),
                LinearLayout.LayoutParams(px(32),px(32)))
            root.addView(help)
            action("电池与后台设置"){
                startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            action("复制诊断信息"){copySafeCallDiagnostics()}
        }
    }

    private fun promptCallPermissionsIfNeeded(){
        if(Build.VERSION.SDK_INT<34)return
        val nm=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        CarMessagingService.ensureIncomingCallChannel(this)
        val full=nm.canUseFullScreenIntent()
        val notifications=nm.areNotificationsEnabled()
        val importance=nm.getNotificationChannel(CarMessagingService.CHANNEL)?.importance?:0
        val allowed=full&&notifications&&importance>=android.app.NotificationManager.IMPORTANCE_HIGH
        val prefs=VoiceApi.prefs(this)
        if(allowed){
            prefs.edit().remove("callPermPromptState").remove("callPermPromptAt").apply()
            return
        }
        val permissionState="$notifications:$importance:$full"
        val now=System.currentTimeMillis()
        if(!IncomingCallPolicy.shouldPromptForPermissions(false,permissionState,
                prefs.getString("callPermPromptState",null),
                prefs.getLong("callPermPromptAt",0L),now))return
        prefs.edit().putString("callPermPromptState",permissionState)
            .putLong("callPermPromptAt",now).apply()
        android.app.AlertDialog.Builder(this)
            .setTitle("开启锁屏来电亮屏")
            .setMessage("来电亮屏权限未开启。请在来电权限页打开缺少的权限。")
            .setNegativeButton("稍后",null)
            .setPositiveButton("前往设置"){_,_->navigate("settings_permissions")}
            .show()
    }
    private fun checkAppUpdate(){
        notify("正在检查 GitHub 正式版…")
        Thread {
            val result=runCatching{ReleaseUpdates.check()}
            runOnUiThread {
                if(isFinishing||isDestroyed)return@runOnUiThread
                result.onSuccess{latest->
                    @Suppress("DEPRECATION")
                    val installed=packageManager.getPackageInfo(packageName,0).versionName?:"0.0.0"
                    when{
                        latest==null -> AlertDialog.Builder(this)
                            .setTitle("暂时没有可安装的正式版本")
                            .setMessage("GitHub Releases 尚无使用固定签名发布的 MoveCar APK。测试版不能当作正式更新。")
                            .setNegativeButton("关闭",null)
                            .setPositiveButton("打开 Releases"){_,_->browse(ReleaseUpdates.RELEASES_PAGE)}
                            .show()
                        ReleaseUpdates.isNewer(installed,latest.version)->
                            AlertDialog.Builder(this)
                                .setTitle("发现 MoveCar v"+latest.version)
                                .setMessage("当前安装 v"+installed+"。更新包来自官方 GitHub Releases。\n\n"+
                                    "下载后通过 Android 安装器确认；如果旧版 APK 的签名不同，系统会拒绝覆盖安装。不会自动卸载或删除 APP 数据。")
                                .setNegativeButton("稍后",null)
                                .setNeutralButton("查看发布说明"){_,_->browse(latest.pageUrl)}
                                .setPositiveButton("下载正式 APK"){_,_->browse(latest.apkUrl)}
                                .show()
                        else -> AlertDialog.Builder(this)
                            .setTitle("当前已经是最新版本")
                            .setMessage("已安装 v"+installed+"；GitHub Releases 最新正式版为 v"+latest.version+"。")
                            .setNegativeButton("关闭",null)
                            .setPositiveButton("查看 Releases"){_,_->browse(ReleaseUpdates.RELEASES_PAGE)}
                            .show()
                    }
                }.onFailure{error->
                    AlertDialog.Builder(this)
                        .setTitle("检查更新失败")
                        .setMessage((error.message?:"网络错误")+
                            "\n请检查网络是否能够访问 GitHub。不会因此更改已安装的 APP。")
                        .setNegativeButton("关闭",null)
                        .setPositiveButton("打开 Releases"){_,_->browse(ReleaseUpdates.RELEASES_PAGE)}
                        .show()
                }
            }
        }.start()
    }

    private fun settings(config:JSONObject){
        shell("设置")
        section("管理")
        menuGroup {
            menuRow("站点与记录",config.optString("siteName","管理站点信息")){navigate("settings_site")}
            menuRow("通话规则",""){navigate("settings_calls")}
            menuRow("来电权限",""){navigate("settings_permissions")}
            menuRow("网站图标",""){navigate("settings_icon")}
            menuRow("设备与服务","",last=true){navigate("device")}
        }
        section("账户与版本")
        menuGroup {
            menuRow("版本更新",""){navigate("settings_update")}
            menuRow("账户安全",""){navigate("account")}
            menuRow("更换服务器","",last=true){
                confirm("切换后将返回登录界面，请输入新服务器 HTTPS 域名，使用管理员账号重新登录。原服务器数据不会删除。"){
                    clearLogin()
                }
            }
        }
    }
    private fun device(config:JSONObject){
        shell("设备与服务")
        val app=config.getJSONObject("channels").getJSONObject("app")
        val paired=app.optBoolean("configured")&&app.optBoolean("enabled")
        inCard {
            status(if(paired)"APP 推送已开启" else "APP 推送待配置",paired)
            action("发送测试通知"){testChannel("app")}
            action("重新绑定手机"){syncFcm()}
            action("打开管理后台"){browse(base()+"/admin")}
        }
    }
    private fun settingsPermissions(){
        shell("来电权限")
        showCallPermissionStatus()
        menuGroup { menuRow("通话质量", "", last=true) {
            api("/api/mobile/voice/quality") { response ->
                val items=response.optJSONArray("items")
                val summary=(0 until (items?.length()?:0)).joinToString("\n") { idx ->
                    val item=items!!.getJSONObject(idx)
                    val at=formattedTime(item.optLong("reportedAt"))
                    val route=when(item.optString("route")){
                        "direct"->"直连";"turn-udp"->"TURN UDP";"turn-tcp"->"TURN TCP";
                        "turn-tls"->"TURN TLS";else->"待确认"
                    }
                    val rtt=if(item.isNull("rttMs"))"—" else item.optInt("rttMs").toString()+" ms"
                    "$at · $route · RTT $rtt · 重连${item.optInt("reconnects")} · ${item.optString("phase")}"
                }
                AlertDialog.Builder(this)
                    .setTitle("通话质量")
                    .setMessage(summary.ifBlank{"目前没有通话诊断记录"})
                    .setPositiveButton("关闭",null).show()
            }
        } }
    }
    private fun settingsSite(config:JSONObject){
        shell("站点与记录")
        section("网站信息")
        val fields=inCard{
            val site=field("站点名称",config.optString("siteName"))
            val url=field("HTTPS 公网地址",config.optString("publicUrl"))
            val phone=field("联系电话（可选）",config.optString("phoneNumber"))
            val wechat=field("微信号（可选）",config.optString("wechatId"))
            listOf(site,url,phone,wechat)
        }
        section("通知与数据")
        inCard{
            val rate=field("通知间隔（秒，0–3600）",config.optInt("rateLimitSeconds",60).toString())
            val limit=field("记录保留数量（1–500）",config.optInt("requestRetentionLimit",50).toString())
            action("保存基本设置",primary=true){
                val rateValue=rate.text.toString().toIntOrNull()
                val limitValue=limit.text.toString().toIntOrNull()
                if(rateValue==null||limitValue==null){notify("请输入有效的数字");return@action}
                val data=JSONObject()
                    .put("siteName",fields[0].text.toString())
                    .put("publicUrl",fields[1].text.toString())
                    .put("phoneNumber",fields[2].text.toString())
                    .put("wechatId",fields[3].text.toString())
                    .put("rateLimitSeconds",rateValue)
                    .put("requestRetentionLimit",limitValue)
                api("/api/mobile/settings",data){notify("基本设置保存成功");navigate("settings_site")}
            }
        }
    }
    private fun settingsCalls(config:JSONObject){
        shell("通话规则")
        val voicePolicy=config.optJSONObject("voicePolicy") ?: JSONObject()
        inCard {
            val heading=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
            heading.addView(OwnerUi.headline(this,"语音呼叫",20f),LinearLayout.LayoutParams(0,-2,1f))
            heading.addView(helpIcon("语音呼叫规则",
                "修改后立即生效，不影响挪车留言。输入 0 可取消次数或间隔限制。"),
                LinearLayout.LayoutParams(px(32),px(32)))
            root.addView(heading)
            val daily=iconField("24 小时尝试次数",
                voicePolicy.optInt("dailyLimit",8).toString(),R.drawable.ic_nav_call,OwnerUi.softBlue)
            val cooldown=iconField("拨打间隔（秒）",
                voicePolicy.optInt("cooldownSeconds",90).toString(),R.drawable.ic_clock,OwnerUi.softGreen)
            val retries=iconField("失败重拨次数",
                voicePolicy.optInt("maxFastRetries",2).toString(),R.drawable.ic_globe,OwnerUi.softRed)
            val testing=check("测试模式",
                voicePolicy.optBoolean("testMode",false))
            val testHelp=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
            testHelp.addView(OwnerUi.label(this,"测试模式说明",12.5f,OwnerUi.muted),
                LinearLayout.LayoutParams(0,-2,1f))
            testHelp.addView(helpIcon("测试模式",
                "测试模式取消普通拨打的次数和间隔限制，所有扫码者都会受到影响。正式使用前请关闭。"),
                LinearLayout.LayoutParams(px(32),px(32)))
            root.addView(testHelp)
            action("保存规则",primary=true) {
                val a=daily.text.toString().toIntOrNull()
                val b=cooldown.text.toString().toIntOrNull()
                val c=retries.text.toString().toIntOrNull()
                if(a==null||a !in 0..500||b==null||b !in 0..3600||
                    c==null||c !in 0..10){
                    notify("请输入正确的通话限制范围");return@action
                }
                val send={
                    api("/api/mobile/voice-policy",JSONObject()
                        .put("dailyLimit",a).put("cooldownSeconds",b)
                        .put("maxFastRetries",c).put("testMode",testing.isChecked)){
                        notify("语音规则已保存");navigate("settings_calls")
                    }
                }
                if(testing.isChecked)confirm("开启测试模式后，陌生扫码者也可以连续呼叫，确认吗？",send)
                else send()
            }
            action("重置拨打次数",danger=true) {
                confirm("清除当前呼叫次数和冷却状态？不会删除通话历史。"){
                    api("/api/mobile/voice-policy/reset",JSONObject()){
                        notify("已清除测试次数，可以立即继续拨打")
                    }
                }
            }
        }
    }
    private fun settingsIcon(config:JSONObject){
        shell("网站图标")
        inCard{
            status(if(config.optBoolean("siteIconConfigured"))"自定义图标" else "默认图标",
                config.optBoolean("siteIconConfigured"))
            action("上传图标"){
                val intent=Intent(Intent.ACTION_GET_CONTENT).apply{
                    type="image/*";addCategory(Intent.CATEGORY_OPENABLE)
                }
                @Suppress("DEPRECATION")
                startActivityForResult(Intent.createChooser(intent,"选择网站图标"),iconPicker)
            }
            val row=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
            row.addView(OwnerUi.label(this,"图片要求",12.5f,OwnerUi.muted),
                LinearLayout.LayoutParams(0,-2,1f))
            row.addView(helpIcon("图片要求","请选择不超过 256 KB 的图片。"),
                LinearLayout.LayoutParams(px(32),px(32)))
            root.addView(row)
            action("恢复默认图标",danger=true){confirm("确定恢复默认图标？"){
                api("/api/mobile/site-icon/clear",JSONObject()){
                    notify("图标已恢复");navigate("settings_icon")
                }
            }}
        }
    }
    private fun settingsUpdate(){
        shell("版本更新")
        section("当前版本")
        inCard{
            @Suppress("DEPRECATION")
            val installed=packageManager.getPackageInfo(packageName,0).versionName?:"未知"
            status("v"+installed,true)
            action("检查更新",primary=true){checkAppUpdate()}
            action("查看发布记录"){browse(ReleaseUpdates.RELEASES_PAGE)}
        }
    }
    private fun account(config:JSONObject){
        shell("账户安全")
        section("管理员账号")
        val inputs=inCard{
            val name=field("管理员用户名",config.optString("username","admin"))
            val old=field("当前密码",password=true)
            val newer=field("新密码（可留空）",password=true)
            Triple(name,old,newer)
        }
        inCard{
            action("更新账号设置",primary=true){
                val data=JSONObject()
                    .put("newUsername",inputs.first.text.toString().trim())
                    .put("currentPassword",inputs.second.text.toString())
                    .put("newPassword",inputs.third.text.toString())
                api("/api/mobile/account",data){
                    notify("账户已更新，请重新登录");clearLogin()
                }
            }
            val row=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER_VERTICAL}
            row.addView(OwnerUi.label(this,"修改说明",12.5f,OwnerUi.muted),
                LinearLayout.LayoutParams(0,-2,1f))
            row.addView(helpIcon("修改说明",
                "新密码至少 12 位。修改账号后需要重新登录，并重新绑定推送。"),
                LinearLayout.LayoutParams(px(32),px(32)))
            root.addView(row)
        }
        inCard{
            action("退出登录",danger=true){confirm("退出登录并取消这部手机的通知绑定？"){
                api("/api/mobile/logout",JSONObject().put("deviceAuth",VoiceApi.auth(this))){
                    clearLogin()
                }
            }}
        }
    }
    private fun clearLogin(){
        OwnerCache.invalidate(this)
        VoiceApi.prefs(this).edit().remove("mobileAuth").remove("auth").apply()
        loginPage()
    }
}
