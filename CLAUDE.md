# Atril — guía para Claude

PWA lectora de partituras para iPhone (Safari iOS 17+, standalone), 100 % offline y sin servidor.
Plan completo y fases: ver historial de commits y la sección «Fases» abajo.

## Reglas
- UI en español (todas las cadenas en `src/app/i18n/es.ts`). Código y comentarios en inglés.
- Nada sale del dispositivo: ninguna petición de red salvo la carga de la propia app.
- Procesado de imagen sólo en workers. Cada `cv.Mat` se crea dentro de `withMats()` (libera en `finally`).
- Umbrales del pipeline SIEMPRE relativos a `staffSpace`/`lineThickness`; nunca píxeles fijos
  (salvo la resolución de análisis ~2000 px y los topes de memoria).
- Nunca un canvas > 4096×4096 ni > 16,7 MP. Liberar `ImageBitmap` con `.close()`.
- Rutas por hash (`#/...`). Rutas de assets relativas a `import.meta.env.BASE_URL`.
- Un commit por hito; `npm test` y `npm run bench` deben pasar (el bench no puede empeorar el baseline).

## Arquitectura
- React + Zustand (UI) · Dexie (works/pages/blobs) · Comlink hacia `pipeline.worker` y `pdf.worker`.
- Pipeline: análisis a ~2000 px → mapa geométrico compuesto (perspectiva ∘ deskew ∘ dewarp) aplicado
  una sola vez a resolución completa → iluminación (fondo por closing) → Sauvola con integrales →
  limpieza por componentes conexas → estructura (run-lengths → staves → systems → barlines).
- OpenCV.js sólo para primitivas (Canny, contornos, warp, remap, morfología, blur, resize);
  algoritmos OMR en TS puro sobre `Uint8Array` (testeables en Node).
  Build reducida de OpenCV: pendiente (F7, vía GitHub Actions + emsdk); hoy build preconstruida.
- PDF vectorial: se omite la limpieza agresiva; sólo umbral + estructura.
- Datos: `page.auto` (pipeline) + `page.overrides` (ediciones del usuario, coords normalizadas 0–1).
  Estructura efectiva = `applyOverrides(auto, overrides)`. Reprocesar nunca toca `overrides`.
- Visor: un motor de layout puro para los 3 modos (página/sistemas/compases) que produce
  ítems `{srcRect → dstRect}`; renderer virtualizado con caché LRU de `ImageBitmap`.
  Ancla de lectura `{pageId, srcX, srcY}` conservada en giro, cambio de modo y zoom.
  Pellizco: `transform: scale()` en vivo + re-layout throttled por rAF; re-rasterizado al soltar.
- Export PDF: XObject DeviceGray 1 bit + Flate (pdf-lib a bajo nivel, porque `embedPng` re-codifica a RGB).
  Almacenamiento de la página limpia: PNG 1 bit (UPNG).
- Hosting: GitHub Pages; `base` de Vite = `/<repo>/` (variable `BASE_PATH` en Actions); manifest con
  `scope`/`start_url` relativos.

## Modelo de datos
```
Work  { id, title, composer, tags[], source, pageIds[], createdAt, updatedAt, thumbBlobId, view }
Page  { id, workId, index, originalBlobId, pdfPage?, isVector, corners?, width, height, dpi,
        cleanBlobId, auto: PageStructure, overrides: EditOp[], confidence, needsReview, pipelineVersion }
PageStructure { staffSpace, lineThickness, systems: System[] }
System { id, bbox, confidence, staves: { lineYs[5], confidence }[], measures: Measure[] }
Measure { id, xStart, xEnd, barline, confidence, symbols?: MusicSymbol[] }   // symbols = futuro OMR
```

## OMR futuro (no implementar aún)
- `src/recognition/NoteRecognizer.ts`: interfaz `recognize(imagen, geometría de compás/sistema, staffSpace)`
  → `MusicSymbol[]`; hoy un stub que devuelve `[]`.
- Plan: modelo de segmentación (p. ej. U-Net estilo oemer/DeepScores) exportado a ONNX, cuantizado,
  ejecutado con ONNX Runtime Web (WASM/WebGPU) en un worker dedicado, alimentado por recortes
  normalizados a staffSpace fijo; símbolos → `measure.symbols` → exportador MusicXML.

## Comandos
- `npm run dev` (vite --host) · `npm run tunnel` (cloudflared → HTTPS para iPhone)
- `npm test` (Vitest) · `npm run bench` (métricas de robustez vs `bench/baseline.json`)
- `npm run e2e` (Playwright WebKit, emulación iPhone)
- Deploy: push a `main` → GitHub Actions → Pages.

## Depuración en iPhone
- Ajustes → «Modo diagnóstico» (en dev, siempre activo): carga Eruda y `#/diag` con los pasos del pipeline.

## Fases
1. Scaffold PWA + deploy · 2. Importación + biblioteca · 3. Limpieza + export PDF ·
4. Estructura + banco de pruebas · 5. Editor manual · 6. Visor (3 modos) · 7. Pulido (memoria, offline, backup, a11y)
