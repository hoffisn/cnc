package app.rezets.tablet;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** Channel over the network, for controllers with Ethernet or Wi-Fi such as grblHAL and FluidNC. */
final class TcpMachineChannel implements MachineChannel {

    private static final int CONNECT_TIMEOUT_MS = 5000;
    private static final int READ_BUFFER_BYTES = 1024;

    private final Socket socket;
    private final Listener listener;
    private final AtomicBoolean isClosed = new AtomicBoolean(false);

    private TcpMachineChannel(Socket socket, Listener listener) {
        this.socket = socket;
        this.listener = listener;
    }

    /**
     * Connects to a controller. Blocks, so it must not run on the main thread.
     *
     * @throws IOException when the host is unreachable.
     */
    static TcpMachineChannel open(String host, int port, Listener listener) throws IOException {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            // Commands must reach the machine immediately rather than wait in Nagle's buffer.
            socket.setTcpNoDelay(true);
        } catch (IOException failure) {
            socket.close();
            throw failure;
        }
        TcpMachineChannel channel = new TcpMachineChannel(socket, listener);
        Thread reader = new Thread(channel::readUntilClosed, "machine-link-tcp");
        reader.setDaemon(true);
        reader.start();
        return channel;
    }

    @Override
    public void write(byte[] data) throws IOException {
        socket.getOutputStream().write(data);
    }

    @Override
    public void close() {
        if (isClosed.compareAndSet(false, true)) closeSocket();
    }

    private void readUntilClosed() {
        byte[] buffer = new byte[READ_BUFFER_BYTES];
        try {
            InputStream input = socket.getInputStream();
            int count;
            while ((count = input.read(buffer)) != -1) {
                listener.onData(this, Arrays.copyOf(buffer, count));
            }
        } catch (IOException ignored) {
            // A broken connection is handled the same way as one closed by the controller.
        }
        if (isClosed.compareAndSet(false, true)) {
            closeSocket();
            listener.onLost(this);
        }
    }

    private void closeSocket() {
        try {
            socket.close();
        } catch (IOException ignored) {
            // The socket is being abandoned either way.
        }
    }
}
