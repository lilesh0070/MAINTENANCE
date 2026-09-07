package com.toyotaboshoku.mes;

import android.app.Activity;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * TV PAR POORI SCREEN -- upar ki kaali patti (status bar) aur neeche ka
 * navigation bar hata do.
 *
 * KYUN
 * ----
 * TV deewar par ek board hai -- wahan ghadi, battery aur back/home ke button
 * ka koi kaam nahi.  Wo sirf jagah khaate hain aur board ke upar ek kaali
 * patti bana dete hain.
 *
 * PHONE PAR YE NAHI CHALTA -- aur ye jaan-boojh kar hai.  Phone par status
 * bar chahiye hi (waqt, network, battery), aur uske liye alag se kaam ho
 * chuka hai (`capacitor.config.json` ka `adjustMarginsForEdgeToEdge: auto`).
 * Isliye ye plugin apne aap kuch nahi karta -- JS tabhi bulata hai jab usne
 * device ko TV maana ho (`apiBase.js`, `in-app-tv`).
 *
 * Faisla JS me hi rehna chahiye, Java me dobara nahi -- warna do jagah do
 * alag jawab ban jaate hain aur kabhi na kabhi wo aapas me nahi milte.
 * (Java ka `kisKismKaDevice()` sirf "tab" bachane ke liye hai; wo har bade
 * panel ko "tv" nahi kehta.)
 */
@CapacitorPlugin(name = "ScreenMode")
public class ScreenMode extends Plugin {

    /** App wapas saamne aane par bar phir se na aa jayein -- MainActivity
     *  `onResume` me ise dekh kar dobara laga deti hai. */
    static boolean immersiveChahiye = false;

    @PluginMethod
    public void immersive(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", Boolean.TRUE));
        final Activity act = getActivity();
        if (act == null) { call.reject("activity nahi mili"); return; }

        immersiveChahiye = on;
        act.runOnUiThread(() -> {
            try {
                lagao(act, on);
                call.resolve();
            } catch (Throwable t) {
                call.reject("nahi laga -- " + t.getMessage());
            }
        });
    }

    /** Asli kaam.  MainActivity bhi isi ko bulati hai (onResume par). */
    static void lagao(Activity act, boolean on) {
        Window w = act.getWindow();
        // `false` = content ko system bars ke neeche mat dhakelo, poori
        // screen par failne do.
        WindowCompat.setDecorFitsSystemWindows(w, !on);
        WindowInsetsControllerCompat c =
                new WindowInsetsControllerCompat(w, w.getDecorView());
        if (on) {
            c.hide(WindowInsetsCompat.Type.systemBars());
            // Kinare se swipe karne par bar thodi der ko aa jaayein, phir
            // apne aap chhup jaayein -- warna TV par kuch galti se dab jaye
            // to bar hamesha ke liye chipak jaati hai.
            c.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }
}
