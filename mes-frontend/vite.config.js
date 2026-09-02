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
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8892',
        changeOrigin: true,
      },
      '/cms-api': {
        target: 'http://localhost:5555',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cms-api/, ''),
      }
    }
  }
})