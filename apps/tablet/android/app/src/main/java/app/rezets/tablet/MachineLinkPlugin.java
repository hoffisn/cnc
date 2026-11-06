package app.rezets.tablet;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Gives the interface a channel to the machine controller.
 * It only moves bytes: the protocol itself is spoken by the driver in the shared core.
 * Text is transferred as Latin-1, as Grbl realtime commands are single bytes above 0x7F.
 */
@CapacitorPlugin(name = "MachineLink")
public class MachineLinkPlugin extends Plugin implements MachineChannel.Listener {

    private static final String LINK_KIND_SERIAL = "serial";
    private static final String LINK_KIND_TCP = "tcp";
    private static final String EVENT_DATA = "data";
    private static final String EVENT_CLOSED = "closed";

    private volatile MachineChannel channel;

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    private List<UsbSerialDriver> findDrivers() {
        return UsbSerialProber.getDefaultProber().findAllDrivers(usbManager());
    }

    @PluginMethod
    public void listPorts(PluginCall call) {
        JSArray ports = new JSArray();
        for (UsbSerialDriver driver : findDrivers()) {
            UsbDevice device = driver.getDevice();
            JSObject port = new JSObject();
            port.put("portPath", device.getDeviceName());
            String manufacturer = device.getManufacturerName();
            port.put("manufacturer", manufacturer != null ? manufacturer : driver.getClass().getSimpleName());
            ports.put(port);
        }
        JSObject result = new JSObject();
        result.put("ports", ports);
        call.resolve(result);
    }

    @PluginMethod
    public void open(PluginCall call) {
        closeChannel();
        String kind = call.getString("kind", "");
        if (LINK_KIND_SERIAL.equals(kind)) {
            openSerial(call);
        } else if (LINK_KIND_TCP.equals(kind)) {
            openTcp(call);
        } else {
            call.reject("Неизвестный тип подключения");
        }
    }

    private void openSerial(PluginCall call) {
        String portPath = call.getString("portPath", "");
        Integer baudRate = call.getInt("baudRate");
        if (baudRate == null) {
            call.reject("Не указана скорость порта");
            return;
        }
        UsbSerialDriver driver = null;
        for (UsbSerialDriver candidate : findDrivers()) {
            if (candidate.getDevice().getDeviceName().equals(portPath)) driver = candidate;
        }
        if (driver == null) {
            call.reject("USB-устройство не найдено: проверьте кабель и переходник OTG");
            return;
        }
        if (usbManager().hasPermission(driver.getDevice())) {
            connectSerial(call, driver, baudRate);
        } else {
            requestUsbPermission(call, driver, baudRate);
        }
    }

    /** Android asks the operator to allow access to each USB device. */
    private void requestUsbPermission(PluginCall call, UsbSerialDriver driver, int baudRate) {
        String action = getContext().getPackageName() + ".USB_PERMISSION";
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                context.unregisterReceiver(this);
                if (usbManager().hasPermission(driver.getDevice())) {
                    connectSerial(call, driver, baudRate);
                } else {
                    call.reject("Доступ к USB-устройству не разрешён");
                }
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED);

        Intent intent = new Intent(action).setPackage(getContext().getPackageName());
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        usbManager().requestPermission(driver.getDevice(), PendingIntent.getBroadcast(getContext(), 0, intent, flags));
    }

    private void connectSerial(PluginCall call, UsbSerialDriver driver, int baudRate) {
        new Thread(() -> {
            try {
                onChannelOpened(call, SerialMachineChannel.open(usbManager(), driver, baudRate, this));
            } catch (IOException | RuntimeException failure) {
                call.reject("Не удалось открыть порт: " + failure.getMessage());
            }
        }, "machine-link-open").start();
    }

    private void openTcp(PluginCall call) {
        String host = call.getString("host", "");
        Integer port = call.getInt("port");
        if (host.isEmpty() || port == null) {
            call.reject("Не указан адрес контроллера");
            return;
        }
        new Thread(() -> {
            try {
                onChannelOpened(call, TcpMachineChannel.open(host, port, this));
            } catch (IOException | RuntimeException failure) {
                call.reject("Не удалось подключиться: " + failure.getMessage());
            }
        }, "machine-link-open").start();
    }

    private void onChannelOpened(PluginCall call, MachineChannel opened) {
        channel = opened;
        setKeepingDeviceAwake(true);
        call.resolve();
    }

    @PluginMethod
    public void write(PluginCall call) {
        MachineChannel active = channel;
        if (active == null) {
            call.reject("Нет подключения к станку");
            return;
        }
        try {
            active.write(call.getString("data", "").getBytes(StandardCharsets.ISO_8859_1));
            call.resolve();
        } catch (IOException failure) {
            onLost(active);
            call.reject("Не удалось отправить команду: " + failure.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeChannel();
        call.resolve();
    }

    @Override
    public void onData(MachineChannel source, byte[] data) {
        JSObject event = new JSObject();
        event.put("chunk", new String(data, StandardCharsets.ISO_8859_1));
        notifyListeners(EVENT_DATA, event);
    }

    @Override
    public void onLost(MachineChannel source) {
        if (channel != source) return;
        closeChannel();
        notifyListeners(EVENT_CLOSED, new JSObject());
    }

    @Override
    protected void handleOnDestroy() {
        closeChannel();
    }

    private void closeChannel() {
        MachineChannel active = channel;
        channel = null;
        if (active != null) {
            active.close();
            setKeepingDeviceAwake(false);
        }
    }

    /** While a machine is connected, neither the screen nor the system may go to sleep. */
    private void setKeepingDeviceAwake(boolean isKeepingAwake) {
        Intent service = new Intent(getContext(), MachineLinkService.class);
        if (isKeepingAwake) {
            ContextCompat.startForegroundService(getContext(), service);
        } else {
            getContext().stopService(service);
        }
        getActivity().runOnUiThread(() -> {
            if (isKeepingAwake) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }
}
