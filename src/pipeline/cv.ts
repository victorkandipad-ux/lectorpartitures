// OpenCV.js loader and Mat lifetime helper. OpenCV is only used for a few primitives (document
// detection); it is loaded lazily, so pages that do not need it (PDFs) never pay for its ~13 MB.

// The package's typings are incomplete for the functions we use; keep the surface untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any

/**
 * Returns the UMD export of opencv.js (a Promise of the initialized module). The default loader
 * fetches the script as a precached asset and evaluates it as CommonJS: a dynamic `import()` of the
 * package breaks because its export is a Promise, whose `then` leaks into the ES namespace object.
 * Node tests inject a `require`-based loader.
 */
let loader: () => Promise<unknown> = async () => {
  const { default: url } = await import('@techstark/opencv-js/dist/opencv.js?url')
  const code = await (await fetch(url)).text()
  const module = { exports: {} as unknown }
  new Function('module', 'exports', code)(module, module.exports)
  return module.exports
}

export function setOpenCVLoader(fn: () => Promise<unknown>) {
  loader = fn
  cvPromise = null
}

let cvPromise: Promise<CV> | null = null

export function loadOpenCV(): Promise<CV> {
  cvPromise ??= (async () => {
    // The loader is async, so the export's Promise is already unwrapped here.
    const exported = (await loader()) as CV
    if (exported.Mat) return exported
    await new Promise<void>((resolve) => {
      exported.onRuntimeInitialized = () => resolve()
    })
    return exported
  })()
  return cvPromise
}

let live = 0
/** Number of OpenCV objects created through withMats() and not yet deleted (leak check in tests). */
export const liveMats = () => live

interface Deletable {
  delete(): void
}

/**
 * Runs `fn` with a `track` function; every tracked OpenCV object is deleted when `fn` returns or
 * throws. All Mats/MatVectors must be created through `track(new cv.Mat())`.
 */
export function withMats<T>(fn: (track: <M extends Deletable>(m: M) => M) => T): T {
  const objs: Deletable[] = []
  const track = <M extends Deletable>(m: M): M => {
    objs.push(m)
    live++
    return m
  }
  try {
    return fn(track)
  } finally {
    for (const o of objs) {
      o.delete()
      live--
    }
  }
}
