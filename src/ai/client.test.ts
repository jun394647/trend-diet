import { AiError, aiErrorMessage, callAi, fetchAiStatus } from './client'
import { AI_STREAM_MIME, type AiRequest, type CoachContext } from './contract'

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

// ── callAi ────────────────────────────────────────────────────

const ctx = { today: '2026-11-19' } as CoachContext
const ask: AiRequest = { task: 'ask', context: ctx, question: '외식이 있어요', history: [] }
const usage = { used: 3, limit: 40 }

/** 본문을 조금씩 흘려보낼 수 있는 가짜 SSE 응답. */
function sseResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) })
  return {
    res: new Response(body, { status: 200, headers: { 'Content-Type': `${AI_STREAM_MIME}; charset=utf-8` } }),
    raw: (text: string) => controller.enqueue(encoder.encode(text)),
    bytes: (chunk: Uint8Array) => controller.enqueue(chunk),
    send: (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    end: () => controller.close(),
    fail: (e: unknown) => controller.error(e),
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('callAi', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  })

  it('onPartial이 없으면 예전처럼 JSON 한 덩어리를 받는다. Accept를 붙이지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true, result: { answer: '네.' }, usage }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callAi(ask)).resolves.toEqual({ result: { answer: '네.' }, usage })
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' })
  })

  it('조금씩 받을 수 없는 task는 onPartial을 줘도 Accept를 붙이지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ ok: true, result: { items: [], note: '' }, usage }))
    vi.stubGlobal('fetch', fetchMock)
    const onPartial = vi.fn()
    await callAi({ task: 'meal-text', text: '밥' }, undefined, { onPartial: onPartial as never })
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Accept')
    expect(onPartial).not.toHaveBeenCalled()
  })

  it('조각이 시간에 걸쳐 도착하는 대로 onPartial을 부르고, done의 결과와 사용량을 돌려준다', async () => {
    const s = sseResponse()
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => s.res)
    vi.stubGlobal('fetch', fetchMock)
    const partials: string[] = []
    let settled = false
    const pending = callAi(ask, undefined, { onPartial: (p) => partials.push(p.answer) }).finally(() => (settled = true))
    await tick()
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Accept).toContain(AI_STREAM_MIME)

    s.send({ type: 'start', usage })
    await tick()
    expect(partials).toEqual([])
    s.send({ type: 'partial', result: { answer: '외식 날은' } })
    await tick()
    expect(partials).toEqual(['외식 날은'])
    s.send({ type: 'partial', result: { answer: '외식 날은 범위 위쪽까지' } })
    await tick()
    expect(partials).toEqual(['외식 날은', '외식 날은 범위 위쪽까지'])
    expect(settled).toBe(false)
    s.send({ type: 'done', ok: true, result: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }, usage })
    await expect(pending).resolves.toEqual({ result: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }, usage })
  })

  it('사건이 조각 경계에서 잘려 와도(한글 한 글자의 중간 포함) 제대로 읽는다', async () => {
    const s = sseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => s.res))
    const partials: string[] = []
    const pending = callAi(ask, undefined, { onPartial: (p) => partials.push(p.answer) })
    await tick()
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify({ type: 'partial', result: { answer: '가나다' } })}\n\n: 주석 줄\n\ndata: ${JSON.stringify({ type: 'done', ok: true, result: { answer: '가나다라' }, usage })}\n\n`,
    )
    for (let i = 0; i < bytes.length; i += 5) {
      s.bytes(bytes.slice(i, i + 5))
      await tick()
    }
    await expect(pending).resolves.toEqual({ result: { answer: '가나다라' }, usage })
    expect(partials).toEqual(['가나다'])
  })

  it('도중에 error 사건이 오면 그 사유와 사용량으로 던진다', async () => {
    const s = sseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => s.res))
    const partials: string[] = []
    const pending = callAi(ask, undefined, { onPartial: (p) => partials.push(p.answer) })
    await tick()
    s.send({ type: 'start', usage })
    s.send({ type: 'partial', result: { answer: '외식' } })
    s.send({ type: 'error', ok: false, error: 'refused', usage })
    const error = (await pending.catch((e: unknown) => e)) as AiError
    expect(error).toBeInstanceOf(AiError)
    expect(error.code).toBe('refused')
    expect(error.usage).toEqual(usage)
    expect(partials).toEqual(['외식'])
  })

  it('끝맺지 못하고 끊기면 busy로 던지고, 그때까지 안 사용량을 함께 알린다', async () => {
    for (const how of ['end', 'fail'] as const) {
      const s = sseResponse()
      vi.stubGlobal('fetch', vi.fn(async () => s.res))
      const pending = callAi(ask, undefined, { onPartial: () => {} })
      await tick()
      s.send({ type: 'start', usage })
      s.send({ type: 'partial', result: { answer: '외식' } })
      await tick()
      if (how === 'end') s.end()
      else s.fail(new TypeError('network error'))
      const error = (await pending.catch((e: unknown) => e)) as AiError
      expect(error).toBeInstanceOf(AiError)
      expect(error.code).toBe('busy')
      expect(error.usage).toEqual(usage)
    }
  })

  it('읽는 도중에 취소되면(AbortError) 그대로 던진다', async () => {
    const s = sseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => s.res))
    const pending = callAi(ask, undefined, { onPartial: () => {} })
    await tick()
    s.send({ type: 'start', usage })
    await tick()
    s.fail(new DOMException('aborted', 'AbortError'))
    const error = (await pending.catch((e: unknown) => e)) as DOMException
    expect(error).toBeInstanceOf(DOMException)
    expect(error.name).toBe('AbortError')
  })

  it('조금씩 받겠다고 했는데 JSON으로 답하면(확인 단계의 실패, 예전 서버) 평소처럼 읽는다', async () => {
    const onPartial = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, result: { answer: '네.' }, usage })))
    await expect(callAi(ask, undefined, { onPartial })).resolves.toEqual({ result: { answer: '네.' }, usage })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, error: 'limit', usage: { used: 40, limit: 40 } }, { status: 429 })))
    const error = (await callAi(ask, undefined, { onPartial }).catch((e: unknown) => e)) as AiError
    expect(error.code).toBe('limit')
    expect(error.usage).toEqual({ used: 40, limit: 40 })
    expect(onPartial).not.toHaveBeenCalled()
  })

  it('읽을 수 없는 줄과 모르는 사건은 건너뛴다', async () => {
    const s = sseResponse()
    vi.stubGlobal('fetch', vi.fn(async () => s.res))
    const pending = callAi(ask, undefined, { onPartial: () => {} })
    await tick()
    s.raw('data: {깨진 줄\n\nevent: ping\ndata: {"type":"later"}\n\n')
    s.send({ type: 'done', ok: true, result: { answer: '네.' }, usage })
    await expect(pending).resolves.toEqual({ result: { answer: '네.' }, usage })
  })

  it('로그인하지 않았으면 서버에 묻지 않고 unauthorized다', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(callAi(ask, undefined, { onPartial: () => {} })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
