import { aiErrorMessage, fetchAiStatus } from './client'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('../sync/supabase', () => ({ supabase: { auth: { getSession } } }))

const status = { configured: true, dailyLimit: 40, used: 12 }

afterEach(() => {
  vi.unstubAllGlobals()
  getSession.mockReset()
})

describe('fetchAiStatus', () => {
  it('로그인해 있으면 토큰을 함께 보내 오늘 쓴 횟수를 받아 온다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => status }))
    vi.stubGlobal('fetch', fetchMock)
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    await expect(fetchAiStatus()).resolves.toEqual(status)
    expect(fetchMock).toHaveBeenCalledWith('/api/ai', { method: 'GET', headers: { Authorization: 'Bearer tok' } })
  })

  it('로그인하지 않았으면 토큰 없이 묻는다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ configured: true, dailyLimit: 40 }) }))
    vi.stubGlobal('fetch', fetchMock)
    getSession.mockResolvedValue({ data: { session: null } })
    await expect(fetchAiStatus()).resolves.toEqual({ configured: true, dailyLimit: 40 })
    expect(fetchMock).toHaveBeenCalledWith('/api/ai', { method: 'GET' })
  })

  it('세션을 읽지 못하거나 서버가 답하지 않으면 준비되지 않은 것으로 본다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => status }))
    vi.stubGlobal('fetch', fetchMock)
    getSession.mockRejectedValue(new Error('storage'))
    await expect(fetchAiStatus()).resolves.toEqual(status)
    expect(fetchMock).toHaveBeenCalledWith('/api/ai', { method: 'GET' })

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    await expect(fetchAiStatus()).resolves.toEqual({ configured: false, dailyLimit: 0 })
  })
})

it('실패 안내는 차분한 말로 적는다', () => {
  expect(aiErrorMessage('limit', { used: 40, limit: 40 })).toBe('오늘 AI 횟수(40번)를 다 썼어요. 내일 다시 쓸 수 있어요.')
  expect(aiErrorMessage('limit')).toBe('오늘 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있어요.')
  expect(aiErrorMessage('busy')).toBe('응답이 늦어져 받지 못했어요. 다시 해 볼 수 있어요.')
})
