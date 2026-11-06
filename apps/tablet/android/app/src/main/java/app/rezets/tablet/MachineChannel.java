package app.rezets.tablet;

import java.io.IOException;

/** Open byte channel to a machine controller, whatever the physical connection is. */
interface MachineChannel {

    /** Receives what happens on a channel, on a background thread. */
    interface Listener {
        void onData(MachineChannel channel, byte[] data);

        /** Called at most once, when the channel is lost. Not called after {@link #close()}. */
        void onLost(MachineChannel channel);
    }

    void write(byte[] data) throws IOException;

    void close();
}
