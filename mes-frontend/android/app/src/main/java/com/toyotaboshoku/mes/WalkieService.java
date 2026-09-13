package com.toyotaboshoku.mes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.annotation.Nullable;

import org.json.JSONObject;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * WALKIE-TALKIE KA SUNNE WALA HISSA — FOREGROUND SERVICE.
 *
 * YE SERVICE KYUN ZAROORI HAI
 * ---------------------------
 * Android WebView ko app background me jaate hi ROK diya jaata hai.  Isi app
 * me ye naapa ja chuka hai: background me PDF banana beech me ruk jaata tha
 * aur app wapas kholte hi chalu ho jaata tha.  Matlab: jeb me pade phone par
 * WebView kabhi call nahi sun sakta.
 *
 * Isliye socket JAVA pakadta hai, aur wo bhi foreground service me (permanent
 * notification ke saath) — sirf isi tarah Android app ko zinda rehne deta hai.
 * BOLNE ka kaam WebView hi karta hai, kyunki button dabate waqt app khuli
 * hoti hi hai.
 *
 * AAWAZ
 * -----
 * Server raw PCM16 @ 16 kHz mono bhejta hai — koi codec nahi, koi container
 * nahi.  `AudioTrack` ise seedha baja deta hai, beech me kuch decode karne ki
 * zaroorat hi nahi.  (Kyun PCM — `routers/walkie.py` ke upar poora likha hai.)
 *
 * ⚠ AAWAZ KO SOCKET WALE THREAD PAR NAHI LIKHTE.  `AudioTrack.write()` buffer
 * bharne par RUK jaata hai; agar wo OkHttp ke reader thread par ho to poora
 * socket wahin atak jaata hai aur control ke message (rx_stop, buzz) bhi ruk
 * jaate hain.  Isliye beech me ek chhoti qatar aur apna writer thread hai.
 */
public class WalkieService extends Service {

    public static final String ACTION_START = "com.toyotaboshoku.mes.WALKIE_START";
    public static final String ACTION_STOP  = "com.toyotaboshoku.mes.WALKIE_STOP";
    private static final String TAG = "Walkie";
    private static final String CH_ID = "walkie";
    private static final int NOTIF_ID = 4711;

    private static final int RATE = 16000;

    /** Baahar se (plugin se) poochhne ke liye — service chal rahi hai ya nahi. */
    public static volatile boolean RUNNING = false;
    public static volatile boolean CONNECTED = false;
    public static volatile String LAST_ERR = "";

    private OkHttpClient http;
    private WebSocket ws;
    private String url = "", token = "";
    private volatile boolean chahiye = false;      // chalte rehna hai?
    private int retry = 0;
    private final Handler main = new Handler(Looper.getMainLooper());

    private AudioTrack track;
    private AudioFocusRequest focus;
    private Thread writer;
    private final ArrayBlockingQueue<byte[]> qatar = new ArrayBlockingQueue<>(64);
    private PowerManager.WakeLock wake;

