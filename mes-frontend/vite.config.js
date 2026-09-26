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

// ── Cloudflare ka 4 ghante wala browser cache band — 2026-09-26 ─────────────
// Website domain (maintenance.tbdi.in / maintenance.dxtbdi.com) par Cloudflare
// tunnel ke peeche yahi DEV server chalta hai, jo har file par
// `Cache-Control: no-cache` bhejta hai (browser har baar ETag se poochhe
// "badli?").  Par Cloudflare `.js` / `.css` jaisi files ko apne "Browser
// Cache TTL" (4 ghante) se badal kar `max-age=14400` kar deta tha — `.jsx`
// ko nahi (naap 2026-09-26: origin `no-cache`, domain par `max-age=14400`).
// Nateeja: update ke baad 4 ghante tak browser purani CSS/JS + nayi .jsx ka
// mel chalata, aur har domain ka cache alag -> dono domain par ALAG view.
//
// Ab har file par `private` (Cloudflare jaisa beech ka cache use rakhe hi
// nahi — aur jo file wo rakhta nahi, uska header bhi nahi badalta; .jsx isi
// se bachi thi) + `Cloudflare-CDN-Cache-Control: no-store`.  Browser ab bhi
// ETag se poochhta hai — file na badli ho to chhota 304, pura download nahi.
//   * Vite ki `?v=` wali deps (`immutable`) ko haath nahi — unka naam hi
//     version hai, Cloudflare / browser rakhein to bhi purani nahi hoti (aur
//     site jaldi khulti hai).
//   * `/api` ko haath nahi (backend apna header khud deta hai).
// Pakka ilaaj Cloudflare me bhi: dono zone me Browser Cache TTL = "Respect
// Existing Headers" (user ka dashboard).
const VERSION_WALI_DEP = /\/node_modules\/\.vite\/deps\/[^?]*\?(?:.*&)?v=[0-9a-f]+/
const noCdnBrowserCache = {
  name: 'no-cdn-browser-cache',
  configureServer(server) {
    const theek = (v) => (/immutable/i.test(String(v)) ? v : 'no-cache, private')
    server.middlewares.use((req, res, next) => {
      const url = req.url || ''
      if (url.startsWith('/api') || VERSION_WALI_DEP.test(url)) return next()
      const setH = res.setHeader.bind(res)
      res.setHeader = (name, value) =>
        setH(name, String(name).toLowerCase() === 'cache-control' ? theek(value) : value)
      // public/ ki files (sirv) header `writeHead` ke object me deta hai
      const writeH = res.writeHead.bind(res)
      res.writeHead = (code, ...rest) => {
        const h = rest.find((x) => x && typeof x === 'object' && !Array.isArray(x))
        if (h) for (const k of Object.keys(h)) if (k.toLowerCase() === 'cache-control') h[k] = theek(h[k])
        return writeH(code, ...rest)
      }
      setH('Cache-Control', 'no-cache, private')
      setH('Cloudflare-CDN-Cache-Control', 'no-store')
      next()
    })
  },
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react(), noCdnBrowserCache],
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
