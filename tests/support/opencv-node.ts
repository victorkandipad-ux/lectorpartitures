// Node loader for opencv.js (tests and bench).
import { createRequire } from 'node:module'
import { loadOpenCV, setOpenCVLoader } from '../../src/pipeline/cv'

export async function loadOpenCVNode() {
  const require = createRequire(import.meta.url)
  setOpenCVLoader(async () => require('@techstark/opencv-js'))
  return loadOpenCV()
}
