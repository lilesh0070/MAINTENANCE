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
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.annotation.Nullable;

import android.app.RemoteInput;

import org.json.JSONObject;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
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
    /** Notification ke "OK" se aata hai — ring/vibration band. */
    public static final String ACTION_ACK   = "com.toyotaboshoku.mes.WALKIE_ACK";
    /** Notification ki patti par tap — band bhi karo aur app bhi kholo. */
    public static final String ACTION_ACK_OPEN = "com.toyotaboshoku.mes.WALKIE_ACK_OPEN";
    /** Notification ke likhne wale dabbe se aaya jawab. */
    public static final String ACTION_REPLY = "com.toyotaboshoku.mes.WALKIE_REPLY";
    /** RemoteInput ka khaana — isi naam se likha hua text nikalta hai. */
    private static final String KEY_REPLY = "walkie_reply_text";
    /** App abhi saamne khuli hai kya — MainActivity set karti hai.
     *  Khuli ho to chat ki notification NAHI dikhate: wo baat page par pehle
     *  hi dikh rahi hoti hai, aur do jagah ek hi cheez dikhana pareshan karta
     *  hai.  (Buzz ki ring par ye laagu NAHI — wo dikhni hi chahiye.) */
    public static volatile boolean APP_FOREGROUND = false;
    private static final String TAG = "Walkie";
    private static final String CH_ID = "walkie";           // chupchaap chalti service
    private static final String CH_CALL = "walkie_call";    // buzz aane par — awaaz ke saath
    private static final String CH_CHAT = "walkie_chat";    // likha hua message
    private static final int NOTIF_ID = 4711;
    private static final int CALL_ID = 4712;
    /* Har baat-cheet ki apni notification -- warna ek hi dabba baar-baar
       badalta rehta aur pichhla message gum ho jaata. */
    private static final int CHAT_ID_BASE = 5000;

    private static final int RATE = 16000;
    private static final int FRAME_BYTES = 640 * 2;     // 40ms ka ek frame

    /* ⚠ JITTER-BUFFER -- AAWAZ SAAF HONE KI ASLI WAJAH.
     *
     * Naap kar dekha (end-to-end, 120 frame theek 40ms par bheje gaye):
     * ek bhi frame gira NAHI, par pahunchte jhatkon me hain -- do frame ke
     * beech median 46ms, p95 76ms, aur SABSE ZYADA 99ms.  Har frame me sirf
     * 40ms ki aawaz hoti hai, yaani us 99ms wale jhatke par bajane wale ke
     * paas ~59ms kuch tha hi nahi.
     *
     * Pehle yahan koi buffer tha hi nahi: pehla frame aate hi bajana shuru
     * ho jaata tha, aur AudioTrack baar-baar sookh (underrun) kar "kat-kat"
     * karta tha.  Isliye:
     *   PREBUFFER -- itne frame jama hone tak bajana shuru mat karo
     *   sookhne par KHAMOSHI likh do -- taaki dhaara tooti na rahe
     *     (AudioTrack ko khali chhodne se wo ruk kar dobara chalta hai,
     *      aur wahi "tik-tik" sunayi deti hai)
     */
    private static final int PREBUFFER_FRAMES = 7;      // ~280ms
    private static final byte[] KHAMOSHI = new byte[FRAME_BYTES];

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
    private MediaPlayer ring;
    /** Aakhri buzz ka event-id -- "OK" dabte hi isi par server par jawab
     *  likha jaata hai (history me "response diya" wahi se aata hai). */
    private volatile int lastBuzzEv = 0;
    /* Buzz ka jawab KISKO jaye.  Group par buzz aaya tha to usi group me
       (taaki sabko pata chale); seedha aaya tha to BULANE WALE ko -- us
       soorat me `target` "main" hoon, isliye wo kaam nahi aata. */
    /** Apni user id (`ready` message se).  Apna hi bheja hua message wapas
     *  aata hai (doosre device ke liye) -- uspar notification nahi dikhani. */
    private volatile int MERI_ID = 0;
    private volatile int lastBuzzFrom = 0;
    private volatile String lastBuzzTType = "user";
    private volatile int lastBuzzTId = 0;
    /* ⚠ Ring ki hadd ka apna Runnable.  Pehle yahan
       `main.removeCallbacksAndMessages(null)` likha tha -- wo is Handler ke
       SAARE pending kaam hata deta, jisme socket ka DOBARA-JUDNE wala timer
       (`dobara()`) bhi aa jaata.  Yaani ek buzz aane par reconnect chup-chaap
       mar sakta tha.  Isliye sirf apna hi kaam hatate hain. */
    private final Runnable ringRuko = this::ringBand;
    private Thread writer;
    private final ArrayBlockingQueue<byte[]> qatar = new ArrayBlockingQueue<>(64);
    private volatile boolean bharRahe = true;           // abhi jitter-buffer bhar raha hai
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
        /* "OK" daba diya (ya notification hata di) — ring aur vibration band.
           Service khud chalti rehti hai, sirf bulawa rukta hai. */
        if (ACTION_REPLY.equals(act)) {
            /* Notification ke dabbe me likha hua jawab.  App KHULI HI NAHI
               hoti -- isliye ye poora kaam yahin hota hai: text nikalo,
               server par bhejo, ring band karo.  Jawab dena = bulawe ka
               jawab dena, isliye ack bhi saath me jaata hai. */
            CharSequence likha = null;
            try {
                android.os.Bundle b = RemoteInput.getResultsFromIntent(intent);
                if (b != null) likha = b.getCharSequence(KEY_REPLY);
            } catch (Throwable e) { Log.w(TAG, "reply padha nahi gaya: " + e); }
            String txt = likha == null ? "" : likha.toString().trim();
            int nid = intent.getIntExtra("nid", CALL_ID);
            if (!txt.isEmpty()) {
                chatBhejo(intent.getStringExtra("ttype"), intent.getIntExtra("tid", 0), txt, nid);
            } else {
                try {
                    NotificationManager nm = getSystemService(NotificationManager.class);
                    if (nm != null) nm.cancel(nid);
                } catch (Throwable ignored) { /* kuch nahi */ }
            }
            if (nid == CALL_ID) { ringBand(); jawabBhejo(); }
            return START_STICKY;
        }
        if (ACTION_ACK.equals(act) || ACTION_ACK_OPEN.equals(act)) {
            ringBand();
            jawabBhejo();                 // server par: "jawab mil gaya"
            if (ACTION_ACK_OPEN.equals(act)) {
                try {
                    Intent open = new Intent(this, MainActivity.class);
                    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                                  | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    // Notification par tap = seedha walkie ka page khule.
                    open.putExtra("openPage", "/walkie-talkie");
                    startActivity(open);
                } catch (Throwable e) { Log.w(TAG, "open: " + e); }
            }
            return START_STICKY;
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
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            NotificationChannel ch = new NotificationChannel(
                    CH_ID, "Walkie-Talkie", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the walkie-talkie listening while the app is closed");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);

            /* Buzz ke liye alag channel — IMPORTANCE_HIGH, taaki wo upar
               chipak kar dikhe (heads-up) aur "OK" ka button turant mile.
               Iski apni awaaz aur vibration JAAN-BOOJH KAR band hain: ring
               aur vibration hum khud chalate hain, warna dono ek saath hote
               aur ek doosre par chadh jaate. */
            NotificationChannel cc = new NotificationChannel(
                    CH_CALL, "Walkie-Talkie call", NotificationManager.IMPORTANCE_HIGH);
            cc.setDescription("Someone is buzzing you");
            cc.setSound(null, null);
            cc.enableVibration(false);
            cc.setShowBadge(true);
            nm.createNotificationChannel(cc);

            /* Chat ka apna channel.  IMPORTANCE_HIGH isliye ki jawab DIKHNA
               chahiye -- aadmi ne buzz kiya hai aur wo jawab ka intezaar kar
               raha hai.  Yahan sound band NAHI karte (buzz wale channel me
               karte hain, kyunki wahan ring hum khud bajate hain). */
            NotificationChannel ct = new NotificationChannel(
                    CH_CHAT, "Walkie-Talkie messages", NotificationManager.IMPORTANCE_HIGH);
            ct.setDescription("Written messages from Walkie-Talkie");
            ct.setShowBadge(true);
            nm.createNotificationChannel(ct);
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
        /* ⚠ EK SE ZYADA SOCKET NA BANE.
           `onStartCommand` kai baar chal sakta hai -- app har baar khulne par
           `start()` bhejti hai, aur Android khud bhi service ko dobara chalu
           kar sakta hai (START_STICKY).  Pehle har baar `jodo()` naya socket
           bana deta tha aur purana khula pada rehta tha.  Nateeja device par
           dikha: EK buzz par service ko `TXT buzz` DO BAAR mila, do ringtone
           ek saath chal padi.  Aawaz bhi aise hi do baar aati.
           `ws` tabhi null hota hai jab socket sach me band ho chuka ho
           (onClosed/onFailure me null kiya jaata hai), isliye ye jaanch
           reconnect ko nahi rokti. */
        if (ws != null) { Log.i(TAG, "pehle se juda hua hai, naya socket nahi"); return; }
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
                        String kisne = f != null ? f.optString("name", "Someone") : "Someone";
                        lastBuzzEv = d.optInt("ev", 0);
                        lastBuzzFrom = f != null ? f.optInt("id", 0) : 0;
                        JSONObject tg = d.optJSONObject("target");
                        lastBuzzTType = tg != null ? tg.optString("type", "user") : "user";
                        lastBuzzTId = tg != null ? tg.optInt("id", 0) : 0;
                        bajao(kisne);     // phone ki apni ring — OK dabne tak
                        thartharao();     // + vibration, utni hi der
                        likho(kisne + " buzzed you");
                    } else if ("rx_start".equals(t)) {
                        JSONObject f = d.optJSONObject("from");
                        // Buzz ki ring abhi baj rahi ho to use rok do -- warna
                        // ring aur aawaz ek saath chalti hain aur kuch samajh
                        // nahi aata.
                        ringBand();
                        audioTaiyaar();
                        // Nayi transmission -- buffer naye sire se bhare
                        bharRahe = true;
                        qatar.clear();
                        chirp();
                        likho((f != null ? f.optString("name", "Someone") : "Someone") + " is speaking…");
                    } else if ("chat".equals(t)) {
                        /* Likha hua message.  App khuli ho to kuch nahi karte --
                           page wahi baat pehle se dikha raha hai. */
                        if (!APP_FOREGROUND) {
                            JSONObject f2 = d.optJSONObject("from");
                            JSONObject tg2 = d.optJSONObject("target");
                            int fid = f2 != null ? f2.optInt("id", 0) : 0;
                            // Apna hi bheja hua wapas aata hai (doosre device ke
                            // liye) -- uspar notification dikhana bemtlab hai.
                            if (fid != 0 && fid != MERI_ID) {
                                chatDikhao(
                                    f2 != null ? f2.optString("name", "Someone") : "Someone",
                                    d.optString("body", ""),
                                    d.optString("convo", ""),
                                    tg2 != null ? tg2.optString("type", "user") : "user",
                                    tg2 != null ? tg2.optInt("id", 0) : 0,
                                    fid);
                            }
                        }
                    } else if ("ready".equals(t)) {
                        JSONObject me = d.optJSONObject("me");
                        if (me != null) MERI_ID = me.optInt("id", 0);
                    } else if ("rx_stop".equals(t)) {
                        // Kitni baar sookha -- yahi batata hai ki aawaz saaf
                        // rahi ya nahi.  0 matlab bilkul saaf.
                        try {
                            AudioTrack at = track;
                            if (at != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                                Log.i(TAG, "SOOKHA (underrun) ab tak: " + at.getUnderrunCount());
                            }
                        } catch (Throwable ignored) { /* purana device */ }
                        bharRahe = true;
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
                if (!qatar.offer(b)) {
                    /* Qatar bhar gayi -- matlab hum bahut peechhe chal rahe
                       hain.  Ek frame girane se der wahi ki wahi rehti hai,
                       isliye AADHI qatar gira dete hain aur taaza aawaz par
                       aa jaate hain.  Live baat me purani aawaz ka koi
                       matlab nahi hota. */
                    for (int i = 0; i < 16; i++) { if (qatar.poll() == null) break; }
                    qatar.offer(b);
                }
            }

            @Override public void onClosed(WebSocket s, int code, String reason) {
                CONNECTED = false;
                if (ws == s) ws = null;
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
                if (ws == s) ws = null;
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
        ringBand();
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
                    AudioTrack t = track;
                    if (t == null) { Thread.sleep(20); continue; }

                    // 1) Buffer bharne do -- jab tak itne frame na ho jayein,
                    //    kuch mat bajao.  Ek hi baar har transmission par.
                    if (bharRahe) {
                        if (qatar.size() < PREBUFFER_FRAMES) { Thread.sleep(10); continue; }
                        bharRahe = false;
                    }

                    byte[] b = qatar.poll(25, TimeUnit.MILLISECONDS);
                    if (b != null) {
                        t.write(b, 0, b.length);
                    } else {
                        /* Kuch nahi aaya.  AudioTrack ko KHALI mat chhodo --
                           wo sookh kar ruk jaata hai aur dobara chalne par
                           "tik" karta hai.  40ms ki khamoshi likh dete hain:
                           dhaara chalti rehti hai aur agla frame aate hi
                           bina jhatke jud jaata hai. */
                        t.write(KHAMOSHI, 0, KHAMOSHI.length);
                    }
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

    /* BUZZ PAR PHONE KI APNI RING — AUR WO RUKTI NAHI JAB TAK "OK" NA DABE.
     *
     * User ne yahi maanga: ring aur vibration chalti rahe, notification par
     * OK aaye, aur OK ke baad band ho.  Yaani buzz ab ek "poke" nahi, ek
     * BULAWA hai — bilkul phone call jaisa.
     *
     * Kaun-kaunsi cheez jaan-boojh kar aisi hai:
     *   • Phone me jo ringtone CHUNI HUI hai wahi bajti hai — apni koi sound
     *     file nahi rakhi.
     *   • `MediaPlayer` (Ringtone nahi) kyunki usme `setLooping(true)` har
     *     Android par chalta hai; `Ringtone.setLooping` API 28 se pehle hai
     *     hi nahi.
     *   • `USAGE_NOTIFICATION_RINGTONE` — RING wale volume par (wahi jo call
     *     ka hota hai), media wale par nahi.  Buzz bulawa hai, gaana nahi.
     *   • Phone silent par ho to ring nahi bajegi par VIBRATION phir bhi
     *     hogi — silent ka matlab hi yahi hai.
     *
     * ⚠ MAX_RING_SECONDS KI HADD KYUN HAI
     * Bulawa "hamesha" chalta rahe ye theek nahi: phone mez par pada reh
     * jaye aur koi paas na ho to wo poori shift bajta rahega aur battery
     * khatam kar dega.  Isliye 2 minute ki aakhri hadd hai — ye "OK" ki
     * jagah nahi leti, bas bhoole hue phone ko bachati hai.
     */
    private static final int MAX_RING_SECONDS = 120;

    private void bajao(String kisne) {
        try {
            ringBand();
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            if (u == null) { Log.w(TAG, "RING koi uri nahi"); }
            else {
                MediaPlayer mp = new MediaPlayer();
                mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                mp.setDataSource(this, u);
                mp.setLooping(true);
                mp.prepare();
                mp.start();
                ring = mp;
                Log.i(TAG, "RING chal padi (lagatar)");
            }
            bulawaDikhao(kisne);
            // bhoole hue phone ke liye aakhri hadd
            main.removeCallbacks(ringRuko);
            main.postDelayed(ringRuko, MAX_RING_SECONDS * 1000L);
        } catch (Throwable e) {
            Log.w(TAG, "ring: " + e);
        }
    }

    /** Buzz ka parda: heads-up notification + "OK" ka button. */
    private void bulawaDikhao(String kisne) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    ? new Notification.Builder(this, CH_CALL)
                    : new Notification.Builder(this);
            b.setContentTitle((kisne == null || kisne.isEmpty() ? "Someone" : kisne) + " is buzzing you")
             .setContentText("Tap OK to stop the ringing")
             .setSmallIcon(android.R.drawable.stat_sys_speakerphone)
             .setAutoCancel(true)
             .setOngoing(false)
             .setCategory(Notification.CATEGORY_CALL)
             /* ⚠ Ye intent SEEDHA ACTIVITY ka hai, service ka nahi.
                Pehle yahan service wala intent tha (ACTION_ACK_OPEN) jo
                `startActivity` karta -- par Android 10+ me BACKGROUND SE
                ACTIVITY START BLOCKED hai, aur wo chup-chaap fail hota hai.
                Device par yahi dikha: ring band ho jaati thi, ACK bhi chala
                jaata tha, par app khulti hi nahi thi.
                Notification par tap ek "user gesture" hai, isliye seedha
                `getActivity` chalta hai.  Ring rokne ka kaam ab MainActivity
                karti hai (wo service ko ACTION_ACK bhejti hai). */
             .setContentIntent(appKholo())
             // Notification swipe karke hatayi to bhi ring band ho
             .setDeleteIntent(kaamKaIntent(ACTION_ACK, 3))
             .addAction(android.R.drawable.ic_menu_close_clear_cancel, "OK",
                        kaamKaIntent(ACTION_ACK, 4));
            /* ← YAHI WO CHEEZ HAI JO USER NE MAANGI: notification me hi
               likh kar jawab.  App kholne ki zaroorat nahi -- bulane wale ko
               turant pata chal jaata hai ki kya ho raha hai. */
            Notification.Action jab = replyAction(
                    lastBuzzTType, "channel".equals(lastBuzzTType) ? lastBuzzTId : lastBuzzFrom,
                    CALL_ID, "Reply to " + (kisne == null || kisne.isEmpty() ? "them" : kisne));
            if (jab != null) b.addAction(jab);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                b.setPriority(Notification.PRIORITY_HIGH);
            }
            nm.notify(CALL_ID, b.build());
        } catch (Throwable e) {
            Log.w(TAG, "bulawa: " + e);
        }
    }

    /* "OK" dabne par server ko batao ki bulawe ka jawab mil gaya.
     * Socket se nahi, seedha REST se -- kyunki jawab ek baar ka kaam hai aur
     * socket us waqt toota bhi ho sakta hai.  Fail ho jaye to chhod dete
     * hain: ring band ho chuki hai, aur ek log ki qatar ke liye user ko
     * rokna galat hoga. */
    private void jawabBhejo() {
        final int ev = lastBuzzEv;
        lastBuzzEv = 0;
        if (ev <= 0 || token.isEmpty() || url.isEmpty()) return;
        try {
            String http = url.replaceFirst("^ws", "http")
                             .replace("/api/walkie/ws", "/api/walkie/events/" + ev + "/ack");
            Request req = new Request.Builder()
                    .url(http)
                    .addHeader("Authorization", "Bearer " + token)
                    .post(RequestBody.create(new byte[0], null))
                    .build();
            http().newCall(req).enqueue(new Callback() {
                @Override public void onFailure(Call call, java.io.IOException e) {
                    Log.w(TAG, "ack: " + e);
                }
                @Override public void onResponse(Call call, Response r) {
                    Log.i(TAG, "ACK bhej diya ev=" + ev + " -> " + r.code());
                    r.close();
                }
            });
        } catch (Throwable e) {
            Log.w(TAG, "ack: " + e);
        }
    }

    /** Notification ka "Reply" wala dabba.
     *
     * ⚠ PendingIntent MUTABLE hona ZAROORI hai.  Android 12 (S) se default
     * immutable hai, aur immutable PendingIntent me system likha hua text daal
     * hi nahi sakta -- jawab hamesha khali aata.  Baaki sab jagah is file me
     * IMMUTABLE hi rakha hai; sirf yahan ulta chahiye.
     */
    private Notification.Action replyAction(String ttype, int tid, int nid, String label) {
        try {
            if (tid <= 0) return null;
            Intent i = new Intent(this, WalkieService.class);
            i.setAction(ACTION_REPLY);
            i.putExtra("ttype", ttype == null ? "user" : ttype);
            i.putExtra("tid", tid);
            i.putExtra("nid", nid);
            int f = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) f |= PendingIntent.FLAG_MUTABLE;
            // requestCode har baat-cheet ka alag -- warna FLAG_UPDATE_CURRENT
            // pehle wale ke extras hi dobara istemal kar leta hai.
            PendingIntent pi = PendingIntent.getService(this, 9000 + nid, i, f);
            RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel(label).build();
            return new Notification.Action.Builder(
                    android.R.drawable.ic_menu_send, "Reply", pi)
                    .addRemoteInput(ri).build();
        } catch (Throwable e) {
            Log.w(TAG, "replyAction: " + e);
            return null;   // dabba na bana to notification phir bhi dikhe
        }
    }

    /** Aaya hua message notification me. */
    private void chatDikhao(String kisne, String matn, String convo,
                            String ttype, int tid, int fromId) {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            int nid = CHAT_ID_BASE + Math.abs((convo == null ? "" : convo).hashCode() % 900);
            Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    ? new Notification.Builder(this, CH_CHAT)
                    : new Notification.Builder(this);
            b.setContentTitle(kisne == null || kisne.isEmpty() ? "Message" : kisne)
             .setContentText(matn)
             .setStyle(new Notification.BigTextStyle().bigText(matn))
             .setSmallIcon(android.R.drawable.stat_notify_chat)
             .setAutoCancel(true)
             .setCategory(Notification.CATEGORY_MESSAGE)
             .setContentIntent(appKholo());
            // Jawab wahin bhejo jahan se aaya: group me group, warna bhejne wale ko.
            Notification.Action jab = replyAction(
                    ttype, "channel".equals(ttype) ? tid : fromId, nid,
                    "Reply to " + (kisne == null || kisne.isEmpty() ? "them" : kisne));
            if (jab != null) b.addAction(jab);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                b.setPriority(Notification.PRIORITY_HIGH);
            }
            nm.notify(nid, b.build());
        } catch (Throwable e) {
            Log.w(TAG, "chatDikhao: " + e);
        }
    }

    /** Notification se aaya jawab server par bhejo.
     *
     * Socket se nahi, REST se -- wahi wajah jo `jawabBhejo()` me likhi hai:
     * ye ek baar ka kaam hai aur us waqt socket toota bhi ho sakta hai.
     * Server message ko un sabke socket par aage bhej deta hai jinko milna
     * chahiye, isliye saamne wale ki khuli app me wo TURANT dikh jaata hai. */
    private void chatBhejo(String ttype, int tid, String matn, int nid) {
        if (tid <= 0 || token.isEmpty() || url.isEmpty()) return;
        try {
            String http = url.replaceFirst("^ws", "http")
                             .replace("/api/walkie/ws", "/api/walkie/chat");
            JSONObject j = new JSONObject();
            j.put("target_type", ttype == null ? "user" : ttype);
            j.put("target_id", tid);
            j.put("body", matn);
            Request req = new Request.Builder()
                    .url(http)
                    .addHeader("Authorization", "Bearer " + token)
                    .post(RequestBody.create(j.toString(),
                            MediaType.parse("application/json; charset=utf-8")))
                    .build();
            http().newCall(req).enqueue(new Callback() {
                @Override public void onFailure(Call call, java.io.IOException e) {
                    Log.w(TAG, "chat bheja nahi gaya: " + e);
                    bataoAurHatao(nid, "Could not send — no network");
                }
                @Override public void onResponse(Call call, Response r) {
                    Log.i(TAG, "chat bhej diya -> " + r.code());
                    bataoAurHatao(nid, r.isSuccessful() ? "Reply sent" : "Could not send");
                    r.close();
                }
            });
        } catch (Throwable e) {
            Log.w(TAG, "chatBhejo: " + e);
        }
    }

    /** Notification par chhota sa jawab dikhao, phir apne aap hata do.
     *  Bina iske jawab bhejne par dabba chup-chaap gayab hota hai aur pata
     *  hi nahi chalta ki gaya bhi ya nahi. */
    private void bataoAurHatao(int nid, String kya) {
        main.post(() -> {
            try {
                NotificationManager nm = getSystemService(NotificationManager.class);
                if (nm == null) return;
                Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                        ? new Notification.Builder(this, CH_CHAT)
                        : new Notification.Builder(this);
                b.setContentTitle(kya)
                 .setSmallIcon(android.R.drawable.stat_notify_chat)
                 .setAutoCancel(true)
                 .setTimeoutAfter(3000);
                nm.notify(nid, b.build());
            } catch (Throwable ignored) { /* kuch nahi */ }
            main.postDelayed(() -> {
                try {
                    NotificationManager nm2 = getSystemService(NotificationManager.class);
                    if (nm2 != null) nm2.cancel(nid);
                } catch (Throwable ignored) { /* kuch nahi */ }
            }, 3200);
        });
    }

    private OkHttpClient http() { return http; }

    /** Notification par tap -> app khule aur seedha walkie ke page par. */
    private PendingIntent appKholo() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                   | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("openPage", "/walkie-talkie");
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 5, i, f);
    }

    private PendingIntent kaamKaIntent(String action, int code) {
        Intent i = new Intent(this, WalkieService.class);
        i.setAction(action);
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, code, i, f);
    }

    /** Ring + vibration + bulawe ka parda — teeno band. */
    private void ringBand() {
        main.removeCallbacks(ringRuko);
        boolean bajRahiThi = ring != null;
        MediaPlayer r = ring; ring = null;
        try { if (r != null) { r.stop(); r.release(); } } catch (Throwable ignored) { /* pehle se ruki hui */ }
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.cancel();
        } catch (Throwable ignored) { /* kuch nahi */ }
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(CALL_ID);
        } catch (Throwable ignored) { /* kuch nahi */ }
        // Chalti hui service ki patti wapas aam haal par
        if (bajRahiThi && chahiye) likho(CONNECTED ? "Listening" : "Reconnecting…");
    }

    private void thartharao() {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            Log.i(TAG, "VIB v=" + (v != null) + " has=" + (v != null && v.hasVibrator()));
            if (v == null || !v.hasVibrator()) return;
            /* Ring jitni der hilta rahe -- jeb me pada phone ek jhatke se
               nahi pata chalta.  `repeat = 0` yaani pattern dobara-dobara;
               `ringBand()` RING_SECONDS baad `cancel()` kar deta hai. */
            long[] pat = { 0, 500, 400 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pat, 0));
            } else {
                v.vibrate(pat, 0);
            }
        } catch (Throwable e) {
            Log.w(TAG, "vibrate: " + e);
        }
    }
}
