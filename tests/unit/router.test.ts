import { describe, expect, it } from 'vitest'
import { matchRoute } from '../../src/app/router'

describe('matchRoute', () => {
  it('matches static and param segments', () => {
    expect(matchRoute('/', '/')).toEqual({})
    expect(matchRoute('/obra/:id', '/obra/abc%20d')).toEqual({ id: 'abc d' })
    expect(matchRoute('/editar/:id/:page', '/editar/x/2?foo=1')).toEqual({ id: 'x', page: '2' })
  })
  it('rejects mismatches', () => {
    expect(matchRoute('/obra/:id', '/obra')).toBeNull()
    expect(matchRoute('/ajustes', '/obra/1')).toBeNull()
  })
})
