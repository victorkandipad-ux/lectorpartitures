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
- OpenCV.js (`@techstark/opencv-js`, ~13 MB) sólo para la detección de página en fotos (blur, Canny,
  contornos, approxPolyDP). Se carga perezosamente en el worker con `fetch` + evaluación CommonJS
  (un `import()` dinámico rompe: su export es una Promise). En tests: `tests/support/opencv-node.ts`.
  Todo lo demás (resize, remapeo, fondo, Sauvola, run-lengths, componentes) en TS puro sobre
  `Uint8Array` (`src/pipeline/`, testeable en Node). Build reducida de OpenCV: pendiente (F7).
- Remapeo compuesto sin mapas completos: la cadena se evalúa por píxel en una sola pasada que además
  divide por el fondo (iluminación). Sauvola con integrales por bandas (memoria O(ancho × banda)).
- Resolución de salida de fotos: se estima el tamaño físico por la interlínea (1,75 mm típica) → 300 ppp,
  máx. 2× la fuente y los topes de canvas. PDF: tamaño de página original.
- Procesado: cola en segundo plano (`src/process/processor.ts`) que procesa toda página con
  `pipelineVersion < PIPELINE_VERSION` (`src/pipeline/version.ts`; subirla reprocesa todo).
  Si el worker no tiene `OffscreenCanvas`, el hilo principal decodifica a gris y lo transfiere.
- PDF vectorial: se omite la limpieza agresiva; sólo umbral + estructura.
- Detección de página validada: si con el cuadrilátero las líneas no salen nítidas y sin él sí, se descarta
  (el borde de una sombra parecía un borde de página). Con ruido alto (`estimateNoise`) se suaviza antes de binarizar.
- Estructura (`staves.ts`, `barlines.ts`, `structure.ts`), sobre la página limpia y en sus píxeles:
  - Pentagramas: peine de 5 líneas por franjas verticales sobre la proyección de runs finos; los aciertos se
    enlazan en horizontal (tolera curvatura residual y pentagramas parciales). Se filtran por continuidad de línea.
  - Sistemas: conector físico (corchete/llave a la izquierda, barra que cruza) o barras alineadas; después
    `regularize` usa el layout mayoritario de la página para unir fragmentos y partir bloques (esos sistemas
    salen con menos confianza). Último recurso: huecos periódicos. Los pentagramas sin notas ni barras se descartan.
  - Compases: los candidatos no se descartan, se puntúan (cobertura, cabeza de nota, extensión) y el sistema decide
    por consenso. Tipos de barra por grupos de trazos y puntillos de repetición.
  - `page.needsReview`: confianza baja o barras dudosas. Avisa, no bloquea (el editor llega en F5).
- Datos: `page.auto` (pipeline) + `page.overrides` (ediciones del usuario, coords normalizadas 0–1).
  Estructura efectiva = `applyOverrides(auto, overrides)`. Reprocesar nunca toca `overrides`.
- Visor: un motor de layout puro para los 3 modos (página/sistemas/compases) que produce
  ítems `{srcRect → dstRect}`; renderer virtualizado con caché LRU de `ImageBitmap`.
  Ancla de lectura `{pageId, srcX, srcY}` conservada en giro, cambio de modo y zoom.
  Pellizco: `transform: scale()` en vivo + re-layout throttled por rAF; re-rasterizado al soltar.
- Página limpia: PNG gris 1 bit con codificador propio (`src/export/png1bit.ts`, fflate); UPNG exigiría
  una copia RGBA de 4 B/píxel. Export PDF: el IDAT de ese PNG se incrusta tal cual como XObject
  DeviceGray 1 bit (FlateDecode + Predictor 15) con pdf-lib a bajo nivel: sin recomprimir.
- Compartir: primero se genera el PDF y luego el usuario pulsa «Compartir» (iOS exige un gesto reciente
  para `navigator.share`).
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
- `npm test` (Vitest)
- `npm run bench` (estructura frente a `bench/fixtures/real/truth.json`, etiquetado a mano, en las 25 fixtures y en
  7 degradaciones de cada una, `bench/degrade.ts`; compara con `bench/baseline.json`, informe en
  `bench/results/report.txt`. `BENCH_UPDATE=1` reescribe el baseline: sólo tras una mejora justificada)
- `npm run bench:preview` (limpia las 25 fixtures → `bench/results/preview/*.png`, `*.overlay.jpg` con la estructura
  y `log.txt`; `ONLY=21` filtra)
- `npm run e2e` (Playwright WebKit, emulación iPhone)
- Deploy: push a `main` → GitHub Actions → Pages.

## Depuración en iPhone
- Ajustes → «Modo diagnóstico» (en dev, siempre activo): carga Eruda y `#/diag` (o «Diagnóstico» bajo
  cada página) con imágenes, tiempos y medidas de cada paso del pipeline.

## Fases
1. Scaffold PWA + deploy · 2. Importación + biblioteca · 3. Limpieza + export PDF ·
4. Estructura + banco de pruebas · 5. Editor manual · 6. Visor (3 modos) · 7. Pulido (memoria, offline, backup, a11y)
