package com.toyotaboshoku.mes;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * APP KI ATAK KA LOG (2026-09-21).
 *
 * User: "TV me din bhar 'Close app / Wait' aata hai -- log bana de, aaye to
 * log bhej de jisse tu dekh sake."  Wo dabba (ANR) tab aata hai jab app ka
 * MAIN thread 5 sec se zyada atka rahe.  Kahan atka -- yahi jaanna hai.
 *
 * DO RAASTE
 *   1. PEHREDAAR (har Android par): alag thread har 1 sec main thread ko ek
 *      chhota kaam deta hai.  4 sec tak na ho to main thread ATKA hai -- uska
 *      stack (kis line par atka), baaki threads aur memory likh lete hain.
 *      Atak lambi chale to 10 aur 20 sec par phir, aur chhootne par kul der.
 *   2. ANDROID KA APNA HISAAB (Android 11+): pichhli baar app kyun band hui
 *      (ANR / crash / kam memory) -- ANR par Android ka POORA trace (saare
 *      thread, WebView ke native bhi).  Update ke baad pehli baar khulte hi
 *      pichhle 7 din ke bhi aa jaate hain.
 *
 * Report FILE me (files/anr/*.json) -- "Close app" dabate hi process mar
 * jaata hai, memory me rakhi cheez kho jaati.  Page (`AppDiag.jsx`) plugin se
 * uthaakar server ko bhejta hai (`/api/app/diag`, login ke saath), phir yahan
 * se mita deta hai.  Server band / login nahi -- file padi rehti hai, baad me.
 *
 * KHUD KOI BOJH NAHI: 1 sec me ek khaali kaam main thread par, bas.  Report
 * sirf atak par.  30 se zyada file ho to sabse purani hat-ti hai.
 */
@CapacitorPlugin(name = "AnrLog")
public class AnrLog extends Plugin {
    private static final String TAG = "AnrLog";
    private static final long TICK_MS = 1000;
    /** Atak ke in padaavon par stack utaaro -- Android ka ANR 5 sec par. */
    private static final long[] PADAAV_MS = { 4000, 10000, 20000 };
    private static final int MAX_FILES = 30;
    private static final int MAX_TRACE = 150_000;      // Android ke ANR trace me se itna
    private static final int MAX_THREADS = 60_000;     // baaki threads ka hissa
    private static final int EK_BAAR = 2;              // pending() ek baar me kitni

    private static volatile boolean chalu = false;
    private static Context app;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    /** JS batata hai app kaunse page par hai (atak ki report me jaata hai). */
    static volatile String jagah = "";
    /** Abhi chal rahi atak ki report -- `pending()` ise nahi deta (adhoori hai). */
    private static volatile String chaluId = null;

    /** MainActivity / WalkieService ke onCreate se.  Dobara bulane par kuch nahi. */
    static synchronized void shuru(Context c) {
        if (chalu || c == null) return;
        chalu = true;
        app = c.getApplicationContext();
        Thread t = new Thread(AnrLog::pehra, "anr-pehredaar");
        t.setDaemon(true);
        t.setPriority(Thread.MAX_PRIORITY);     // bojh me bhi jaagta rahe
        t.start();
        Thread e = new Thread(AnrLog::pichhliBaar, "anr-exit-info");
        e.setDaemon(true);
        e.start();
    }

    // ── 1. pehredaar ───────────────────────────────────────────────────
    private static void pehra() {
        while (true) {
            try {
                final AtomicLong mila = new AtomicLong(0);
                final long bheja = SystemClock.uptimeMillis();
                MAIN.post(() -> mila.set(SystemClock.uptimeMillis()));
                SystemClock.sleep(TICK_MS);
                if (mila.get() != 0) continue;                 // main thread theek hai
                /* Ye thread KHUD der se jaaga (process ruka tha -- Android ka
                   freezer, phone so gaya) -- main thread ki galti nahi.  Is
                   chakkar ko chhodo, naye sire se naapo. */
                if (SystemClock.uptimeMillis() - bheja > TICK_MS + 2000) continue;

                long shuruAtak = bheja;
                long pichhla = SystemClock.uptimeMillis();
                int padaav = 0;
                String id = null;
                StringBuilder likha = null;
                String pehlaFrame = "";
                while (mila.get() == 0) {
                    SystemClock.sleep(250);
                    long ab = SystemClock.uptimeMillis();
                    if (ab - pichhla > 2000) shuruAtak += (ab - pichhla - 250);   // khud ruka tha -- wo waqt mat gino
                    pichhla = ab;
                    long atka = ab - shuruAtak;
                    if (padaav < PADAAV_MS.length && atka >= PADAAV_MS[padaav]) {
                        StackTraceElement[] st = Looper.getMainLooper().getThread().getStackTrace();
                        if (likha == null) {
                            id = "stall-" + System.currentTimeMillis();
                            chaluId = id;
                            likha = new StringBuilder();
                            likha.append(device()).append('\n');
                            pehlaFrame = pehlaKaamKa(st);
                        }
                        likha.append("\n== MAIN THREAD, ").append(sec(atka)).append(" s atka ==\n");
                        likha.append(stack(st, 60));
                        if (padaav == 0) {
                            likha.append("\n== MEMORY ==\n").append(memory());
                            likha.append("\n== BAAKI THREADS ==\n").append(threads());
                        }
                        likhoFile(id, "stall", "Main thread " + sec(atka) + " s se atka -- " + pehlaFrame,
                                  likha.toString());
                        Log.w(TAG, "main thread " + sec(atka) + " s se atka: " + pehlaFrame);
                        padaav++;
                    }
                }
                if (likha != null) {
                    long kul = mila.get() - shuruAtak;
                    likha.append("\n== CHHOOTA: kul ").append(sec(kul)).append(" s atka raha ==\n");
                    likhoFile(id, "stall", "Main thread " + sec(kul) + " s atka -- " + pehlaFrame,
                              likha.toString());
                    Log.w(TAG, "main thread chhoota, kul " + sec(kul) + " s");
                    chaluId = null;
                }
            } catch (Throwable e) {
                // Pehredaar khud kabhi na mare -- thoda ruk kar phir
                chaluId = null;
                Log.w(TAG, "pehra: " + e);
                SystemClock.sleep(5000);
            }
        }
    }

    /** Summary ke liye: stack ki pehli asli line, aur neeche HAMARI app ki
     *  pehli line (`com.toyotaboshoku`) -- "kya atka" aur "kisne bulaya" ek
     *  saath.  Jaise:  SystemClock.sleep(…) <- AnrLog.lambda$test$6(AnrLog.java:431) */
    private static String pehlaKaamKa(StackTraceElement[] st) {
        if (st == null || st.length == 0) return "(khaali stack)";
        String upar = null, hamara = null;
        for (StackTraceElement e : st) {
            String s = e.toString();
            if (upar == null) {
                if (s.startsWith("android.os.MessageQueue.nativePollOnce")) {
                    return "main thread KHAALI baitha (nativePollOnce) -- qatar ruki hui";
                }
                if (s.startsWith("java.lang.Thread.sleep") || s.startsWith("java.lang.Object.wait")
                        || s.startsWith("dalvik.system.VMStack") || s.startsWith("java.lang.Thread.getStackTrace")) {
                    continue;
                }
                upar = s;
            }
            if (s.startsWith("com.toyotaboshoku.")) { hamara = s; break; }
        }
        if (upar == null) upar = st[0].toString();
        return (hamara == null || hamara.equals(upar)) ? upar : upar + " <- " + hamara;
    }

    // ── 2. Android ka apna hisaab (API 30+) ───────────────────────────────
    private static void pichhliBaar() {
        if (Build.VERSION.SDK_INT < 30) return;
        try {
            SharedPreferences sp = app.getSharedPreferences("anrlog", Context.MODE_PRIVATE);
            long dekha = sp.getLong("exit_dekha", 0);
            long hafta = System.currentTimeMillis() - 7L * 24 * 3600 * 1000;
            ActivityManager am = app.getSystemService(ActivityManager.class);
            if (am == null) return;
            List<ApplicationExitInfo> l =
                    am.getHistoricalProcessExitReasons(app.getPackageName(), 0, 16);
            long naya = dekha;
            for (ApplicationExitInfo x : l) {
                long ts = x.getTimestamp();
                if (ts > naya) naya = ts;
                if (ts <= dekha || ts < hafta) continue;
                String naam = kyun(x.getReason());
                if (naam == null) continue;                    // aam band hona -- report nahi
                StringBuilder d = new StringBuilder();
                d.append(device());
                d.append("(upar ki page / saamne / service -- app DOBARA khulne ke waqt ki hai, band hone ke waqt ki nahi)\n");
                d.append("\n== ANDROID NE APP BAND KI ==\n");
                d.append("kyun        : ").append(naam).append(" (").append(x.getReason()).append(")\n");
                d.append("kab         : ").append(waqt(ts)).append('\n');
                d.append("process     : ").append(x.getProcessName()).append('\n');
                d.append("importance  : ").append(x.getImportance()).append("  (100 = saamne, 125 = service)\n");
                d.append("status      : ").append(x.getStatus()).append('\n');
                d.append("pss / rss   : ").append(x.getPss()).append(" KB / ").append(x.getRss()).append(" KB\n");
                d.append("description : ").append(x.getDescription()).append('\n');
                if (x.getReason() == ApplicationExitInfo.REASON_ANR) {
                    try (InputStream in = x.getTraceInputStream()) {
                        if (in != null) d.append("\n== ANDROID KA ANR TRACE ==\n").append(padho(in, MAX_TRACE));
                    } catch (Throwable ignored) { /* trace na mila */ }
                }
                String desc = x.getDescription() == null ? "" : x.getDescription();
                likhoFile("exit-" + ts + "-" + x.getReason(), naam,
                          "Android ne app band ki: " + naam + (desc.isEmpty() ? "" : " -- " + desc),
                          d.toString(), ts);
            }
            sp.edit().putLong("exit_dekha", naya).apply();
        } catch (Throwable e) {
            Log.w(TAG, "exit info: " + e);
        }
    }

    /** Sirf wahi kaaran jo gadbad batate hain; baaki (update, user ne band ki) null. */
    private static String kyun(int r) {
        switch (r) {
            case 2:  return "signaled";                 // REASON_SIGNALED
            case 3:  return "low_memory";               // REASON_LOW_MEMORY
            case 4:  return "crash";                    // REASON_CRASH
            case 5:  return "crash_native";             // REASON_CRASH_NATIVE
            case 6:  return "anr";                      // REASON_ANR
            case 7:  return "init_failure";             // REASON_INITIALIZATION_FAILURE
            case 9:  return "excessive_resource";       // REASON_EXCESSIVE_RESOURCE_USAGE
            case 13: return "other";                    // REASON_OTHER
            case 14: return "freezer";                  // REASON_FREEZER (API 33)
            default: return null;
        }
    }

    // ── report ki jaankari ─────────────────────────────────────────────
    private static String device() {
        StringBuilder b = new StringBuilder();
        b.append("device      : ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
         .append(" (").append(Build.DEVICE).append(")\n");
        b.append("android     : ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                PackageInfo w = android.webkit.WebView.getCurrentWebViewPackage();
                if (w != null) b.append("webview     : ").append(w.packageName).append(' ').append(w.versionName).append('\n');
            }
        } catch (Throwable ignored) { /* purana Android */ }
        b.append("page        : ").append(jagah).append('\n');
        b.append("saamne      : ").append(WalkieService.APP_FOREGROUND)
         .append("   service: ").append(WalkieService.RUNNING)
         .append("   socket: ").append(WalkieService.CONNECTED).append('\n');
        b.append("waqt        : ").append(waqt(System.currentTimeMillis())).append('\n');
        return b.toString();
    }

    private static String memory() {
        StringBuilder b = new StringBuilder();
        Runtime rt = Runtime.getRuntime();
        b.append("java heap   : ").append(mb(rt.totalMemory() - rt.freeMemory())).append(" / max ")
         .append(mb(rt.maxMemory())).append(" MB\n");
        b.append("native heap : ").append(mb(Debug.getNativeHeapAllocatedSize())).append(" MB\n");
        try {
            ActivityManager am = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            b.append("device RAM  : khaali ").append(mb(mi.availMem)).append(" / kul ").append(mb(mi.totalMem))
             .append(" MB   kam-memory: ").append(mi.lowMemory).append('\n');
        } catch (Throwable ignored) { /* na mila */ }
        return b.toString();
    }

    private static String threads() {
        StringBuilder b = new StringBuilder();
        Map<Thread, StackTraceElement[]> all = Thread.getAllStackTraces();
        List<Thread> ts = new ArrayList<>(all.keySet());
        // Collections.sort -- `List.sort` API 24 se hai, app 23 par bhi chalti hai
        Collections.sort(ts, (x, y) -> String.valueOf(x.getName()).compareTo(String.valueOf(y.getName())));
        Thread main = Looper.getMainLooper().getThread();
        for (Thread t : ts) {
            if (t == main || t == Thread.currentThread()) continue;
            StackTraceElement[] st = all.get(t);
            if (st == null || st.length == 0) continue;
            b.append("\n-- ").append(t.getName()).append(" [").append(t.getState()).append("]\n");
            b.append(stack(st, 12));
            if (b.length() > MAX_THREADS) { b.append("\n…(baaki threads chhode)\n"); break; }
        }
        return b.toString();
    }

    private static String stack(StackTraceElement[] st, int max) {
        StringBuilder b = new StringBuilder();
        if (st == null) return "(stack nahi mila)\n";
        for (int i = 0; i < st.length && i < max; i++) b.append("    at ").append(st[i]).append('\n');
        if (st.length > max) b.append("    …").append(st.length - max).append(" aur\n");
        return b.toString();
    }

    private static String sec(long ms) { return String.format(Locale.US, "%.1f", ms / 1000.0); }
    private static long mb(long b) { return b / (1024 * 1024); }
    private static String waqt(long ms) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date(ms));
    }

    private static String padho(InputStream in, int max) throws java.io.IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while (o.size() < max && (n = in.read(buf)) > 0) o.write(buf, 0, Math.min(n, max - o.size()));
        return new String(o.toByteArray(), StandardCharsets.UTF_8);
    }

    // ── file ─────────────────────────────────────────────────────────────
    private static File dir() {
        File d = new File(app.getFilesDir(), "anr");
        if (!d.isDirectory()) //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
        return d;
    }

    private static void likhoFile(String id, String kind, String summary, String detail) {
        likhoFile(id, kind, summary, detail, System.currentTimeMillis());
    }

    private static synchronized void likhoFile(String id, String kind, String summary, String detail, long atMs) {
        try {
            File d = dir();
            File f = new File(d, saaf(id) + ".json");
            if (!f.exists()) {
                // 30 se zyada ho gayi to sabse purani hatao -- disk na bhare
                File[] fs = d.listFiles((x, n) -> n.endsWith(".json"));
                if (fs != null && fs.length >= MAX_FILES) {
                    Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
                    for (int i = 0; i <= fs.length - MAX_FILES; i++) //noinspection ResultOfMethodCallIgnored
                        fs[i].delete();
                }
            }
            JSONObject o = new JSONObject();
            o.put("id", saaf(id));
            o.put("kind", kind);
            o.put("at_ms", atMs);
            o.put("summary", summary);
            o.put("detail", detail);
            o.put("path", jagah);
            File tmp = new File(d, saaf(id) + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (!tmp.renameTo(f)) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                //noinspection ResultOfMethodCallIgnored
                tmp.renameTo(f);
            }
        } catch (Throwable e) {
            Log.w(TAG, "file: " + e);
        }
    }

    private static String saaf(String id) {
        return id == null ? "x" : id.replaceAll("[^A-Za-z0-9_-]", "_");
    }

    // ── page ke liye ───────────────────────────────────────────────────
    /** Bhejne ko padi reports (sabse purani pehle), ek baar me do. */
    @PluginMethod
    public void pending(PluginCall call) {
        JSArray arr = new JSArray();
        int baaki = 0;
        try {
            if (app == null) shuru(getContext());
            File[] fs = dir().listFiles((x, n) -> n.endsWith(".json"));
            if (fs != null) {
                Arrays.sort(fs, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
                String abhi = chaluId;
                for (File f : fs) {
                    String id = f.getName().substring(0, f.getName().length() - 5);
                    if (id.equals(abhi)) continue;            // atak abhi chal rahi -- adhoori
                    if (arr.length() >= EK_BAAR) { baaki++; continue; }
                    try (FileInputStream in = new FileInputStream(f)) {
                        arr.put(new JSONObject(padho(in, 1_000_000)));
                    } catch (Throwable bad) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();                          // kharab file -- hatao
                    }
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "pending: " + e);
        }
        JSObject r = new JSObject();
        r.put("reports", arr);
        r.put("baaki", baaki);
        call.resolve(r);
    }

    /** Server ne le li -- in id ki file mita do. */
    @PluginMethod
    public void done(PluginCall call) {
        try {
            JSArray ids = call.getArray("ids");
            if (ids != null) {
                for (int i = 0; i < ids.length(); i++) {
                    //noinspection ResultOfMethodCallIgnored
                    new File(dir(), saaf(ids.getString(i)) + ".json").delete();
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "done: " + e);
        }
        call.resolve();
    }

    /** App kaunse page par hai -- JS har page badalne par batata hai. */
    @PluginMethod
    public void jagah(PluginCall call) {
        String p = call.getString("path", "");
        jagah = p == null ? "" : (p.length() > 200 ? p.substring(0, 200) : p);
        call.resolve();
    }

    /* JAANCH KA TAREEQA (2026-09-21, emulator): ek kachcha `test()` method
     * jodkar main thread ko `SystemClock.sleep()` se 15-28 sec roka, aur beech
     * me `adb shell input keyevent 59` bheje -- Android ne asli ANR likha
     * ("Input dispatching timed out"), pehredaar ne 4/10/20 sec par stack
     * pakda, report DB tak gayi.  `am crash` se Android-record wala raasta.
     * Wo method JAAN-BOOJH KAR HATA DIYA: release APK bhi debuggable banti hai
     * (release_app.py -> assembleDebug), to wo asli app me bhi chal jaata. */
}
