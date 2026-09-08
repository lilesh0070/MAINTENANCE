package com.toyotaboshoku.mes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * TV/DEVICE ON HOTE HI APP KHUD KHUL JAYE.
 *
 * KYUN
 * ----
 * Board deewar par lagi TV hai.  Bijli jaane ya TV band hone ke baad kisi ko
 * jaakar app kholni padti thi -- tab tak board khaali khada rehta.
 *
 * KAISE
 * -----
 * Android boot poora hone par `BOOT_COMPLETED` bhejta hai; wahi pakad kar
 * `MainActivity` chala dete hain.
 *
 * Teen alag broadcast sunte hain, kyunki har device ek jaisa nahi hota:
 *   BOOT_COMPLETED        -- aam Android
 *   QUICKBOOT_POWERON     -- kai TV/box "quick boot" par yahi bhejte hain
 *   LOCKED_BOOT_COMPLETED -- Android 7+ me PIN lagne se PEHLE aata hai
 *
 * ⚠ HAR DEVICE PAR CHALEGA, YE PAKKA NAHI.
 * Android 10+ me "background se activity kholna" par rok hai.  Bahut se TV
 * box ise chalne dete hain (aur kai me Settings me "autostart / self-start"
 * ka switch hota hai jise ek baar on karna padta hai), par kuch phone ise
 * rok denge.  Isliye ye JODA hai, uspar TIKA nahi -- na chale to app pehle
 * jaisi haath se hi khulegi, aur kuch tootta nahi.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String a = intent.getAction();
        if (!(Intent.ACTION_BOOT_COMPLETED.equals(a)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(a)
                || "android.intent.action.QUICKBOOT_POWERON".equals(a)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(a))) {
            return;
        }
        try {
            Intent i = new Intent(ctx, MainActivity.class);
            // Receiver ka apna koi task nahi hota, isliye NEW_TASK lazmi hai.
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Throwable t) {
            // Kuch bhi ho to chup-chaap chhod do -- boot ke waqt phatna
            // sabse bura hai, aur app to haath se khul hi jaayegi.
        }
    }
}
