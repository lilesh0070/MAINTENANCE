package com.toyotaboshoku.mes;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * WALKIE — JS aur {@link WalkieService} ke beech ka patla pul.
 *
 * Page sirf itna karta hai: "ye socket ka pata aur token lo, sunte raho".
 * Baaki sab (jud-na, dobara jud-na, aawaz bajana, vibrate karna) service ka
 * kaam hai — kyunki wahi app band hone par bhi zinda rehti hai.
 *
 * `batterySetting()` alag se isliye hai ki Xiaomi/Oppo/Vivo jaise phone
 * background app ko kuch der me maar dete hain.  Android ka apna parda
 * kholne ke alawa koi code ka raasta hai hi nahi — user ko khud "allow"
 * karna padta hai.  Isliye ye ek button ke peechhe rakha hai, chupke se
 * nahi chalta.
 */
@CapacitorPlugin(
    name = "Walkie",
    permissions = {
        /* Android 13+ par foreground service ki notification BINA ISKE dikhti
           hi nahi.  Service phir bhi chalti hai (device par naapa gaya), par
           user ko pata hi nahi chalta ki walkie sun raha hai -- aur ek aisi
           cheez jo jeb me chupke se socket khole baithi ho, wo theek nahi.
           Isliye ye permission haath se maangte hain.
           (Mic ki permission Capacitor KHUD maang leta hai jab page
           `getUserMedia()` bulata hai -- uske liye yahan kuch nahi chahiye.) */
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = Walkie.NOTIF)
    }
)
public class Walkie extends Plugin {

    static final String NOTIF = "notif";

    /** Chalta hua plugin -- service ANDON ki nayi list isi se page ko bhejti hai. */
    private static volatile Walkie EK = null;

    @Override
    public void load() {
        EK = this;
    }

    /** Service se: ANDON ki nayi list aayi -- page (AndonAlert) ko bata do.
     *  `haal` = `{"run","seq","rows","ok"}` (ok = notification par OK kiye
     *  ID).  App peechhe ho to bhi WebView chalta rehta hai (emulator par
     *  dekha, 2026-09-21 -- timer bas dheeme ho jaate hain), isliye OK ki
     *  khabar page turant pa leta hai.  Kabhi event chhoot jaye to page
     *  saamne aate hi `andonHaal()` se waise bhi taaza list le leta hai
     *  (purana `seq` page chhod deta hai). */
    static void andonBhejo(String haal) {
        Walkie p = EK;
        if (p == null || haal == null) return;
        try {
            p.notifyListeners("andon", new JSObject(haal));
        } catch (Throwable ignored) { /* page na ho to kuch nahi */ }
    }

    private JSObject haal() {
        JSObject o = new JSObject();
        o.put("running", WalkieService.RUNNING);
        o.put("connected", WalkieService.CONNECTED);
        // Server ANDON isi socket par bhej raha hai (naya server + andon=1).
        // Page isi par tay karta hai ki khud poochna band kare.
        o.put("andon", WalkieService.RUNNING && WalkieService.ANDON_SERVER);
        o.put("error", WalkieService.LAST_ERR == null ? "" : WalkieService.LAST_ERR);
        o.put("ignoringBattery", batteryChhoot());
        o.put("canNotify", android.os.Build.VERSION.SDK_INT < 33
                || getPermissionState(NOTIF) == PermissionState.GRANTED);
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(haal());
    }

    /** Notification ki ijazat maango.  Page ise service chalu karne se PEHLE
     *  bulata hai, taaki "Walkie-Talkie · Listening" wali patti dikhe. */
    @PluginMethod
    public void requestPerms(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT < 33
                || getPermissionState(NOTIF) == PermissionState.GRANTED) {
            call.resolve(haal());
            return;
        }
        requestPermissionForAlias(NOTIF, call, "permsCb");
    }

    @PermissionCallback
    private void permsCb(PluginCall call) {
        call.resolve(haal());
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");
        if (url == null || url.isEmpty() || token == null || token.isEmpty()) {
            call.reject("url and token are required");
            return;
        }
        Context c = getContext();
        Intent i = new Intent(c, WalkieService.class);
        i.setAction(WalkieService.ACTION_START);
        i.putExtra("url", url);
        i.putExtra("token", token);
        /* Isi socket par ANDON bhi suno?  Aur walkie chahiye ya sirf ANDON?
           (Admin → Services, aur user ki ANDON ijazat -- page tay karta hai.) */
        i.putExtra("andon", Boolean.TRUE.equals(call.getBoolean("andon", false)));
        i.putExtra("walkie", !Boolean.FALSE.equals(call.getBoolean("walkie", true)));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            c.startForegroundService(i);
        } else {
            c.startService(i);
        }
        call.resolve(haal());
    }

    /** Aakhri ANDON list jo service ke paas hai -- page khulte / saamne aate
     *  hi isi se popup bana leta hai (event ka intezaar nahi). */
    @PluginMethod
    public void andonHaal(PluginCall call) {
        JSObject o = new JSObject();
        String haal = WalkieService.ANDON_HAAL;
        try {
            if (haal != null) o = new JSObject(haal);   // run, seq, rows, ok
        } catch (Throwable ignored) { /* kharab -- khaali haal */ }
        o.put("andon", WalkieService.RUNNING && WalkieService.ANDON_SERVER);
        call.resolve(o);
    }

    /** Page ke "OK" se aata hai -- ring/vibration band aur server par jawab. */
    @PluginMethod
    public void ack(PluginCall call) {
        Context c = getContext();
        Intent i = new Intent(c, WalkieService.class);
        i.setAction(WalkieService.ACTION_ACK);
        try { c.startService(i); } catch (Throwable ignored) { /* service chal hi nahi rahi */ }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        Intent i = new Intent(c, WalkieService.class);
        i.setAction(WalkieService.ACTION_STOP);
        try { c.startService(i); } catch (Throwable ignored) { /* chal hi nahi rahi thi */ }
        call.resolve(haal());
    }

    /** Android ka "battery optimisation" wala parda kholo. */
    @PluginMethod
    public void batterySetting(PluginCall call) {
        try {
            Intent i = new Intent();
            if (batteryChhoot()) {
                // Pehle se chhoot mili hui hai — to poori list dikha do, warna
                // "already ignoring" wala parda khali lagta hai.
                i.setAction(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            } else {
                i.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable e) {
            call.reject("Could not open battery settings: " + e.getMessage());
        }
    }

    private boolean batteryChhoot() {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        } catch (Throwable e) {
            return false;
        }
    }
}
