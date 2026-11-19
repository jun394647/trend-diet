import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONT_CACHE, warmFontCache } from './fonts'

describe('warmFontCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('캐시 저장소가 없는 환경에서는 조용히 넘어간다', async () => {
    expect(await warmFontCache()).toBe(0)
  })

  it('화면이 받은 글꼴 조각 가운데 아직 저장되지 않은 것만 넣는다', async () => {
    const origin = location.origin
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue(
      [
        `${origin}/assets/pretendard-12.woff2`,
        `${origin}/assets/pretendard-12.woff2`,
        `${origin}/assets/bricolage-latin-wght-normal.woff2`,
        `${origin}/assets/index.js`,
        'https://elsewhere.example/assets/other.woff2',
      ].map((name) => ({ name }) as PerformanceEntry),
    )
    const add = vi.fn(() => Promise.resolve())
    const open = vi.fn(() => Promise.resolve({ add }))
    const match = vi.fn((url: string, _options?: CacheQueryOptions) => Promise.resolve(url.includes('bricolage') ? new Response('') : undefined))
    vi.stubGlobal('caches', { open, match })

    expect(await warmFontCache()).toBe(1)
    expect(open).toHaveBeenCalledWith(FONT_CACHE)
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith(`${origin}/assets/pretendard-12.woff2`)
  })

  it('저장에 실패해도 던지지 않는다', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: `${location.origin}/assets/a.woff2` } as PerformanceEntry])
    vi.stubGlobal('caches', { open: () => Promise.reject(new Error('quota')), match: () => Promise.resolve(undefined) })
    expect(await warmFontCache()).toBe(0)
  })
})
