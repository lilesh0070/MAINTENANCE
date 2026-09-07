package com.toyotaboshoku.mes;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Bundle;
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
            int sw = getResources().getConfiguration().smallestScreenWidthDp;
            if (mode == Configuration.UI_MODE_TYPE_NORMAL && sw >= 600 && sw < 920) {
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
        registerPlugin(ApkUpdate.class);

        super.onCreate(savedInstanceState);
        try {
            WebSettings s = getBridge().getWebView().getSettings();
            s.setUserAgentString(s.getUserAgentString() + " TBDev/" + kisKismKaDevice());
        } catch (Exception e) {
            // Na juda to `index.html` apne purane niyam par chala jaayega.
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
