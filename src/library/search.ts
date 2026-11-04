import type { Work } from '../model/types'

/** Lowercase and strip diacritics so "Dvořák" matches "dvorak". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Every query token must appear in the title, composer or a tag. */
export function searchWorks(works: Work[], query: string): Work[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return works
  return works.filter((w) => {
    const hay = normalize([w.title, w.composer, ...w.tags].join(' '))
    return tokens.every((t) => hay.includes(t))
  })
}

/** "dvorak_sonatina-op100.jpg" → "dvorak sonatina op100" */
export function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
