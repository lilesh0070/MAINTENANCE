package com.toyotaboshoku.mes;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * DEVICE KIS KISM KA HAI -- ye faisla Android se hi poochha jaata hai.
     *
     * KYUN JAVA SE, JS SE KYUN NAHI
     * -----------------------------
     * Pehle `index.html` me UA dekh kar faisla hota tha: UA me "Mobile" na ho
     * to TV.  Ye TV ke liye to chalta hai, par TABLET par GALAT nikla --
     * Android tablet ke WebView ke UA me bhi "Mobile" hota hi nahi.  Emulator
     * par naap kar dekha (10 inch, 1280x800 dp):
     *
     *     ua       : ...Chrome/124.0.6367.219 Safari/537.36   <- "Mobile" nahi
     *     mobileUA : false   ->  __tv = true   ->  class "in-app-tv"
     *
     * Yaani tablet ko TV samajh kar 800dp ki screen par 1350 ka layout mil
     * raha tha, aur sab kuch chhota-chhota dikhta tha.
     *
     * Screen ki chaudai se bhi ye faisla nahi ho sakta -- TV aur badi tablet
     * ke naap aapas me mil jaate hain.  Android khud ye baatein theek-theek
     * jaanta hai, isliye wahi se poochh lete hain.
     *
     * ⚠ SABSE EHM BAAT -- YE SIRF TABLET KO BACHANE KE LIYE HAI.
     *
     * Ye method jaan-boojh kar "phone" KABHI NAHI lautata.  Jab tak pakka
     * pata na ho, `"auto"` lautata hai, aur `index.html` phir apne PURANE
     * niyam par chala jaata hai (UA ka "Mobile" + screen.width >= 900).
     *
     * Kyun: agar plant wali TV ko Android kisi wajah se "television" na
     * bataye (har bada Android panel asli "Android TV" nahi hota), aur yahan
     * se "phone" chala jaata, to TV par PHONE ka layout lag jaata -- 412px ke
     * liye tune kiye hue 220 rule ek bade board par.  Wo sabse buri galti
     * hoti.  "auto" lautane se aisi haalat me TV ka bartaav bilkul PEHLE
     * JAISA rehta hai.
     *
     *   "tv"   : UI_MODE_TYPE_TELEVISION ya FEATURE_LEANBACK
     *            (dono Android TV par lazmi hain -- Google ki apni shart hai)
     *   "tab"  : UI_MODE_TYPE_NORMAL ho (yaani Android khud kah raha hai ki
     *            ye aam handheld device hai, TV/car/watch nahi) AUR
     *            smallestScreenWidthDp 600 se 920 ke beech ho.
     *            600 Android ka apna paimana hai (`sw600dp` folder isi par
     *            chalti hai); 920 ki upri hadd isliye ki koi bahut badi
     *            screen galti se tablet na ban jaaye.
     *   "auto" : baaki sab -- purana niyam chalega
     */
    private String kisKismKaDevice() {
        int mode = Configuration.UI_MODE_TYPE_UNDEFINED;
        try {
            UiModeManager um = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (um != null) mode = um.getCurrentModeType();
        } catch (Exception e) {
            // undefined hi rehne do -- neeche "auto" nikal jaayega
        }
        try {
            if (mode == Configuration.UI_MODE_TYPE_TELEVISION
                    || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK)) {
                return "tv";
            }
        } catch (Exception e) {
            // aage dekh lete hain
        }
        try {
            Configuration cf = getResources().getConfiguration();
            int sw = cf.smallestScreenWidthDp;
            if (mode == Configuration.UI_MODE_TYPE_NORMAL && sw >= 600 && sw < 920) {
                /* TABLET ya TV?  Dono ki chaudai is band me aa jaati hai.
                 *
                 * Plant wali TV ka naap naapa gaya: 804 x 1428 dp -- yaani
                 * `sw = 804`, theek tablet ki hadd me.  Isi wajah se use
                 * "tab" mil raha tha aur TV wala 1350 ka layout nahi milta
                 * tha; nateeja -- Dashboard 411px bahar nikal jaata tha.
                 *
                 * Farq NAAP KA ANUPAT hai:
                 *     TV     16:9  -> 1428 / 804  = 1.78
                 *     tablet 16:10 -> 1280 / 800  = 1.60   (10 inch)
                 *            4:3   -> 1024 / 768  = 1.33
                 * 1.70 ki hadd beech me padti hai, dono se door.
                 *
                 * Sirf lamba-chaudai ka anupat dekhte hain, orientation ka
                 * farq nahi padta -- TV rotate karke lagayi hai. */
                int lamba  = Math.max(cf.screenWidthDp, cf.screenHeightDp);
                int chauda = Math.min(cf.screenWidthDp, cf.screenHeightDp);
                if (chauda > 0 && (double) lamba / chauda >= 1.70) return "tv";
                return "tab";
            }
        } catch (Exception e) {
            // "auto" hi theek hai
        }
        return "auto";
    }

    /**
     * Jawab JS tak UA ke aakhir me jodkar bheja jaata hai -- ` TBDev/tab`.
     *
     * WAQT KA HISAAB (ye ehm hai): `super.onCreate()` ke andar Capacitor
     * `loadUrl()` kar deta hai, par wo TURANT nahi chalta -- Android ki UI
     * thread ek hi hai aur wo `onCreate` poora khatam hone ka intezaar karti
     * hai.  Isliye yahan UA badalna page ke apne JS se PEHLE hi ho jaata hai.
     * Ye race nahi hai, pakka kram hai.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin `super.onCreate()` se PEHLE register karna padta hai --
        // wahin Capacitor bridge banata hai aur usi waqt plugin ki list
        // padhta hai.  Baad me register karne se JS ko plugin milta hi nahi.
        //
        // ⚠ try/catch JAAN-BOOJH KAR: ye app ke shuru hone ka pehla kaam hai.
        // Yahan kuch bhi phata (plugin ki class load na ho, koi purana Android
        // kisi API par atak jaaye) to APP HI NAHI KHULEGI -- aur wo update ke
        // ek button ke liye bahut badi keemat hai.  Na chala to bas update
        // purane tareeqe (browser) se hoga, baaki app poori chalti rahegi.
        try {
            registerPlugin(ApkUpdate.class);
            registerPlugin(ScreenMode.class);
            registerPlugin(SheetTools.class);
        } catch (Throwable t) {
            // chup-chaap chhod do -- JS me plugin na milne par wahan pehle se
            // browser wala raasta rakha hua hai.
        }

        super.onCreate(savedInstanceState);

        /* NOTCH / PUNCH-HOLE WALI JAGAH TAK APP FAILE.
         *
         * Ye setting `styles.xml` me bhi hai (`windowLayoutInDisplayCutoutMode`),
         * par uspar BHAROSA NAHI kiya ja sakta: Capacitor theme ko CODE me
         * set karta hai (`BridgeActivity.onCreate` -> `setTheme(...)`), aur
         * window ban chukne ke BAAD theme badalne se window wale attribute
         * lagte hi nahi.  Isliye yahan seedha WINDOW par laga rahe hain --
         * yahi pakka raasta hai.
         *
         * ALWAYS (API 30+) chunte hain, SHORT_EDGES nahi: SHORT_EDGES sirf
         * chhoti taraf ke cutout me jaane deta hai, ALWAYS har haalat me.
         * Purane Android (28-29) par ALWAYS hai hi nahi, wahan SHORT_EDGES.
         */
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.layoutInDisplayCutoutMode =
                        (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                getWindow().setAttributes(lp);
            }
        } catch (Throwable t) {
            // na lage to app pehle jaisi chalti rahe
        }

        try {
            WebSettings s = getBridge().getWebView().getSettings();
            s.setUserAgentString(s.getUserAgentString() + " TBDev/" + kisKismKaDevice());
        } catch (Exception e) {
            // Na juda to `index.html` apne purane niyam par chala jaayega.
        }

        /* POORI SCREEN -- YAHIN SE, JS KA INTEZAAR KIYE BINA.
         *
         * ⚠ PEHLE YE SIRF JS SE LAGTA THA (`apiBase.js` -> ScreenMode plugin).
         * Wo NAAZUK tha: plugin bridge taiyaar na ho to code do koshish ke baad
         * chhod deta tha, aur tab bar/notch wali patti reh jaati thi.  User ke
         * phone par yahi hua -- emulator par plugin waqt par mil jaata tha,
         * isliye wahan kabhi nahi dikha.
         *
         * Ab ye app khulte hi Java me ho jaata hai.  JS wala raasta bhi rehne
         * diya hai (bemaani nahi -- do baar lagne se kuch bigadta nahi), par
         * ab uspar TIKA nahi hai. */
        try {
            ScreenMode.immersiveChahiye = true;
            ScreenMode.lagao(this, true);
        } catch (Throwable t) {
            // na lage to app pehle jaisi chalti rahe
        }
    }

    /**
     * Window ko focus milte hi poori screen dobara laga do.
     *
     * Android system bars ko KAI mauqon par wapas dikha deta hai -- keyboard
     * band hone par, kisi dialog ke baad, screen on hone par.  `onResume`
     * un sab ko nahi pakadta, par focus milna pakadta hai.  Yahi wo jagah hai
     * jahan immersive ko dobara lagana chahiye.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        try {
            if (hasFocus && ScreenMode.immersiveChahiye) ScreenMode.lagao(this, true);
        } catch (Throwable t) {
            // chalne do
        }
    }

    /**
     * TV par layout ko 1350 ki chaudai chahiye (usi naap par `.md-portrait` /
     * `.mk-portrait` tune hue the).  Wo `index.html` me viewport meta se
     * maanga jaata hai -- `width=1350`.
     *
     * Par Capacitor WebView me `useWideViewPort` BAND aata hai, aur band ho to
     * WebView viewport ka `width=` MAANTA HI NAHI (sirf `initial-scale`
     * maanta hai).  Isi wajah se TV par chaudai 1350 nahi ban rahi thi aur
     * charts bahar ja rahe the.
     *
     * CSS `zoom` se bhi karke dekha -- content ko 1350 to mil jaate the, par
     * MEDIA QUERY phir bhi device ki asli chaudai (412/540) dekhti thi, yaani
     * site ki apni `max-width: 640px` wali rules TV par galat chal jaati.
     * Isliye wo raasta chhod diya.
     *
     * Ye laga dene se meta ka `width=` chalne lagta hai aur media query bhi
     * wahi chaudai dekhti hai -- bilkul waisa hi jaisa TV ke BROWSER me hota
     * hai.
     *
     * PHONE/TABLET PAR ASAR NAHI: wahan meta `width=device-width` hi rehta
     * hai, to chaudai pehle jaisi device-width hi milti hai.
     */
    /**
     * TV par poori-screen wapas laga do.  Android app ke saamne aane par
     * (ya kisi dialog ke baad) status/navigation bar khud wapas dikha deta
     * hai -- to board par kaali patti phir se aa jaati.  `immersiveChahiye`
     * sirf tab sach hota hai jab JS ne device ko TV maana ho; phone par ye
     * kuch nahi karta.
     */
    @Override
    public void onResume() {
        super.onResume();
        try {
            if (ScreenMode.immersiveChahiye) ScreenMode.lagao(this, true);
        } catch (Throwable t) {
            // poori screen na lage to bhi app chalti rahe
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        try {
            android.webkit.WebView wv = getBridge().getWebView();
            WebSettings s = wv.getSettings();
            s.setUseWideViewPort(true);
            s.setLoadWithOverviewMode(true);

            // WebView ka apna background bhi SAFED hota hai, aur wahi aakhri
            // jhalak deta hai -- window ka rang theek karne ke baad bhi.
            // Isliye use bhi app ke rang par kar dete hain.
            wv.setBackgroundColor(
                    androidx.core.content.ContextCompat.getColor(this, R.color.appBackground));
        } catch (Exception e) {
            // Kuch bhi ho to app pehle jaisi chalti rahe.
        }
    }
}
