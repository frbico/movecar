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
    private val homeUrl = "https://movecar.ssxi.de"
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
            window.decorView.post { promptCallPermissionsOnce() }
        }
    }


    override fun onResume() {
        super.onResume()
        refreshHandler.removeCallbacks(periodicRefresh)
        refreshHandler.postDelayed(periodicRefresh, 120_000)
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
        // must reserve physical system-bar insets on Samsung One UI.
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
            setPadding(px(16), px(8), px(16), px(8))
        }
        val mark = OwnerUi.label(this, "M", 19f, OwnerUi.white, true).apply {
            gravity = Gravity.CENTER
            background = OwnerUi.bg(OwnerUi.blue, 13, this@MainActivity)
        }
        top.addView(mark, LinearLayout.LayoutParams(px(40), px(40)))
        val headingCol = OwnerUi.vertical(this).apply { setPadding(px(9), 0, 0, 0) }
        headingCol.addView(OwnerUi.label(this, "MOVE CAR  /  车主中心", 11f, OwnerUi.muted, true))
        headingCol.addView(OwnerUi.label(this, heading, 19f, OwnerUi.navy, true))
        top.addView(headingCol, LinearLayout.LayoutParams(0, -2, 1f))
        if (page != "login") top.addView(OwnerUi.label(this,"↻",25f,OwnerUi.blue,true).apply {
            gravity=Gravity.CENTER
            setPadding(px(9),px(4),px(4),px(4))
            isClickable=true;isFocusable=true
            contentDescription="手动同步当前页面"
            setOnClickListener{refreshCurrent(true);notify("已请求同步最新数据")}
        })
        frame.addView(top)

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
        }
        root = OwnerUi.vertical(this).apply {
            setPadding(px(14), px(3), px(14), px(15))
        }
        scroll.addView(root, android.widget.FrameLayout.LayoutParams(-1, -2))
        frame.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        if (page != "login") frame.addView(bottomNav())
        setContentView(frame)
    }

    private fun bottomNav(): LinearLayout {
        val bar=OwnerUi.horizontal(this).apply {
            setBackgroundColor(OwnerUi.white)
            setPadding(px(5), px(4), px(5), px(5))
            elevation=0f
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
                setPadding(px(3), px(5), px(3), px(3))
                background=OwnerUi.pressable(this@MainActivity,
                    if(selected)OwnerUi.softGreen else OwnerUi.white, 10)
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
            bar.addView(item,LinearLayout.LayoutParams(0,px(52),1f).apply {
                marginStart=px(2);marginEnd=px(2)
            })
        }
        return bar
    }

    private fun title(value: String, size: Float = 18f) {
        root.addView(OwnerUi.label(this, value, size, OwnerUi.navy, true).apply {
            setPadding(0, px(8), 0, px(4))
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
            bottomMargin=px(7)
        })
        val previous=root
        root=holder
        return try{block()}finally{root=previous}
    }
    private fun section(heading:String,caption:String="") {
        title(heading,16f)
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
            minHeight=px(46)
            if(password)inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        block.addView(edit,LinearLayout.LayoutParams(-1,-2).apply{topMargin=px(7)})
        root.addView(block,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(10)})
        return edit
    }
    private fun check(label:String,enabled:Boolean):CheckBox =
        CheckBox(this).also {
            it.text=label
            it.textSize=14f
            it.setTextColor(OwnerUi.navy)
            it.isChecked=enabled
            it.minHeight=px(44)
            it.buttonTintList=android.content.res.ColorStateList.valueOf(OwnerUi.blue)
            root.addView(it,LinearLayout.LayoutParams(-1,-2))
        }
    private fun action(label:String,primary:Boolean=false,danger:Boolean=false,callback:()->Unit) {
        val surface=if(primary)OwnerUi.blue else if(danger)OwnerUi.softRed else OwnerUi.white
        val foreground=if(primary)OwnerUi.white else if(danger)OwnerUi.red else OwnerUi.blue
        val button=OwnerUi.label(this,label,14f,foreground,true).apply {
            gravity=Gravity.CENTER
            minHeight=px(43)
            setPadding(px(14),px(12),px(14),px(12))
            background=OwnerUi.pressable(this@MainActivity,surface,13,
                if(primary)null else if(danger)OwnerUi.softRed else OwnerUi.line)
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
    private fun empty(heading:String,description:String){
        inCard {root.addView(OwnerUi.centerEmpty(this,heading,description))}
    }
    private fun notify(message: String) { Toast.makeText(this,message,Toast.LENGTH_LONG).show() }
    private fun base() = VoiceApi.base(this).ifBlank { homeUrl }
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
            "home","channels","settings","account" -> {
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
            background=OwnerUi.bg(OwnerUi.white,12,this@MainActivity,OwnerUi.line)
            setPadding(px(18),px(18),px(18),px(18))
        }
        welcome.addView(OwnerUi.label(this,"安心联系，随时挪车",21f,OwnerUi.navy,true))
        welcome.addView(OwnerUi.label(this,"消息通知、匿名语音与挪车记录",13f,OwnerUi.muted).apply {
            setPadding(0,px(6),0,0)
        })
        root.addView(welcome,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(12)})
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
                        OwnerCache.invalidate(this)
                        notify("后台登录成功，正在绑定消息推送")
                        navigate("home")
                        window.decorView.post { promptCallPermissionsOnce() }
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
        refreshCurrent(false)
    }
    private fun home(config:JSONObject) {
        shell("概览")
        val channel=config.getJSONObject("channels")
        val app=channel.getJSONObject("app")
        val paired=app.optBoolean("configured")&&app.optBoolean("enabled")
        val banner=OwnerUi.vertical(this).apply {
            background=OwnerUi.bg(OwnerUi.white,12,this@MainActivity,OwnerUi.line)
            setPadding(px(15),px(16),px(15),px(13))
        }
        banner.addView(OwnerUi.label(this,config.optString("siteName","MoveCar"),
            19f,OwnerUi.navy,true))
        banner.addView(OwnerUi.label(this,
            if(paired)"● 已连接 · 新请求将推送到手机" else "● 推送暂未绑定，请检查通知设置",
            12f,if(paired)OwnerUi.green else OwnerUi.amber).apply{
            setPadding(0,px(6),0,px(8))
        })
        val stats=OwnerUi.horizontal(this)
        stats.addView(OwnerUi.label(this,
            "挪车请求 "+config.optInt("requestCount").toString()+" 条",
            12.5f,OwnerUi.muted))
        banner.addView(stats)
        root.addView(banner,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(8)})

        section("快捷操作")
        fun shortcut(caption:String,detail:String,icon:Int,click:()->Unit):LinearLayout =
            OwnerUi.vertical(this).apply{
                background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,12,OwnerUi.line)
                setPadding(px(12),px(10),px(12),px(10))
                elevation=px(1).toFloat()
                isClickable=true;isFocusable=true;setOnClickListener{click()}
                addView(OwnerUi.icon(this@MainActivity,icon,OwnerUi.green,20))
                addView(OwnerUi.label(this@MainActivity,caption,15f,OwnerUi.navy,true).apply{
                    setPadding(0,px(5),0,px(1))
                })
                addView(OwnerUi.label(this@MainActivity,detail,12f,OwnerUi.muted))
            }
        val grid1=OwnerUi.horizontal(this)
        grid1.addView(shortcut("挪车请求","确认或处理留言",android.R.drawable.ic_menu_agenda){navigate("requests")},
            LinearLayout.LayoutParams(0,px(90),1f).apply{marginEnd=px(7)})
        grid1.addView(shortcut("匿名通话","查看来电历史",android.R.drawable.sym_action_call){navigate("calls")},
            LinearLayout.LayoutParams(0,px(90),1f).apply{marginStart=px(7)})
        root.addView(grid1,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(7)})
        val grid2=OwnerUi.horizontal(this)
        grid2.addView(shortcut("测试通知","确认推送已送达",android.R.drawable.ic_dialog_email){testChannel("app")},
            LinearLayout.LayoutParams(0,px(136),1f).apply{marginEnd=px(7)})
        grid2.addView(shortcut("渠道设置","选择推送方式",android.R.drawable.ic_menu_manage){navigate("channels")},
            LinearLayout.LayoutParams(0,px(136),1f).apply{marginStart=px(7)})
        root.addView(grid2,LinearLayout.LayoutParams(-1,-2).apply{bottomMargin=px(9)})

        section("连接状态")
        inCard {
            status(if(paired)"● FCM 消息推送已启用" else "● FCM 推送尚未就绪",paired)
            note("账号："+config.optString("username","admin"))
            note("网站："+base())
            note("设备推送："+if(app.optBoolean("configured"))"已绑定" else "尚未绑定")
            action("重新绑定推送") {syncFcm()}
        }
        action("打开网页版管理后台 ↗"){browse(base()+"/admin")}
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
    private fun compactControl(text:String, color:Int=OwnerUi.blue, task:()->Unit):TextView =
        OwnerUi.label(this,text,12.5f,color,true).apply {
            setPadding(px(7),px(7),px(7),px(7))
            gravity=Gravity.CENTER
            isClickable=true;isFocusable=true
            background=OwnerUi.pressable(this@MainActivity,OwnerUi.white,7)
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
            note("共 "+total+" 条 · 第 "+historyPage+" 页　　右上角 ↻ 同步")
            val items=result.optJSONArray("items")
            if(items==null||items.length()==0){
                empty("目前没有挪车请求","收到扫码留言后，这里将自动保存记录。")
            }else inCard {
                for(i in 0 until items.length()){
                    if(i>0)root.addView(OwnerUi.line(this@MainActivity))
                    val item=items.getJSONObject(i)
                    val id=item.optString("id")
                    val state=item.optString("status")
                    val label=when(state){"waiting"->"待处理";"confirmed"->"已确认";"expired"->"已过期";else->state}
                    val itemRow=OwnerUi.vertical(this@MainActivity).apply {
                        setPadding(px(0),px(5),px(0),px(5))
                    }
                    val header=OwnerUi.horizontal(this@MainActivity)
                    header.addView(OwnerUi.label(this@MainActivity,
                        formattedTime(item.optLong("createdAt")),11.5f,OwnerUi.muted),
                        LinearLayout.LayoutParams(0,-2,1f))
                    header.addView(OwnerUi.pill(this@MainActivity,label,
                        if(state=="confirmed")true else if(state=="waiting")false else null))
                    itemRow.addView(header)
                    val message=OwnerUi.label(this@MainActivity,
                        item.optString("message").ifBlank{"有人请求挪车"},13.5f,OwnerUi.navy,true).apply {
                            setPadding(0,px(3),0,px(1));maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END
                        }
                    itemRow.addView(message)
                    val actions=OwnerUi.horizontal(this@MainActivity)
                    val photo=item.optString("photoUrl")
                    if(photo.startsWith("/"))
                        actions.addView(compactControl("📷  查看照片"){browse(base()+photo)})
                    else if(item.optBoolean("photoSent"))
                        actions.addView(OwnerUi.label(this@MainActivity,"照片已过期",12f,OwnerUi.muted))
                    if(state=="waiting")actions.addView(compactControl("✓  确认收到") {
                        api("/api/mobile/requests/confirm",JSONObject().put("id",id)){
                            notify("已确认");loadRequests(true)
                        }
                    })
                    actions.addView(android.view.View(this@MainActivity),LinearLayout.LayoutParams(0,1,1f))
                    actions.addView(compactControl("删除",OwnerUi.red) {
                        confirm("删除该条挪车记录及其照片？"){
                            api("/api/mobile/requests/delete",JSONObject().put("id",id)){loadRequests(true)}
                        }
                    })
                    actions.visibility=View.GONE
                    itemRow.addView(actions)
                    itemRow.isClickable=true
                    itemRow.isFocusable=true
                    itemRow.contentDescription="查看挪车请求详细操作"
                    itemRow.setOnClickListener {
                        actions.visibility=if(actions.visibility==View.VISIBLE)View.GONE else View.VISIBLE
                    }
                    root.addView(itemRow)
                }
            }
            val paging=OwnerUi.horizontal(this).apply{gravity=Gravity.CENTER}
            if(historyPage>1)paging.addView(compactControl("← 上一页") {historyPage--;navigate("requests")})
            if(historyPage*20<total)paging.addView(compactControl("下一页 →") {historyPage++;navigate("requests")})
            root.addView(paging,LinearLayout.LayoutParams(-1,-2))
            spacer(12)
            action("清空全部挪车记录",danger=true){
                confirm("永久删除所有挪车记录和照片？"){
                    api("/api/mobile/requests/clear",JSONObject().put("confirm",true)){
                        historyPage=1;loadRequests(true)
                    }
                }
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
        header.addView(OwnerUi.label(this,"共 "+(items?.length()?:0)+" 条通话记录",12.5f,OwnerUi.muted),
            LinearLayout.LayoutParams(0,-2,1f))
        header.addView(compactControl("清空",OwnerUi.red){
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
        inCard {
            for(i in 0 until items.length()){
                val item=items.getJSONObject(i)
                val raw=item.optString("status")
                val state=when(raw){
                    "ringing"->"振铃中";"active"->"通话中";"missed"->"未接听"
                    "ended"->"已结束";"rejected"->"已拒绝";"failed"->"连接失败";else->raw
                }
                val problem=raw=="missed"||raw=="rejected"||raw=="failed"
                val row=OwnerUi.horizontal(this@MainActivity).apply {
                    setPadding(px(3),px(7),px(2),px(7))
                }
                val icon=OwnerUi.label(this@MainActivity,if(problem)"↙" else "↗",
                    24f,if(problem)OwnerUi.red else OwnerUi.green,true).apply{gravity=Gravity.CENTER}
                row.addView(icon,LinearLayout.LayoutParams(px(40),px(40)))
                val info=OwnerUi.vertical(this@MainActivity)
                info.addView(OwnerUi.label(this@MainActivity,"语音来电",14.5f,OwnerUi.navy,true))
                info.addView(OwnerUi.label(this@MainActivity,
                    formattedTime(item.optLong("startedAt")),12f,OwnerUi.muted))
                row.addView(info,LinearLayout.LayoutParams(0,-2,1f))
                row.addView(OwnerUi.label(this@MainActivity,state,12f,
                    if(problem)OwnerUi.red else OwnerUi.muted,true))
                root.addView(row)
                if(i<items.length()-1)root.addView(OwnerUi.line(this@MainActivity))
            }
        }
    }
    private fun channels(config:JSONObject){
        shell("通知中心")
        section("通知渠道","自由选择接收消息的方式，来电功能独立运行。")
        val state=config.getJSONObject("channels")
        fun configured(key:String)=state.getJSONObject(key).optBoolean("configured")
        fun enabled(key:String)=state.getJSONObject(key).optBoolean("enabled")

        val app=inCard{
            title("MoveCar · 原生 FCM",17f)
            status(if(configured("app"))"● 手机设备已绑定" else "● 尚未绑定手机",configured("app"))
            note("直接接收扫码留言，不依赖 Bark 或微信；语音来电仍可独立响铃。")
            val selected=check("接收 APP 挪车通知",enabled("app"))
            action("发送测试通知"){testChannel("app")}
            if(!configured("app"))action("重新绑定当前手机"){syncFcm()}
            selected
        }
        val bark=inCard{
            title("Bark · iPhone / iPad",17f)
            status(if(configured("bark"))"已保存渠道密钥" else "尚未配置",configured("bark"))
            val selected=check("启用 Bark 通知",enabled("bark"))
            action("单独测试 Bark"){testChannel("bark")}
            selected
        }
        val barkKey=inCard{
            title("Bark 配置",15f)
            note("输入新的 HTTPS Bark API 地址；留空将保留旧值。")
            field("Bark API 地址（可选）",password=true)
        }
        val clearBark=inCard{ check("移除现有 Bark 密钥",false) }

        val sc3=inCard{
            title("Server酱³ · Android",17f)
            status(if(configured("sc3"))"已保存渠道密钥" else "尚未配置",configured("sc3"))
            val selected=check("启用 Server酱³ 通知",enabled("sc3"))
            action("单独测试 SC3"){testChannel("sc3")}
            selected
        }
        val sc3Key=inCard{field("新的 Server酱³ SendKey（留空保持）",password=true)}
        val clearSc3=inCard{check("移除现有 Server酱³ 密钥",false)}

        val turbo=inCard{
            title("微信 · Server酱",17f)
            status(if(configured("serverchan"))"已保存渠道密钥" else "尚未配置",configured("serverchan"))
            val selected=check("启用微信推送",enabled("serverchan"))
            action("单独测试微信"){testChannel("serverchan")}
            selected
        }
        val turboKey=inCard{field("新的微信 Server酱 SendKey（留空保持）",password=true)}
        val clearTurbo=inCard{check("移除现有微信 SendKey",false)}
        inCard{
            action("保存全部通知设置",primary=true) {
                val data=JSONObject()
                    .put("appEnabled",app.isChecked).put("barkEnabled",bark.isChecked)
                    .put("sc3Enabled",sc3.isChecked).put("serverchanEnabled",turbo.isChecked)
                    .put("barkUrl",barkKey.text.toString().trim())
                    .put("sc3SendKey",sc3Key.text.toString().trim())
                    .put("serverchanSendKey",turboKey.text.toString().trim())
                    .put("clearBark",clearBark.isChecked)
                    .put("clearSc3",clearSc3.isChecked)
                    .put("clearServerchan",clearTurbo.isChecked)
                api("/api/mobile/channels",data){notify("通知渠道已保存");navigate("channels")}
            }
            action("测试全部已启用渠道"){testChannel("all")}
        }
    }
    private fun testChannel(channel:String){
        api("/api/mobile/channels/test",JSONObject().put("channel",channel)){
            notify("已提交推送："+it.optJSONObject("channels")?.toString())
        }
    }
    private fun showCallPermissionStatus() {
        if(Build.VERSION.SDK_INT<26)return
        CarMessagingService.ensureIncomingCallChannel(this)
        val nm=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel=nm.getNotificationChannel(CarMessagingService.CHANNEL)
        val notifications=nm.areNotificationsEnabled()
        val high=channel?.importance?.let { it>=android.app.NotificationManager.IMPORTANCE_HIGH }==true
        val full=Build.VERSION.SDK_INT<34||nm.canUseFullScreenIntent()
        section("来电亮屏与通知权限")
        inCard {
            status(if(notifications)"✓ 全部通知已允许" else "✕ APP 通知被关闭",notifications)
            status(if(high)"✓ 来电通知渠道：高优先级" else "✕ 来电通知渠道被限制",high)
            status(if(full)"✓ 全屏来电通知：已授权" else "✕ 全屏来电权限未开启",full)
            note("三星 One UI 必须允许 APP 的「全屏提醒/全屏意图」、来电通知渠道和锁屏显示。关闭免打扰限制后再锁屏测试。")
            if(!notifications)action("打开 APP 通知设置"){
                startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,packageName))
            }
            if(!high)action("打开来电通知渠道设置"){
                startActivity(Intent(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,packageName)
                    .putExtra(android.provider.Settings.EXTRA_CHANNEL_ID,CarMessagingService.CHANNEL))
            }
            if(!full&&Build.VERSION.SDK_INT>=34)action("授权全屏来电 / 亮屏"){
                try {
                    startActivity(Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                        .setData(Uri.parse("package:"+packageName)))
                }catch(_:Exception){
                    startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:"+packageName)))
                }
            }
            action("打开系统电池优化设置（检查后台限制）"){
                startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            note("受系统权限、免打扰和省电策略影响，无法通过应用程序强制绕过用户关闭的锁屏提醒。")
        }
    }

    private fun promptCallPermissionsOnce(){
        if(Build.VERSION.SDK_INT<34)return
        val nm=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        CarMessagingService.ensureIncomingCallChannel(this)
        val allowed=nm.canUseFullScreenIntent()&&nm.areNotificationsEnabled()&&
            (nm.getNotificationChannel(CarMessagingService.CHANNEL)?.importance?:0)>=android.app.NotificationManager.IMPORTANCE_HIGH
        if(allowed)return
        val prefs=VoiceApi.prefs(this)
        if(prefs.getBoolean("callPermPromptV06",false))return
        prefs.edit().putBoolean("callPermPromptV06",true).apply()
        android.app.AlertDialog.Builder(this)
            .setTitle("开启锁屏来电亮屏")
            .setMessage("检测到三星系统尚未完整允许 MoveCar 全屏来电。请在设置中允许全屏提醒、来电通知和锁屏显示，否则只能听到振铃。")
            .setNegativeButton("稍后",null)
            .setPositiveButton("前往设置"){_,_->navigate("settings")}
            .show()
    }
    private fun settings(config:JSONObject){
        shell("设置")
        showCallPermissionStatus()
        section("网站信息","更改后同时应用于扫码网页和车主 APP。")
        val fields=inCard{
            val site=field("站点名称",config.optString("siteName"))
            val url=field("HTTPS 公网地址",config.optString("publicUrl"))
            val phone=field("车主联系电话（可选）",config.optString("phoneNumber"))
            val wechat=field("车主微信号（可选）",config.optString("wechatId"))
            listOf(site,url,phone,wechat)
        }
        section("通知与数据")
        val settings=inCard{
            val rate=field("通知间隔（秒，0–3600）",config.optInt("rateLimitSeconds",60).toString())
            val limit=field("记录保留数量（1–500）",config.optInt("requestRetentionLimit",50).toString())
            rate to limit
        }
        inCard{
            action("保存基本设置",primary=true){
                val rate=settings.first.text.toString().toIntOrNull()
                val limit=settings.second.text.toString().toIntOrNull()
                if(rate==null||limit==null){notify("请输入有效的数字");return@action}
                val data=JSONObject()
                    .put("siteName",fields[0].text.toString())
                    .put("publicUrl",fields[1].text.toString())
                    .put("phoneNumber",fields[2].text.toString())
                    .put("wechatId",fields[3].text.toString())
                    .put("rateLimitSeconds",rate)
                    .put("requestRetentionLimit",limit)
                api("/api/mobile/settings",data){notify("基本设置保存成功");navigate("settings")}
            }
        }
        section("语音呼叫限制")
        val voicePolicy=config.optJSONObject("voicePolicy") ?: JSONObject()
        inCard {
            note("扫码语音通话：设置后立即生效，不影响挪车留言")
            val daily=field("24 小时最多尝试次数（0=不限）",
                voicePolicy.optInt("dailyLimit",8).toString())
            val cooldown=field("两次拨打间隔（秒，0=无等待）",
                voicePolicy.optInt("cooldownSeconds",90).toString())
            val retries=field("网络失败可立即重拨次数（0–10）",
                voicePolicy.optInt("maxFastRetries",2).toString())
            val testing=check("测试模式：不限制普通拨打次数与间隔",
                voicePolicy.optBoolean("testMode",false))
            note("测试模式公开生效，仍保留单路并发保护；正式投入使用后请关闭。")
            action("保存语音通话规则",primary=true) {
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
                        notify("语音规则已保存");navigate("settings")
                    }
                }
                if(testing.isChecked)confirm("开启测试模式后，陌生扫码者也可以连续呼叫，确认吗？",send)
                else send()
            }
            action("清除今日测试次数与冷却记录") {
                confirm("清除当前呼叫次数和冷却状态？不会删除通话历史。"){
                    api("/api/mobile/voice-policy/reset",JSONObject()){
                        notify("已清除测试次数，可以立即继续拨打")
                    }
                }
            }
        }
        section("品牌与图标")
        inCard{
            status(if(config.optBoolean("siteIconConfigured"))"● 已设置自定义图标" else "使用默认网站图标",
                config.optBoolean("siteIconConfigured"))
            action("上传网站图标（256 KB 以下）"){
                val intent=Intent(Intent.ACTION_GET_CONTENT).apply{
                    type="image/*";addCategory(Intent.CATEGORY_OPENABLE)
                }
                @Suppress("DEPRECATION")
                startActivityForResult(Intent.createChooser(intent,"选择网站图标"),iconPicker)
            }
            action("恢复默认图标",danger=true){confirm("确定恢复默认图标？"){
                api("/api/mobile/site-icon/clear",JSONObject()){
                    notify("图标已恢复");navigate("settings")
                }
            }}
        }
        section("账户及更多")
        inCard{
            action("管理员账号与安全"){navigate("account")}
            if(Build.VERSION.SDK_INT>=34){
                val notifications=getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
                val allowed=notifications.canUseFullScreenIntent()
                status(if(allowed)"✓ 锁屏来电全屏权限已允许" else "锁屏亮屏权限需要开启",allowed)
                if(!allowed)action("开启锁屏来电亮屏权限"){
                    try{
                        val settingsIntent=Intent("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT")
                            .setData(Uri.parse("package:"+packageName))
                        startActivity(settingsIntent)
                    }catch(_:Exception){
                        startActivity(Intent("android.settings.APPLICATION_DETAILS_SETTINGS")
                            .setData(Uri.parse("package:"+packageName)))
                    }
                }
            }
            action("打开网页管理后台 ↗"){browse(base()+"/admin")}
            action("更换服务器或域名"){confirm("切换后将返回登录界面，请输入新服务器 HTTPS 域名，使用管理员账号重新登录。原服务器数据不会删除。"){
                clearLogin()
            }}
            note("MoveCar Owner v0.5.1 · 锁屏来电诊断与语音次数设置")
        }
    }
    private fun account(config:JSONObject){
        shell("账户安全")
        section("管理员账号","与网页版后台共用身份，修改后会注销现有登录会话。")
        val inputs=inCard{
            val name=field("管理员用户名",config.optString("username","admin"))
            val old=field("当前密码",password=true)
            val newer=field("新密码（留空即不修改，至少 12 位）",password=true)
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
            note("安全提醒：账号变更会要求重新登录 APP 和网页后台，并重新绑定推送。")
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