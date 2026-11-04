import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { pdfjsAssets } from './vite-plugins/pdfjs-assets'

// On GitHub Pages the app lives under /<repo>/. CI sets BASE_PATH; locally it is '/'.
const base = process.env.BASE_PATH ?? '/'

// Version shown in Settings: package version + commit, to tell which build a device is running.
function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}
const appVersion = `${process.env.npm_package_version ?? '0.0.0'}+${gitSha()}`

// Optional local HTTPS with mkcert certificates (see README). Not committed.
const https = existsSync('certs/key.pem') && existsSync('certs/cert.pem')
  ? { key: readFileSync('certs/key.pem'), cert: readFileSync('certs/cert.pem') }
  : undefined

export default defineConfig({
  base,
  plugins: [
    react(),
    pdfjsAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually in src/app/sw.ts
      pwaAssets: { config: true, overrideManifestIcons: true, injectThemeColor: true },
      manifest: {
        name: 'Atril — lector de partituras',
        short_name: 'Atril',
        description: 'Fotografía, limpia y lee partituras en tu iPhone, sin conexión.',
        lang: 'es',
        dir: 'ltr',
        theme_color: '#1f2a44',
        background_color: '#1f2a44',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        id: './',
      },
      workbox: {
        // OpenCV WASM bundle + pdf.js worker are big; they must be precached for offline use.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        // manifest.webmanifest is added by the plugin itself (listing it twice makes Workbox throw).
        globPatterns: ['**/*.{js,mjs,css,html,wasm,svg,png,ico,json,bcmap,pfb,ttf,icc}'],
        globIgnores: ['apple-splash-*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        inlineWorkboxRuntime: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: { https, allowedHosts: ['.trycloudflare.com'] },
  preview: { https, allowedHosts: ['.trycloudflare.com'] },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, minify: process.env.NOMINIFY ? false : 'oxc' },
})
