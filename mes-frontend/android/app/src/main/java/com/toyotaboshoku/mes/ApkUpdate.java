package com.toyotaboshoku.mes;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * APK KO APP KE ANDAR HI UTAARO AUR INSTALL KHOL DO.
 *
 * PEHLE KYA HOTA THA (aur galat tha)
 * ----------------------------------
 * "Download and update" dabate hi Capacitor ka Browser plugin CHROME khol
 * deta tha.  User app se bahar chala jaata, download Chrome me hota, phir
 * usse notification/Downloads folder me jaakar file dhoondhni padti.  Teen
 * jagah bhatakna padta tha ek update ke liye.
 *
 * AB
 * --
 * Download yahin hota hai (progress app me hi dikhti hai), file app ke apne
 * cache me girti hai, aur poora hote hi Android ka apna installer khul jaata
 * hai -- "Update" / "Install" wali screen.  Chrome kahin nahi aata.
 *
 * DO CHEEZEIN JO ZAROORI HAIN
 * ---------------------------
 * 1. `REQUEST_INSTALL_PACKAGES` permission (AndroidManifest me daali).
 *    Android 8+ par iske bina installer khulta hi nahi.
 * 2. FileProvider -- Android 7+ se `file://` wala URI doosri app ko dena
 *    MANA hai (FileUriExposedException aata hai).  `content://` dena padta
 *    hai.  Capacitor ka FileProvider pehle se manifest me hai, aur
 *    `file_paths.xml` me `cache-path` bhi -- isliye APK cache me hi rakhi
 *    hai, koi nayi jagah nahi kholni padi.
 *
 * Android 8+ par user ko ek baar "unknown apps install karne do" wali
 * ijaazat deni padti hai.  Wo na ho to hum use SEEDHA usi setting par bhej
 * dete hain -- warna installer chup-chaap kuch na karta aur samajh hi na
 * aata ki hua kya.
 */
@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdate extends Plugin {

    private static final String FILE = "maintenance.apk";

    /** APK utaaro, phir installer khol do.  Progress `progress` event se. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url nahi mila");
            return;
        }

        // Download UI thread par nahi ho sakta -- app jam jaayegi.
        new Thread(() -> {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(30000);
                con.setInstanceFollowRedirects(true);
                // ⚠ YE LINE ZAROORI HAI -- naap kar pakda tha.
                // HttpURLConnection apne aap `Accept-Encoding: gzip` bhejta hai.
                // Uspar hamara server APK ko GZIP + CHUNKED bhejta hai, aur tab
                // `Content-Length` header aata hi NAHI:
                //     gzip maanga  -> content-encoding: gzip, chunked, koi length nahi
                //     identity     -> content-length: 6351192
                // Length na mile to `getContentLength()` -1 deta hai, yaani na
                // progress ban paati thi na aakar ki jaanch ho paati thi.
                // Waise bhi APK pehle se compressed hai -- use gzip karne se
                // dono taraf CPU lagta hai aur bachta kuch nahi.
                con.setRequestProperty("Accept-Encoding", "identity");
                con.connect();

                int code = con.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) {
                    call.reject("Server ne " + code + " kaha");
                    return;
                }
                // ⚠ `getContentLengthLong()` NAHI -- wo API 24 ka hai aur is
                // app ka `minSdkVersion` 23 hai.  Android 6 par wo method
                // hota hi nahi, aur chalte waqt `NoSuchMethodError` aata hai
                // (compile par koi galti nahi dikhti -- isliye ye chup-chaap
                // baithi rehti).  `getContentLength()` API 1 se hai aur 2 GB
                // tak theek hai; hamari APK 6 MB ki hai.
                final long kul = con.getContentLength();       // -1 bhi ho sakta hai

                File out = new File(getContext().getCacheDir(), FILE);
                // Purani adhoori file padi ho to hata do -- warna uske upar
                // likhne se aadhi-purani aadhi-nayi file ban sakti hai.
                if (out.exists() && !out.delete()) {
                    call.reject("Purani file hat nahi rahi");
                    return;
                }

                try (InputStream in = con.getInputStream();
                     FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[65536];
                    long ab_tak = 0;
                    int last = -1;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        fos.write(buf, 0, n);
                        ab_tak += n;

                        // Length pata ho to percent, na ho to bhi khabar bhejo
                        // (`percent = -1`) -- taaki app "Downloading…" ke saath
                        // kitne MB aaye wo dikha sake, chup na baithe.
                        int pc = (kul > 0) ? (int) (ab_tak * 100 / kul) : -1;
                        // har chunk par event bhejne se JS bhar jaata hai --
                        // sirf tab bhejo jab kuch BADLA ho.  Length na ho to
                        // har 512 KB par ek khabar.
                        boolean bhejo = (kul > 0)
                                ? (pc != last)
                                : (ab_tak / 524288L != last);
                        if (bhejo) {
                            last = (kul > 0) ? pc : (int) (ab_tak / 524288L);
                            JSObject ev = new JSObject();
                            ev.put("percent", pc);
                            ev.put("kul", kul);
                            ev.put("abTak", ab_tak);
                            notifyListeners("progress", ev);
                        }
                    }
                    fos.flush();
                }

                long mila = out.length();
                if (kul > 0 && mila != kul) {
                    call.reject("File adhoori aayi (" + mila + "/" + kul + ")");
                    return;
                }

                installKholo(out, call, mila);

            } catch (Exception e) {
                call.reject("Download nahi hua — " + e.getMessage());
            } finally {
                if (con != null) con.disconnect();
            }
        }).start();
    }

    private void installKholo(File apk, PluginCall call, long size) {
        Context ctx = getContext();

        // Android 8+ : "unknown apps" ki ijaazat na ho to installer chup-chaap
        // kuch nahi karta.  Isliye pehle poochh lete hain, aur na ho to user ko
        // SEEDHA usi setting par bhej dete hain.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !ctx.getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
            } catch (Exception ignored) {
                // setting na khule to neeche wala jawab hi kaafi hai
            }
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("needsPermission", true);
            call.resolve(r);
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                    ctx, ctx.getPackageName() + ".fileprovider", apk);

            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Activity act = getActivity();
            if (act != null) {
                act.startActivity(i);           // app ke andar se hi
            } else {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            }

            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("size", size);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Installer nahi khula — " + e.getMessage());
        }
    }
}
