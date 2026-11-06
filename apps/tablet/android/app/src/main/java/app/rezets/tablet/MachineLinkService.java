package app.rezets.tablet;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the process alive and the processor awake while a machine is connected.
 * A controller receives its program in small portions, so a suspended tablet would stop it mid-cut.
 */
public class MachineLinkService extends Service {

    private static final String NOTIFICATION_CHANNEL_ID = "machine-link";
    private static final int NOTIFICATION_ID = 1;
    private static final String WAKE_LOCK_TAG = "Rezets:machine-link";

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        PowerManager powerManager = getSystemService(PowerManager.class);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createNotificationChannel();
        Notification notification = new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Резец")
            .setContentText("Станок подключён")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build();
        int serviceType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, serviceType);
        wakeLock.acquire();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Подключение станка",
            NotificationManager.IMPORTANCE_LOW
        );
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
}
