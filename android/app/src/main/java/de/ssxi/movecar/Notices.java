package de.ssxi.movecar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

final class Notices {
    static final String REQUESTS="move_requests";
    static final String SERVICE="move_connection";
    static void channels(Context context){
        NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel requests=new NotificationChannel(REQUESTS,"挪车提醒",NotificationManager.IMPORTANCE_HIGH);
        requests.setDescription("新挪车请求和现场照片");requests.enableVibration(true);requests.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel service=new NotificationChannel(SERVICE,"接收连接",NotificationManager.IMPORTANCE_LOW);
        service.setDescription("保持与 MoveCar 服务器的 WebSocket 连接");
        manager.createNotificationChannel(requests);manager.createNotificationChannel(service);
    }
    static Notification connection(Context context,String state){
        return new Notification.Builder(context,SERVICE).setSmallIcon(R.drawable.ic_movecar).setContentTitle("MoveCar 挪车提醒运行中")
                .setContentText(state).setOngoing(true).setContentIntent(open(context,"",1)).build();
    }
    private static PendingIntent open(Context context,String id,int requestCode){
        Intent intent=new Intent(context,MainActivity.class).putExtra("requestId",id).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context,requestCode,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void show(Context context,String id,String title,String body){
        channels(context);
        Notification n=new Notification.Builder(context,REQUESTS).setSmallIcon(R.drawable.ic_movecar).setContentTitle(title)
                .setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true).setContentIntent(open(context,id,id.hashCode())).build();
        ((NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id.hashCode(),n);
    }
}
