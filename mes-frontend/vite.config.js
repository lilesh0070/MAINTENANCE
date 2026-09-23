import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import net from 'node:net'

// App ko apna version pata hona chahiye, taaki wo server wale se mila sake.
// `app.version.json` release script badalti hai — yahan se wo build me chala
// jaata hai.  Website par ye bas ek string hai, koi asar nahi.
let APP_VERSION = '0.0.0'
try { APP_VERSION = JSON.parse(readFileSync('./app.version.json', 'utf-8')).version || '0.0.0' } catch { /* pehli baar */ }

// ── Office ke bahar (Tailscale) laptop ki site tez chale — 2026-09-22 ───────
// Laptop ka apna backend (8892) DB se Tailscale ke raaste baat kare to har
// request me DB ke kai chakkar lagte hain — mobile hotspot par 5-20 SECOND, aur
// Dashboard ki ANDON calls tak nahi aati thi.  Isliye jab office ka DB
// (192.168.30.15:5432) na mile, `/api` SEEDHA server ke backend par jaata hai
// (Tailscale se): ek hi chakkar, ~1 second.  Office me pehle jaisa — laptop ka
// apna backend.  Har 15s me dobara dekhta hai, to network badle to khud badle.
//
// SIRF LAPTOP PAR chalu: `mes-frontend/.env.local` (git me nahi jaati, *.local) me
//     API_FALLBACK=http://100.121.68.19:8892
// Server par wo file nahi hai -> neeche ka `/api` proxy BILKUL purana (koi hook
// nahi), isliye website par koi asar nahi.
// Dhyan: server aur laptop ka login secret alag hai — raasta badalte hi ek baar
// dobara login maangega.
function localEnv(key) {
  try {
    const txt = readFileSync(new URL('./.env.local', import.meta.url), 'utf-8')
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'm'))
    return m ? m[1].replace(/^['"]|['"]$/g, '') : ''
  } catch { return '' }
}
const API_LOCAL = 'http://localhost:8892'
const API_FALLBACK = localEnv('API_FALLBACK')
const [LAN_HOST, LAN_PORT] = (localEnv('API_LAN_PROBE') || '192.168.30.15:5432').split(':')

const apiProxy = {
  target: API_LOCAL,
  changeOrigin: true,
  // Walkie-Talkie ka live audio `/api/walkie/ws` par chalta hai.  Bina
  // `ws: true` ke Vite WebSocket ka upgrade request aage bhejta hi nahi
  // -- dev par socket chup-chaap fail hota hai (build/APK me proxy hai
  // hi nahi, isliye wahan ye dikkat kabhi aati hi nahi).
  ws: true,
  // Jis browser se baat hui uska IP X-Forwarded-For ke AAKHIR me jod do
  // (2026-09-21).  Iske bina backend ko har website user 127.0.0.1 dikhta
  // tha, aur login ki rok sab par ek saath lag jaati thi -- koi bhi kisi
  // ka account band karwa sakta tha.  Backend sirf AAKHRI entry maanta
  // hai (auth.py `_asli_ip`), jo yahi Vite likhta hai.
  xfwd: true,
}

if (API_FALLBACK) {
  // Vite (8.x) har request se pehle `bypass` bulata hai aur phir usi options
  // object se target padhta hai jo `configure` ko milta hai — isliye target
  // wahin badalte hain.  `bypass` kuch na lautaye = proxy karte raho.
  let asli = null
  let abhi = API_LOCAL
  let jaanchaKab = 0
  let jaanch = null
  const lanMila = () => new Promise((ok) => {
    const s = net.connect({ host: LAN_HOST, port: Number(LAN_PORT) || 5432 })
    const bas = (v) => { s.destroy(); ok(v) }
    s.setTimeout(1200, () => bas(false))
    s.once('connect', () => bas(true))
    s.once('error', () => bas(false))
  })
  const taazaKaro = () => {
    if (jaanch) return jaanch
    jaanch = lanMila().then((mila) => {
      const naya = mila ? API_LOCAL : API_FALLBACK
      if (naya !== abhi || !jaanchaKab) {
        console.log(`[api-proxy] office DB ${mila ? 'mila' : 'nahi mila'} -> /api ab ${naya}`)
      }
      abhi = naya
      jaanchaKab = Date.now()
      if (asli) asli.target = abhi
    }).finally(() => { jaanch = null })
    return jaanch
  }
  taazaKaro()
  apiProxy.configure = (_proxy, opts) => { asli = opts; opts.target = abhi }
  apiProxy.bypass = async () => {
    if (!jaanchaKab) await taazaKaro()                        // pehli baar: jawab aane do (1.2s tak)
    else if (Date.now() - jaanchaKab > 15000) taazaKaro()     // baad me peeche se, request nahi rukti
    if (asli) asli.target = abhi
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 9965,
    // strictPort: 9965 par hi bind karo — warna Vite chupchaap agle free port
    // (9966…) par chala jaata hai, aur Cloudflare tunnel (jo 9965 par point
    // karta hai) ko origin nahi milta -> maintenance.tbdi.in 502 dikhata hai.
    // strictPort se ya to 9965 milega ya start hi fail hoga (saaf error), jisse
    // wo "silent 9966" wali problem dobara nahi aayegi.
    strictPort: true,
    // Sirf ye domain — pehle `true` tha, jo Vite ka host-check poora band kar
    // deta hai (DNS-rebinding se bachaav khatam).  App Cloudflare tunnel se
    // maintenance.tbdi.in par publish hoti hai, isliye wahi naam chahiye.
    // Vite IP-address aur localhost ko waise bhi hamesha allow karta hai, to
    // http://192.168.30.15:9965 (LAN) aur http://localhost:9965 chalte rehte
    // hain — unhe yahan likhne ki zaroorat nahi.
    // Naya hostname jode to yahan bhi jodein, warna "Blocked request" aata hai.
    // 2026-09-21: naya domain maintenance.dxtbdi.com bhi -- purana (tbdi.in)
    // bhi rakha hai, taaki dono chalte rahein.
    allowedHosts: ['maintenance.tbdi.in', 'maintenance.dxtbdi.com'],
    proxy: {
      '/api': apiProxy,
      '/cms-api': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cms-api/, ''),
      }
    }
  }
})
