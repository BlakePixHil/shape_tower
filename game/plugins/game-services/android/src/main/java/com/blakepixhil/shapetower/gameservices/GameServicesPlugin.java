package com.blakepixhil.shapetower.gameservices;

import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.games.AchievementsClient;
import com.google.android.gms.games.GamesActivityResultCodes;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;

/**
 * Achievements on Google Play Games (gameplay.md §18.5); src/meta/stores.ts drives it. The device stays the
 * source of truth: this only passes unlocks and progress on. It stays off until the Play Games project id
 * is set (res/values/game_services.xml) and Google Play services are on the phone, so a build made before
 * the console is set up behaves exactly as before. It never asks the player to sign in by itself: Play
 * Games signs returning players in on its own, and signIn() only runs from the Achievements button.
 */
@CapacitorPlugin(name = "GameServices")
public class GameServicesPlugin extends Plugin {

    private boolean ready = false;
    private boolean signedIn = false;

    @Override
    public void load() {
        // Runs as the app starts: anything unexpected in Play Games only turns achievements off, never the app.
        try {
            String projectId = getContext().getString(R.string.game_services_project_id).trim();
            int services = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
            if (!projectId.matches("\\d+") || services != ConnectionResult.SUCCESS) return;
            PlayGamesSdk.initialize(getContext());
            PlayGames.getGamesSignInClient(getActivity())
                .isAuthenticated()
                .addOnCompleteListener(t -> setSignedIn(t.isSuccessful() && t.getResult().isAuthenticated()));
            ready = true;
        } catch (Exception | LinkageError e) {
            ready = false;
            Log.w("GameServices", "Play Games is off: " + e);
        }
    }

    private void setSignedIn(boolean now) {
        if (now == signedIn) return;
        signedIn = now;
        JSObject e = new JSObject();
        e.put("signedIn", now);
        notifyListeners("signInChanged", e);
    }

    private JSObject state() {
        JSObject r = new JSObject();
        r.put("available", ready);
        r.put("signedIn", signedIn);
        r.put("service", "play");
        return r;
    }

    private static JSObject sent(boolean sent) {
        JSObject r = new JSObject();
        r.put("sent", sent);
        return r;
    }

    private AchievementsClient achievements() {
        return PlayGames.getAchievementsClient(getActivity());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    /** Play Games' own sign-in, from the Achievements button only. */
    @PluginMethod
    public void signIn(PluginCall call) {
        if (!ready) {
            call.resolve(state());
            return;
        }
        PlayGames.getGamesSignInClient(getActivity())
            .signIn()
            .addOnCompleteListener(t -> {
                setSignedIn(t.isSuccessful() && t.getResult().isAuthenticated());
                call.resolve(state());
            });
    }

    /** Unlocks one achievement by its Play Games id. Repeats are free: Play Games ignores them. */
    @PluginMethod
    public void unlock(PluginCall call) {
        String id = call.getString("id", "");
        if (!ready || !signedIn || id.isEmpty()) {
            call.resolve(sent(false));
            return;
        }
        achievements().unlock(id);
        call.resolve(sent(true));
    }

    /** An incremental achievement's steps so far (Play Games keeps the highest it has seen). */
    @PluginMethod
    public void progress(PluginCall call) {
        String id = call.getString("id", "");
        int steps = call.getInt("steps", 0);
        if (!ready || !signedIn || id.isEmpty() || steps <= 0) {
            call.resolve(sent(false));
            return;
        }
        achievements().setSteps(id, steps);
        call.resolve(sent(true));
    }

    /** Play Games' achievements screen. */
    @PluginMethod
    public void show(PluginCall call) {
        if (!ready || !signedIn) {
            call.reject("Not signed in to Play Games");
            return;
        }
        achievements()
            .getAchievementsIntent()
            .addOnSuccessListener(intent -> startActivityForResult(call, intent, "achievementsClosed"))
            .addOnFailureListener(e -> call.reject(e.getMessage()));
    }

    @ActivityCallback
    private void achievementsClosed(PluginCall call, ActivityResult result) {
        // Signing out from Play Games' own screen comes back as "reconnect required".
        if (result.getResultCode() == GamesActivityResultCodes.RESULT_RECONNECT_REQUIRED) setSignedIn(false);
        if (call != null) call.resolve(state());
    }
}
