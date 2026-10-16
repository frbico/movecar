package de.ssxi.movecar;

import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class MoveService extends Service {
    private volatile boolean running;
    private volatile WebSocket connection;
    private Thread worker;
    private final OkHttpClient client=new OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build();
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        SecureStore store=new SecureStore(this);
        if(store.token().isEmpty()){stopSelf();return START_NOT_STICKY;}
        Notices.channels(this);
        if(Build.VERSION.SDK_INT>=34)startForeground(41,Notices.connection(this,"正在连接"),ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(41,Notices.connection(this,"正在连接"));
        if(!running){running=true;worker=new Thread(this::loop,"movecar-events");worker.start();}
        return START_STICKY;
    }
    private void state(String value){
        new SecureStore(this).setConnection(value);
        ((android.app.NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(41,Notices.connection(this,value));
        MainActivity.refreshIfVisible();
    }
    private void loop(){
        int delay=2;
        while(running&&!new SecureStore(this).token().isEmpty()){
            try {
                catchUp();
                CountDownLatch closed=new CountDownLatch(1);
                AtomicBoolean opened=new AtomicBoolean(false);
                String url=BuildConfig.BASE_URL.replaceFirst("^https://","wss://")+"/api/app/events";
                Request request=new Request.Builder().url(url).header("Authorization","Bearer "+new SecureStore(this).token()).build();
                connection=client.newWebSocket(request,new WebSocketListener(){
                    @Override public void onOpen(WebSocket ws,Response response){
                        opened.set(true);
                        state("已连接，等待挪车请求");
                        try{catchUp();}catch(Exception e){android.util.Log.w("MoveCar","Catch-up failed: "+e.getMessage());}
                    }
                    @Override public void onMessage(WebSocket ws,String message){
                        try{JSONObject event=new JSONObject(message);handle(event.optString("type"),message);}
                        catch(Exception e){android.util.Log.w("MoveCar","Invalid event: "+e.getMessage());}
                    }
                    @Override public void onClosing(WebSocket ws,int code,String reason){ws.close(1000,null);closed.countDown();}
                    @Override public void onClosed(WebSocket ws,int code,String reason){closed.countDown();}
                    @Override public void onFailure(WebSocket ws,Throwable error,Response response){
                        if(response!=null&&response.code()==401){new SecureStore(MoveService.this).clear();running=false;state("设备已解绑，请重新配对");}
                        closed.countDown();
                    }
                });
                closed.await();
                if(opened.get())delay=2;
            }catch(Exception e){state("连接中断，正在重试");}
            finally{if(connection!=null){connection.cancel();connection=null;}}
            if(!running)break;
            state("连接中断，正在重试");
            try{Thread.sleep(delay*1000L);}catch(InterruptedException ignored){break;}
            delay=Math.min(delay*2,60);
        }
        stopSelf();
    }
    private void handle(String type,String raw){
        try {
            JSONObject event=new JSONObject(raw);String id=event.optString("id","");
            if("request".equals(type)||"photo".equals(type)){
                if(id.isEmpty())return;
                JSONObject item=new ApiClient(this).json("GET","/api/app/requests/"+id,null);
                SecureStore store=new SecureStore(this);
                if(store.markSeen(("photo".equals(type)?"photo-":"")+id))
                    Notices.show(this,id,event.optString("title","MoveCar"),"request".equals(type)?item.optString("message","有新的挪车请求"):"点击查看现场照片");
            }
            if("test".equals(type))Notices.show(this,"test",event.optString("title","MoveCar 测试通知"),event.optString("summary","测试成功"));
            MainActivity.refreshIfVisible();
        }catch(Exception e){android.util.Log.w("MoveCar","Event handling failed: "+e.getMessage());}
    }
    private void catchUp() throws Exception {
        ApiClient api=new ApiClient(this);SecureStore store=new SecureStore(this);
        for(int page=1;page<=5;page++){
            JSONObject result=api.json("GET","/api/app/requests?page="+page+"&size=100",null);
            JSONArray items=result.optJSONArray("items");if(items==null||items.length()==0)break;
            for(int i=0;i<items.length();i++){
                JSONObject item=items.getJSONObject(i);String id=item.getString("id");
                if("waiting".equals(item.optString("status"))&&store.markSeen(id))
                    Notices.show(this,id,"🚗 有新的挪车请求",item.optString("message","请挪车"));
                if(item.optBoolean("photoSent")&&item.optString("photoUrl","").length()>0&&store.markSeen("photo-"+id))
                    Notices.show(this,id,"📷 收到挪车现场照片","点击查看现场照片");
            }
            if(items.length()<100)break;
        }
        MainActivity.refreshIfVisible();
    }
    @Override public void onDestroy(){running=false;if(connection!=null)connection.cancel();if(worker!=null)worker.interrupt();client.dispatcher().executorService().shutdown();client.connectionPool().evictAll();super.onDestroy();}
}
