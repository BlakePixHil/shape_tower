package com.blakepixhil.shapetower;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LaunchSplashPlugin.class);
        super.onCreate(savedInstanceState);
        // The launch screen stays behind a see-through web view until the game's own splash, the same
        // picture, has painted over it (LaunchSplashPlugin.hide): no blank frame between the two.
        getWindow().setBackgroundDrawableResource(R.drawable.splash);
        if (bridge != null) bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
