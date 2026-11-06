package app.rezets.tablet;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** Hosts the shared interface and registers the native plugins it needs. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MachineLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
