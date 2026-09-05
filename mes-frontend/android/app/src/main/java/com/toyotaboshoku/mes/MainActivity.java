package com.toyotaboshoku.mes;

import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
     * PHONE PAR ASAR NAHI: wahan meta `width=device-width` hi rehta hai, to
     * chaudai pehle jaisi device-width hi milti hai.
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
