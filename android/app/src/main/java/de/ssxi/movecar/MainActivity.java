package de.ssxi.movecar;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.nio.ByteBuffer;
import java.text.DateFormat;
import java.util.Date;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

public final class MainActivity extends Activity {
    private static WeakReference<MainActivity> visible=new WeakReference<>(null);
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private SecureStore store;
    private LinearLayout root,content;
    private TextView state;
    private int page=1;
    private String currentId="";

    interface Task<T>{T run() throws Exception;}
    static void refreshIfVisible(){MainActivity a=visible.get();if(a!=null)a.runOnUiThread(a::refresh);}
    private <T> void work(Task<T> task,Consumer<T> done){io.execute(()->{try{T value=task.run();runOnUiThread(()->done.accept(value));}
        catch(Exception e){runOnUiThread(()->{if(e instanceof ApiClient.ApiError&&((ApiClient.ApiError)e).status==401){store.clear();showHome();}
            message(e.getMessage()==null?"请求失败":e.getMessage());});}});}
    private int dp(int value){return Math.round(getResources().getDisplayMetrics().density*value);}
    private void message(String text){Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(0xff202936);t.setPadding(0,dp(8),0,dp(8));return t;}
    private Button button(String label,Runnable action){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setOnClickListener(v->action.run());return b;}
    private void clear(){content.removeAllViews();}