    @Nullable @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        http = new OkHttpClient.Builder()
                // Server har taraf se chup ho jaye (Wi-Fi chala gaya, server
                // reboot) to socket ko pata hi nahi chalta.  Ping se wo haalat
                // ~40 second me pakdi jaati hai aur dobara jud jaate hain.
                .pingInterval(20, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)     // socket khula rehna hai
                .retryOnConnectionFailure(true)
                .build();
        naali();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(act)) {
            band();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            String u = intent.getStringExtra("url");
            String t = intent.getStringExtra("token");
            if (u != null && !u.isEmpty()) url = u;
            if (t != null && !t.isEmpty()) token = t;
        }
        aageKaro("Connecting…");
        chahiye = true;
        RUNNING = true;
        jodo();
        // START_STICKY: Android ne memory ke liye maar diya to wapas chalu kare.
        // Intent null aata hai us soorat me — isliye url/token field me sambhale
        // hue hain, intent par bharosa nahi karte.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        band();
        RUNNING = false;
        super.onDestroy();
    }

    // ── notification ──────────────────────────────────────────────
    private void naali() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CH_ID, "Walkie-Talkie", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the walkie-talkie listening while the app is closed");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification banao(String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, f);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CH_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("Walkie-Talkie")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_speakerphone)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    private void aageKaro(String text) {
        Notification n = banao(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void likho(String text) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIF_ID, banao(text));
            Log.i(TAG, "NOTIF " + text + " nm=" + (nm != null));
        } catch (Throwable e) { Log.w(TAG, "notif: " + e); }
    }

    // ── socket ────────────────────────────────────────────────────
    private void jodo() {
        if (!chahiye || url.isEmpty() || token.isEmpty()) return;
        String full = url + (url.contains("?") ? "&" : "?")
                + "role=rx&kind=native&token=" + android.net.Uri.encode(token);
        Request req = new Request.Builder().url(full).build();
        ws = http.newWebSocket(req, new WebSocketListener() {
            @Override public void onOpen(WebSocket s, Response r) {
                retry = 0;
                CONNECTED = true;
                LAST_ERR = "";
                likho("Listening");
            }

            @Override public void onMessage(WebSocket s, String text) {
                try {
                    JSONObject d = new JSONObject(text);
                    String t = d.optString("t");
                    if (!"presence".equals(t)) Log.i(TAG, "TXT " + t);
                    if ("buzz".equals(t)) {
                        JSONObject f = d.optJSONObject("from");
                        thartharao();
                        likho((f != null ? f.optString("name", "Someone") : "Someone") + " buzzed you");
                        main.postDelayed(() -> likho("Listening"), 6000);
                    } else if ("rx_start".equals(t)) {
                        JSONObject f = d.optJSONObject("from");
                        audioTaiyaar();
                        chirp();
                        likho((f != null ? f.optString("name", "Someone") : "Someone") + " is speaking…");
                    } else if ("rx_stop".equals(t)) {
                        likho("Listening");
                    }
                } catch (Throwable e) {
                    Log.w(TAG, "message: " + e);
                }
            }

            @Override public void onMessage(WebSocket s, ByteString bytes) {
                audioTaiyaar();
                // Qatar bhari ho to SABSE PURANA frame gira dete hain, naya
                // rakhte hain.  Live baat me purani aawaz ka koi matlab nahi —
                // aur bina iske qatar bharte hi socket ka thread ruk jaata.
                byte[] b = bytes.toByteArray();
                if (!qatar.offer(b)) { qatar.poll(); qatar.offer(b); }
            }

            @Override public void onClosed(WebSocket s, int code, String reason) {
                CONNECTED = false;
                if (code == 4403) {          // admin ne walkie se hata diya
                    LAST_ERR = "not on the walkie-talkie list";
                    chahiye = false;
                    likho("Not on the walkie-talkie list");
                    return;
                }
                if (code == 4401) {          // token purana ho gaya
                    LAST_ERR = "sign in again";
                    chahiye = false;
                    likho("Please open the app and sign in again");
                    return;
                }
                dobara();
            }

            @Override public void onFailure(WebSocket s, Throwable t, Response r) {
                CONNECTED = false;
                LAST_ERR = String.valueOf(t.getMessage());
                dobara();
            }
        });
    }

    private void dobara() {
        if (!chahiye) return;
        retry = Math.min(retry + 1, 6);
        long der = 1000L * (1L << (retry - 1));       // 1s → 32s
        likho("Reconnecting…");
        main.postDelayed(this::jodo, der);
    }

    private void band() {
        chahiye = false;
        CONNECTED = false;
        try { if (ws != null) ws.close(1000, "bye"); } catch (Throwable ignored) { /* pehle se band */ }
        ws = null;
        audioBand();
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable ignored) { /* pehle se chhoot gaya */ }
        wake = null;
    }

    // ── aawaz ─────────────────────────────────────────────────────
    private synchronized void audioTaiyaar() {
        if (track != null) return;
        int min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) min = RATE;                 // kuch device 0/-2 lauta dete hain
        int buf = Math.max(min, RATE / 2);        // ~0.5s — hichki jhelne ke liye

        /* ⚠ YAHAN PEHLE `USAGE_VOICE_COMMUNICATION` THA AUR WO GALAT NIKLA.
           Us usage par Android aawaz ko "phone call" maan leta hai: wo KAAN
           WALE chhote speaker (earpiece) par chali jaati hai aur CALL wale
           volume se bandh jaati hai.  Nateeja — device par test me sab kuch
           theek chalta dikha (frame aate rahe, notification badalti rahi) par
           phone se AAWAZ SUNAYI HI NAHI DI.

           `USAGE_MEDIA` par wo aam loudspeaker par aati hai aur MEDIA wale
           volume se chalti hai — yaani volume ke button se ghatai-badhai ja
           sakti hai.  `mediaPlayback` wali foreground-service ki kism bhi
           isi se milti hai (manifest dekho). */
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
        AudioFormat fmt = new AudioFormat.Builder()
                .setSampleRate(RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build();
        track = new AudioTrack(attrs, fmt, buf, AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE);
        // Track ka apna volume poora.  (Phone ka MEDIA volume iske upar alag
        // se lagta hai — wo user ke haath me rehna hi chahiye.)
        try { track.setVolume(AudioTrack.getMaxVolume()); } catch (Throwable ignored) { /* purana device */ }
        // Koi gaana/video chal raha ho to call ke waqt wo dheema ho jaye.
        focusLo(attrs);
        track.play();

        writer = new Thread(() -> {
            while (chahiye) {
                try {
                    byte[] b = qatar.poll(400, TimeUnit.MILLISECONDS);
                    AudioTrack t = track;
                    if (b != null && t != null) t.write(b, 0, b.length);
                } catch (InterruptedException e) {
                    return;
                } catch (Throwable e) {
                    Log.w(TAG, "write: " + e);
                }
            }
        }, "walkie-audio");
        writer.setPriority(Thread.MAX_PRIORITY);
        writer.start();
    }

    /* Audio focus: bina iske bajta to hai, par doosri app ka gaana saath me
       chalta rehta hai aur call uske neeche dab jaati hai. */
    private void focusLo(AudioAttributes attrs) {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs).build();
                am.requestAudioFocus(focus);
            } else {
                am.requestAudioFocus(null, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        } catch (Throwable e) { Log.w(TAG, "focus: " + e); }
    }

    private void focusChhodo() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focus != null) am.abandonAudioFocusRequest(focus);
            } else {
                am.abandonAudioFocus(null);
            }
        } catch (Throwable ignored) { /* pehle se chhoot gaya */ }
        focus = null;
    }

    /* Bolne se PEHLE ek chhoti si do-suron wali chirp — bilkul asli
       walkie-talkie jaisi.  Do kaam karti hai: sunne wale ko pata chal jaata
       hai ki koi bolne wala hai (warna pehla lafz kat jaata hai), aur ye khud
       hi sabit kar deti hai ki phone ki aawaz chaalu hai.
       Koi sound file nahi rakhi — PCM yahin bana lete hain, taaki APK me ek
       aur asset na jude aur naap (16 kHz) hamesha milti rahe. */
    private void chirp() {
        AudioTrack t = track;
        if (t == null) return;
        try {
            final int[] hz = { 1000, 1400 };
            final int ms = 70;
            for (int f : hz) {
                int n = RATE * ms / 1000;
                byte[] b = new byte[n * 2];
                for (int i = 0; i < n; i++) {
                    // shuru aur ant me halka fade -- warna "tik" ki awaaz aati hai
                    double fade = Math.min(1.0, Math.min(i, n - i) / (RATE * 0.005));
                    int v = (int) (6000 * fade * Math.sin(2 * Math.PI * f * i / (double) RATE));
                    b[i * 2] = (byte) (v & 0xff);
                    b[i * 2 + 1] = (byte) ((v >> 8) & 0xff);
                }
                if (!qatar.offer(b)) { qatar.poll(); qatar.offer(b); }
            }
        } catch (Throwable e) { Log.w(TAG, "chirp: " + e); }
    }

    private synchronized void audioBand() {
        qatar.clear();
        Thread w = writer; writer = null;
        if (w != null) w.interrupt();
        focusChhodo();
        AudioTrack t = track; track = null;
        if (t != null) {
            try { t.stop(); } catch (Throwable ignored) { /* pehle se ruka hua */ }
            try { t.release(); } catch (Throwable ignored) { /* pehle se chhoot gaya */ }
        }
    }

    private void thartharao() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            Log.i(TAG, "VIB v=" + (v != null) + " has=" + (v != null && v.hasVibrator()));
            if (v == null || !v.hasVibrator()) return;
            long[] pat = { 0, 260, 120, 260, 120, 260 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pat, -1));
            } else {
                v.vibrate(pat, -1);
            }
        } catch (Throwable e) {
            Log.w(TAG, "vibrate: " + e);
        }
    }
}
