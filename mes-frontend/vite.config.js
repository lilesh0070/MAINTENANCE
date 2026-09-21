import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// App ko apna version pata hona chahiye, taaki wo server wale se mila sake.
// `app.version.json` release script badalti hai — yahan se wo build me chala
// jaata hai.  Website par ye bas ek string hai, koi asar nahi.
let APP_VERSION = '0.0.0'
try { APP_VERSION = JSON.parse(readFileSync('./app.version.json', 'utf-8')).version || '0.0.0' } catch { /* pehli baar */ }

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
      '/api': {
        target: 'http://localhost:8892',
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
      },
      '/cms-api': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cms-api/, ''),
      }
    }
  }
})