/* walkieAudio.js — Walkie-Talkie ka aawaz wala hissa (mic + speaker).
 *
 * KYUN RAW PCM, KOI CODEC NAHI
 * ----------------------------
 * `MediaRecorder` (Opus/WebM) chhota data deta hai, par uske tukde AKELE nahi
 * bajte — pehle tukde me container ka header hota hai.  Uska matlab:
 *   • beech me sunne aaya banda kuch sun hi nahi sakta,
 *   • ek tukda gir gaya to uske aage ka poora sab bekaar.
 * PCM me har frame apne aap me poora hai — Wi-Fi ki ek hichki se sirf 40ms ki
 * aawaz jaati hai, dhaara nahi tootti.  Aur Android ki service ise seedha
 * `AudioTrack` me daal deti hai, beech me koi decoder hi nahi.
 *
 * NAAP: 16000 Hz, mono, 16-bit  ->  32 KB/s (256 kbps).  LAN par kuch bhi nahi.
 * Ek frame = 640 sample = 40ms = 1280 byte, yaani 25 frame har second.
 */

export const SAMPLE_RATE = 16000;
export const FRAME_SAMPLES = 640;          // 40ms

/* AudioWorklet ka code alag file me nahi rakh sakte (Vite use hash wale naam
   se bundle kar deta hai aur `addModule` ko asli rasta chahiye), isliye use
   yahin string me rakh kar Blob-URL bana lete hain.  Chhota hai, aur isi se
   ye file khud-mukhtaar rehti hai. */
const WORKLET_SRC = `
class WalkieMic extends AudioWorkletProcessor {
  constructor () { super(); this.buf = new Int16Array(${FRAME_SAMPLES}); this.n = 0; }
  process (inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i];
      if (v > 1) v = 1; else if (v < -1) v = -1;
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.buf.length) {
        const out = new Int16Array(this.buf);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('walkie-mic', WalkieMic);
`;

let workletUrl = null;
const workletKaUrl = () => {
  if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
  return workletUrl;
};

/* ── MIC ────────────────────────────────────────────────────────────
 * `micShuru()` mic kholta hai aur har 40ms par ek ArrayBuffer (Int16 PCM)
 * `onFrame` ko de deta hai.  Lautaya hua object `.band()` par sab band kar
 * deta hai — stream, worklet, context teeno.
 *
 * ⚠ Mic har baar naye sire se kholte hain (button dabne par), khula chhod
 * kar nahi rakhte: warna phone ki batti/notification me "mic chal raha hai"
 * hamesha dikhta rehta hai aur log app par bharosa nahi karte.
 */
export async function micShuru({ onFrame, onLevel }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This device does not allow microphone access");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // Plant me shor bahut hai — teeno cheezein browser se hi karwa lete hain.
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    },
  });
  // sampleRate yahin maang lete hain — browser khud resample kar deta hai,
  // hume 48k se 16k karne ka koi code likhna hi nahi padta.
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  if (ctx.state === "suspended") await ctx.resume();

  const src = ctx.createMediaStreamSource(stream);
  let node = null;

  const lagao = (buf) => {
    if (onFrame) onFrame(buf);
    if (onLevel) {
      // Bolne wale ko dikhana ki aawaz ja bhi rahi hai — bina iske pata hi
      // nahi chalta ki mic mute hai ya banda sach me chup hai.
      const a = new Int16Array(buf);
      let s = 0;
      for (let i = 0; i < a.length; i += 8) s += Math.abs(a[i]);
      onLevel(Math.min(1, (s / (a.length / 8)) / 6000));
    }
  };

  try {
    await ctx.audioWorklet.addModule(workletKaUrl());
    node = new AudioWorkletNode(ctx, "walkie-mic");
    node.port.onmessage = (e) => lagao(e.data);
    src.connect(node);
    // Worklet ko chalu rakhne ke liye use kahin jodna padta hai.  Gain 0 —
    // apni hi aawaz speaker par nahi aani chahiye.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
  } catch {
    /* Purane WebView me AudioWorklet nahi hota — tab purana ScriptProcessor.
       Deprecated hai par har jagah chalta hai, aur PTT ke liye kaafi hai. */
    node = ctx.createScriptProcessor(1024, 1, 1);
    let acc = new Int16Array(FRAME_SAMPLES), n = 0;
    node.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        let v = ch[i];
        if (v > 1) v = 1; else if (v < -1) v = -1;
        acc[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (n === FRAME_SAMPLES) { lagao(acc.buffer.slice(0)); n = 0; }
      }
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  }

  return {
    band() {
      try { node && node.disconnect(); } catch { /* pehle se band */ }
      try { src.disconnect(); } catch { /* pehle se band */ }
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* pehle se band */ }
      try { ctx.close(); } catch { /* pehle se band */ }
    },
  };
}

/* ── SPEAKER ────────────────────────────────────────────────────────
 * Aane wale frame ko turant bajate NAHI — pehle ek chhota jitter-buffer
 * (120ms) bharte hain, phir ek ke baad ek jodte jaate hain.  Bina iske LAN
 * ki halki si der bhi "kat-kat" ban kar sunayi deti hai.
 */
const JITTER = 0.12;

export function speakerBanao() {
  let ctx = null;
  let cursor = 0;

  const pakka = () => {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      cursor = 0;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };

  return {
    /** Browser ka niyam: bina user ke chhue aawaz nahi baj sakti.  Isliye
     *  page par pehle tap/click par ise bula lete hain. */
    jagao() { try { pakka(); } catch { /* koi baat nahi */ } },

    push(arrBuf) {
      const c = pakka();
      const pcm = new Int16Array(arrBuf);
      if (!pcm.length) return;
      const buf = c.createBuffer(1, pcm.length, SAMPLE_RATE);
      const f = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 0x8000;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      const ab = Math.max(c.currentTime + JITTER, cursor);
      src.start(ab);
      cursor = ab + buf.duration;
    },

    /** Ek transmission khatam — agli baar jitter-buffer naye sire se bhare. */
    reset() { cursor = 0; },

    band() {
      try { ctx && ctx.close(); } catch { /* pehle se band */ }
      ctx = null; cursor = 0;
    },
  };
}