    @Override public void onCreate(Bundle saved){super.onCreate(saved);store=new SecureStore(this);Notices.channels(this);
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},12);
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(18),dp(18),dp(18),dp(10));root.setBackgroundColor(0xfff5f7fb);
        TextView title=text("🚙 MoveCar",26);title.setTextColor(0xff1769aa);root.addView(title);
        state=text("",13);root.addView(state);
        ScrollView scroll=new ScrollView(this);content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);scroll.addView(content);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        openIntent(getIntent());showHome();
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);openIntent(intent);refresh();}
    private void openIntent(Intent intent){String id=intent.getStringExtra("requestId");if(id!=null&&id.matches("[A-Za-z0-9_-]{43}"))currentId=id;}
    @Override protected void onResume(){super.onResume();visible=new WeakReference<>(this);if(!store.token().isEmpty()){startReceiver();refresh();}}
    @Override protected void onPause(){visible.clear();super.onPause();}
    @Override protected void onDestroy(){io.shutdownNow();super.onDestroy();}
    private void updateStatus(){
        if(store.token().isEmpty())state.setText("尚未绑定车主设备");
        else state.setText("WebSocket 接收连接："+store.connection());
    }
    private void showHome(){updateStatus();clear();if(store.token().isEmpty()){
        content.addView(text("在网页后台打开「安卓设备」，生成一次性二维码，然后用此 App 扫描。",18));
        content.addView(button("扫描后台配对二维码",this::scan));
        content.addView(text("绑定后无需输入管理员密码。手机丢失时可在网页后台逐台解绑。",14));
        return;
    }
        LinearLayout actions=new LinearLayout(this);actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.addView(button("刷新",this::refresh));actions.addView(button("设备设置",this::settings));content.addView(actions);
        content.addView(text("请在系统设置中允许通知、自启动，并将此 App 的电池策略设为无限制。两台手机均需要常驻通知和“已连接”状态；系统仍可能结束后台进程。",14));
        content.addView(text("正在读取挪车记录…",16));
    }
    private void settings(){Intent intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()));startActivity(intent);}
    private void scan(){new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("扫描 MoveCar 后台的配对二维码").setBeepEnabled(false).initiateScan();}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);
        IntentResult result=IntentIntegrator.parseActivityResult(requestCode,resultCode,data);if(result==null||result.getContents()==null)return;
        try {Uri uri=Uri.parse(result.getContents());if(!"movecar".equals(uri.getScheme())||!"pair".equals(uri.getHost())||!BuildConfig.BASE_URL.equals(uri.getQueryParameter("server")))throw new Exception("二维码不是当前 MoveCar 服务器的配对码");
            String code=uri.getQueryParameter("code");if(code==null||!code.matches("[A-Za-z0-9_-]{43}"))throw new Exception("配对码无效");
            String platform=Build.MANUFACTURER.toLowerCase(java.util.Locale.ROOT).contains("samsung")?"samsung":"xiaomi";
            work(()->new ApiClient(this).json("POST","/api/app/pair",new JSONObject().put("code",code).put("platform",platform).put("name",Build.MANUFACTURER+" "+Build.MODEL)),reply->{
                try {store.save(reply.getString("credential"),platform);currentId="";page=1;message("绑定成功");
                    work(()->new ApiClient(this).json("GET","/api/app/requests?page=1&size=100",null),history->{JSONArray items=history.optJSONArray("items");if(items!=null)for(int i=0;i<items.length();i++){
                        JSONObject item=items.optJSONObject(i);if(item==null)continue;String id=item.optString("id");store.markInitialSeen(id);
                        if(item.optBoolean("photoSent"))store.markInitialSeen("photo-"+id);
                    }startReceiver();refresh();});
                }catch(Exception e){message("保存设备凭证失败："+e.getMessage());}
            });
        }catch(Exception e){message(e.getMessage());}
    }
    private void startReceiver(){
        try{startForegroundService(new Intent(this,MoveService.class));}catch(Exception e){store.setConnection("请手动重新打开 App 启动接收");}
        updateStatus();
    }
    private void refresh(){updateStatus();if(store.token().isEmpty()){showHome();return;}if(currentId.isEmpty())loadList();else loadDetail(currentId);}
    private void loadList(){final int requested=page;work(()->new ApiClient(this).json("GET","/api/app/requests?page="+requested+"&size=20",null),this::renderList);}
    private void renderList(JSONObject data){if(!currentId.isEmpty())return;showHome();clear();
        content.addView(button("刷新记录",this::refresh));
        JSONArray items=data.optJSONArray("items");if(items==null||items.length()==0){content.addView(text("暂无挪车记录",18));return;}
        for(int i=0;i<items.length();i++){
            JSONObject item=items.optJSONObject(i);if(item==null)continue;String id=item.optString("id");
            String status=item.optString("status");String label="waiting".equals(status)?"待确认":"confirmed".equals(status)?"已确认":"已过期";
            String when=DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(new Date(item.optLong("createdAt")));
            content.addView(button(label+" · "+when+"\n"+item.optString("message"),()->{currentId=id;loadDetail(id);}));
        }
        LinearLayout nav=new LinearLayout(this);nav.setOrientation(LinearLayout.HORIZONTAL);
        if(page>1)nav.addView(button("上一页",()->{page--;loadList();}));
        int total=data.optInt("total");content.addView(text("第 "+page+" 页，共 "+total+" 条",14));
        if(page*20<total)nav.addView(button("下一页",()->{page++;loadList();}));content.addView(nav);
    }
    private void loadDetail(String id){work(()->new ApiClient(this).json("GET","/api/app/requests/"+id,null),this::renderDetail);}
    private void renderDetail(JSONObject item){String id=item.optString("id");if(!id.equals(currentId))return;clear();
        content.addView(button("← 返回记录",()->{currentId="";loadList();}));
        content.addView(text("挪车请求",24));content.addView(text(item.optString("message"),20));
        String status=item.optString("status");String label="waiting".equals(status)?"等待车主确认":"confirmed".equals(status)?"已确认":"已过期";
        content.addView(text("状态："+label,17));
        content.addView(text("发起时间："+DateFormat.getDateTimeInstance().format(new Date(item.optLong("createdAt"))),14));
        if("waiting".equals(status))content.addView(button("我已收到，正在前往",()->confirm(id)));
        if(item.optBoolean("photoAvailable"))content.addView(button("查看现场照片",()->photo(id)));
        content.addView(button("刷新详情",()->loadDetail(id)));
    }
    private void confirm(String id){work(()->new ApiClient(this).json("POST","/api/app/requests/"+id+"/confirm",new JSONObject()),result->{message("已确认，对方将看到车主已收到");loadDetail(id);});}
    private void photo(String id){work(()->new ApiClient(this).photo(id),bytes->{try{
        Bitmap bitmap;
        if(Build.VERSION.SDK_INT>=28){ImageDecoder.Source source=ImageDecoder.createSource(ByteBuffer.wrap(bytes));bitmap=ImageDecoder.decodeBitmap(source,(decoder,info,src)->{
            int max=Math.max(info.getSize().getWidth(),info.getSize().getHeight());decoder.setTargetSampleSize(Math.max(1,(int)Math.ceil(max/2048.0)));
        });}
        else{BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);options.inSampleSize=Math.max(1,Math.max(options.outWidth,options.outHeight)/2048);options.inJustDecodeBounds=false;bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);}
        if(bitmap==null)throw new Exception("此手机无法解码照片格式");
        clear();content.addView(button("← 返回请求",()->loadDetail(id)));ImageView image=new ImageView(this);image.setImageBitmap(bitmap);image.setAdjustViewBounds(true);content.addView(image,new LinearLayout.LayoutParams(-1,-2));
        }catch(Exception e){message("照片无法显示："+e.getMessage());}});}
}
