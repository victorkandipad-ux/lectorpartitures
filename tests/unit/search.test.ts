import { describe, expect, it } from 'vitest'
import { normalize, searchWorks, titleFromFilename } from '../../src/library/search'
import type { Work } from '../../src/model/types'

const w = (title: string, composer: string, tags: string[] = []): Work => ({
  id: title, title, composer, tags, source: 'photo', pageIds: [], createdAt: 0, updatedAt: 0, thumbBlobId: '',
  view: { mode: 'page', scale: 1, anchor: null },
})
const works = [w('Sonatina Op. 100', 'Antonín Dvořák', ['violín']), w('Rinaldo', 'Händel', ['ópera']), w('Fuga en La bemol', 'J. S. Bach')]

describe('search', () => {
  it('ignores case and diacritics', () => {
    expect(normalize('Dvořák ÓPERA')).toBe('dvorak opera')
    expect(searchWorks(works, 'dvorak').map((x) => x.title)).toEqual(['Sonatina Op. 100'])
    expect(searchWorks(works, 'OPERA handel').map((x) => x.title)).toEqual(['Rinaldo'])
  })
  it('requires all tokens and returns everything for an empty query', () => {
    expect(searchWorks(works, 'bach rinaldo')).toEqual([])
    expect(searchWorks(works, '  ')).toHaveLength(3)
  })
  it('derives a title from the filename', () => {
    expect(titleFromFilename('21_bach_jc-sonata.op16.jpg')).toBe('21 bach jc sonata.op16')
  })
})
