import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

// pdf.js loads these at runtime (scanned PDFs need the JBIG2/OpenJPEG decoders). They are emitted
// into the bundle under pdfjs/ so the service worker precaches them for offline use.
const DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs']
const SKIP = /^LICENSE|quickjs/i

export function pdfjsAssets(): Plugin {
  const root = join(process.cwd(), 'node_modules/pdfjs-dist')
  const files = () =>
    DIRS.flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((f) => !SKIP.test(f))
        .map((f) => ({ rel: `pdfjs/${dir}/${f}`, abs: join(root, dir, f) })),
    )
  return {
    name: 'atril-pdfjs-assets',
    // Dev server: serve straight from node_modules.
    configureServer(server) {
      const map = new Map(files().map((f) => [f.rel, f.abs]))
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(server.config.base, '')
        const abs = map.get(path)
        if (!abs) return next()
        res.setHeader('Content-Type', abs.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.end(readFileSync(abs))
      })
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: f.rel, source: readFileSync(f.abs) })
    },
  }
}
