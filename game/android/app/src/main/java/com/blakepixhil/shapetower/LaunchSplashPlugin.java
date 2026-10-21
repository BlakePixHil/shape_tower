package com.blakepixhil.shapetower;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The game's splash has painted (src/native.ts hideLaunchSplash): the launch screen behind it can go. */
@CapacitorPlugin(name = "LaunchSplash")
public class LaunchSplashPlugin extends Plugin {

    /** The game's sky, behind the web view from now on. */
    private static final int SKY = Color.parseColor("#6EC3FF");

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(SKY));
            getBridge().getWebView().setBackgroundColor(SKY);
            call.resolve();
        });
    }
}
