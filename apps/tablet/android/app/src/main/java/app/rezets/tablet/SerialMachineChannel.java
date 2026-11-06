package app.rezets.tablet;

import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.util.SerialInputOutputManager;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Channel over a USB-serial adapter such as the CH340 found on Arduino boards. */
final class SerialMachineChannel implements MachineChannel, SerialInputOutputManager.Listener {

    private static final int DATA_BITS = 8;
    private static final int WRITE_TIMEOUT_MS = 1000;

    private final UsbSerialPort port;
    private final Listener listener;
    private final AtomicBoolean isClosed = new AtomicBoolean(false);
    private SerialInputOutputManager ioManager;

    private SerialMachineChannel(UsbSerialPort port, Listener listener) {
        this.port = port;
        this.listener = listener;
    }

    /**
     * Opens the first port of a driver.
     *
     * @throws IOException when the system refuses the device or the port cannot be configured.
     */
    static SerialMachineChannel open(UsbManager manager, UsbSerialDriver driver, int baudRate, Listener listener)
        throws IOException {
        UsbDeviceConnection connection = manager.openDevice(driver.getDevice());
        if (connection == null) {
            throw new IOException("Система не дала доступ к USB-устройству");
        }
        UsbSerialPort port = driver.getPorts().get(0);
        port.open(connection);
        try {
            port.setParameters(baudRate, DATA_BITS, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            port.setDTR(true);
            port.setRTS(true);
        } catch (IOException | RuntimeException failure) {
            port.close();
            throw failure;
        }
        SerialMachineChannel channel = new SerialMachineChannel(port, listener);
        channel.ioManager = new SerialInputOutputManager(port, channel);
        channel.ioManager.start();
        return channel;
    }

    @Override
    public void write(byte[] data) throws IOException {
        port.write(data, WRITE_TIMEOUT_MS);
    }

    @Override
    public void close() {
        if (!isClosed.compareAndSet(false, true)) return;
        release();
    }

    @Override
    public void onNewData(byte[] data) {
        listener.onData(this, data);
    }

    @Override
    public void onRunError(Exception cause) {
        if (!isClosed.compareAndSet(false, true)) return;
        release();
        listener.onLost(this);
    }

    private void release() {
        if (ioManager != null) ioManager.stop();
        try {
            port.close();
        } catch (IOException ignored) {
            // The port is being abandoned either way, and an unplugged device always fails here.
        }
    }
}
