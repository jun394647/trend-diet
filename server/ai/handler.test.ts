// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  AI_STREAM_MIME,
  DEFAULT_DAILY_LIMIT,
  type AiErrorBody,
  type AiResponse,
  type AiStatus,
  type AiStreamEvent,
  type AiTask,
} from '../../src/ai/contract.ts'
import { TASKS, sampleRequests, sampleResults } from './fixtures.ts'
import { dailyLimit, handleAi, peekToken, type AiDeps, type Env } from './handler.ts'
import type { CallModel } from './model.ts'

const ENV: Env = {
  ANTHROPIC_API_KEY: 'sk-test',
  VITE_SUPABASE_URL: 'https://proj.supabase.co/',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
}

interface Setup {
  env?: Env
  authStatus?: number
  user?: unknown
  take?: unknown
  takeStatus?: number
  fetchThrowsOn?: 'auth' | 'usage'
  callModel?: CallModel
  /** 로그인 확인 응답을 이 약속이 풀릴 때까지 붙잡아 둔다. */
  holdAuth?: Promise<void>
}

function setup(o: Setup = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchFake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/auth/v1/user')) {
      if (o.fetchThrowsOn === 'auth') throw new Error('network')
      if (o.holdAuth) await o.holdAuth
      return Response.json(o.user ?? { id: 'user-1', email: 'Me@Example.com' }, { status: o.authStatus ?? 200 })
    }
    if (url.endsWith('/rest/v1/rpc/ai_take')) {
      if (o.fetchThrowsOn === 'usage') throw new Error('network')
      return Response.json(o.take ?? 3, { status: o.takeStatus ?? 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  const callModel = vi.fn<CallModel>(o.callModel ?? (async ({ request }) => ({ ok: true, result: sampleResults[request.task as AiTask] })))
  const deps: AiDeps = { env: o.env ?? ENV, fetch: fetchFake as unknown as typeof fetch, callModel }
  const usageCalls = () => calls.filter((c) => c.url.endsWith('/rpc/ai_take'))
  const authCalls = () => calls.filter((c) => c.url.endsWith('/auth/v1/user'))
  return { deps, callModel, calls, usageCalls, authCalls }
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer tok-123' }): Request {
  return new Request('https://app.test/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function errorOf(res: Response): Promise<AiErrorBody> {
  return (await res.json()) as AiErrorBody
}

describe('GET /api/ai', () => {
  const get = () => new Request('https://app.test/api/ai', { method: 'GET' })

  it('키가 있으면 configured와 기본 한도를 돌려준다', async () => {
    const { deps, calls } = setup()
    const res = await handleAi(get(), deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect((await res.json()) as AiStatus).toEqual({ configured: true, dailyLimit: DEFAULT_DAILY_LIMIT })
    expect(calls).toHaveLength(0)
  })

  it('키가 없으면 configured가 false다', async () => {
    const { deps } = setup({ env: { ...ENV, ANTHROPIC_API_KEY: '  ', AI_DAILY_LIMIT: '12' } })
    expect(await (await handleAi(get(), deps)).json()).toEqual({ configured: false, dailyLimit: 12 })
  })
})

describe('하루 한도 설정', () => {
  it('정수가 아니면 기본값, 범위를 벗어나면 1~500으로 맞춘다', () => {
    expect(dailyLimit({})).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimit({ AI_DAILY_LIMIT: 'abc' })).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimit({ AI_DAILY_LIMIT: '1.5' })).toBe(DEFAULT_DAILY_LIMIT)
    expect(dailyLimit({ AI_DAILY_LIMIT: '0' })).toBe(1)
    expect(dailyLimit({ AI_DAILY_LIMIT: '-3' })).toBe(1)
    expect(dailyLimit({ AI_DAILY_LIMIT: '9999' })).toBe(500)
    expect(dailyLimit({ AI_DAILY_LIMIT: ' 25 ' })).toBe(25)
  })
})

describe('POST /api/ai: 거절되는 경우', () => {
  it('API 키가 없으면 not_configured(503)이고 아무것도 부르지 않는다', async () => {
    const s = setup({ env: { ...ENV, ANTHROPIC_API_KEY: undefined } })
    const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await errorOf(res)).toEqual({ ok: false, error: 'not_configured' })
    expect(s.calls).toHaveLength(0)
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('Supabase 설정이 없으면 not_configured다', async () => {
    const s = setup({ env: { ANTHROPIC_API_KEY: 'sk-test' } })
    const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
    expect(res.status).toBe(503)
    expect((await errorOf(res)).error).toBe('not_configured')
    expect(s.calls).toHaveLength(0)
  })

  it('키 없음이 로그인 없음보다 먼저다', async () => {
    const s = setup({ env: { ...ENV, ANTHROPIC_API_KEY: '' } })
    const res = await handleAi(post('not json', {}), s.deps)
    expect((await errorOf(res)).error).toBe('not_configured')
  })

  it('토큰이 없으면 unauthorized(401)이고 Supabase를 부르지 않는다', async () => {
    const variants: Record<string, string>[] = [{}, { Authorization: 'Basic abc' }, { Authorization: 'Bearer ' }]
    for (const headers of variants) {
      const s = setup()
      const res = await handleAi(post(sampleRequests['meal-text'], headers), s.deps)
      expect(res.status).toBe(401)
      expect(await errorOf(res)).toEqual({ ok: false, error: 'unauthorized' })
      expect(s.calls).toHaveLength(0)
      expect(s.callModel).not.toHaveBeenCalled()
    }
  })

  it('토큰이 틀리면 unauthorized이고 횟수와 모델을 쓰지 않는다. 형식 오류보다 먼저다', async () => {
    const s = setup({ authStatus: 401, user: { msg: 'invalid JWT' } })
    const res = await handleAi(post('not json'), s.deps)
    expect(res.status).toBe(401)
    expect((await errorOf(res)).error).toBe('unauthorized')
    expect(s.authCalls()).toHaveLength(1)
    expect(s.usageCalls()).toHaveLength(0)
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('토큰 확인에 anon 키와 사용자의 토큰을 쓴다', async () => {
    const s = setup()
    await handleAi(post(sampleRequests['meal-text']), s.deps)
    const auth = s.authCalls()[0]
    expect(auth.url).toBe('https://proj.supabase.co/auth/v1/user')
    expect(auth.init?.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer tok-123' })
  })

  it('SUPABASE_URL / SUPABASE_ANON_KEY가 있으면 그쪽을 쓴다', async () => {
    const s = setup({ env: { ...ENV, SUPABASE_URL: 'https://other.supabase.co', SUPABASE_ANON_KEY: 'other-key' } })
    await handleAi(post(sampleRequests['meal-text']), s.deps)
    expect(s.authCalls()[0].url).toBe('https://other.supabase.co/auth/v1/user')
    expect(s.authCalls()[0].init?.headers).toMatchObject({ apikey: 'other-key' })
  })

  it('Supabase가 응답하지 않으면 failed이고 모델을 부르지 않는다', async () => {
    for (const o of [{ fetchThrowsOn: 'auth' as const }, { authStatus: 500 }]) {
      const s = setup(o)
      const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
      expect((await errorOf(res)).error).toBe('failed')
      expect(s.usageCalls()).toHaveLength(0)
      expect(s.callModel).not.toHaveBeenCalled()
    }
  })

  it('JSON이 아니거나 스키마에 맞지 않으면 bad_request(400)이고 횟수를 쓰지 않는다', async () => {
    const bodies: unknown[] = [
      'not json',
      {},
      { task: 'unknown' },
      { task: 'meal-text', text: '' },
      { task: 'meal-text', text: '가'.repeat(501) },
      { task: 'meal-photo', imageBase64: 'short', mediaType: 'image/jpeg' },
      { task: 'meal-photo', imageBase64: 'A'.repeat(200), mediaType: 'image/gif' },
      { task: 'ask', context: {}, question: '질문' },
    ]
    for (const body of bodies) {
      const s = setup()
      const res = await handleAi(post(body), s.deps)
      expect(res.status).toBe(400)
      expect(await errorOf(res)).toEqual({ ok: false, error: 'bad_request' })
      expect(s.usageCalls()).toHaveLength(0)
      expect(s.callModel).not.toHaveBeenCalled()
    }
  })

  it('허용 목록에 없으면 forbidden(403)이고 횟수를 쓰지 않는다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: 'a@example.com, b@example.com' } })
    const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
    expect(res.status).toBe(403)
    expect(await errorOf(res)).toEqual({ ok: false, error: 'forbidden' })
    expect(s.usageCalls()).toHaveLength(0)
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('허용 목록이 있는데 이메일이 없는 계정은 forbidden이다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: 'a@example.com' }, user: { id: 'user-2' } })
    expect((await handleAi(post(sampleRequests['meal-text']), s.deps)).status).toBe(403)
  })

  it('형식 오류가 허용 목록보다 먼저다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: 'a@example.com' } })
    expect((await errorOf(await handleAi(post({ task: 'nope' }), s.deps))).error).toBe('bad_request')
  })

  it('허용 목록은 대소문자와 공백을 가리지 않는다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: ' other@example.com ,  ME@example.COM ' } })
    const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
    expect(res.status).toBe(200)
    expect(s.callModel).toHaveBeenCalledTimes(1)
  })

  it('허용 목록이 비어 있으면 로그인한 누구나 쓸 수 있다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: ' , ' } })
    expect((await handleAi(post(sampleRequests['meal-text']), s.deps)).status).toBe(200)
  })

  it('한도를 넘으면 limit(429)과 usage를 돌려주고 모델을 부르지 않는다', async () => {
    const s = setup({ take: -1, env: { ...ENV, AI_DAILY_LIMIT: '5' } })
    const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
    expect(res.status).toBe(429)
    expect(await errorOf(res)).toEqual({ ok: false, error: 'limit', usage: { used: 5, limit: 5 } })
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('횟수 RPC는 사용자의 토큰과 한도를 보낸다', async () => {
    const s = setup({ env: { ...ENV, AI_DAILY_LIMIT: '7' } })
    await handleAi(post(sampleRequests['meal-text']), s.deps)
    const rpc = s.usageCalls()[0]
    expect(rpc.url).toBe('https://proj.supabase.co/rest/v1/rpc/ai_take')
    expect(rpc.init?.method).toBe('POST')
    expect(rpc.init?.headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer tok-123' })
    expect(JSON.parse(String(rpc.init?.body))).toEqual({ p_limit: 7 })
  })

  it('횟수를 확인하지 못하면 failed이고 모델을 부르지 않는다', async () => {
    const cases: Setup[] = [{ takeStatus: 500 }, { fetchThrowsOn: 'usage' }, { take: 'oops' }, { take: 0 }, { take: { count: 1 } }]
    for (const o of cases) {
      const s = setup(o)
      const res = await handleAi(post(sampleRequests['meal-text']), s.deps)
      expect(res.status).toBe(500)
      expect((await errorOf(res)).error).toBe('failed')
      expect(s.callModel).not.toHaveBeenCalled()
    }
  })
})

describe('POST /api/ai: 성공과 모델 쪽 실패', () => {
  it.each(TASKS)('%s: 계약대로 result와 usage를 돌려준다', async (task) => {
    const s = setup({ take: 4 })
    const res = await handleAi(post(sampleRequests[task]), s.deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = (await res.json()) as AiResponse
    expect(body).toEqual({ ok: true, result: sampleResults[task], usage: { used: 4, limit: DEFAULT_DAILY_LIMIT } })
    expect(s.usageCalls()).toHaveLength(1)
    expect(s.callModel).toHaveBeenCalledTimes(1)
    const args = s.callModel.mock.calls[0][0]
    expect(args.userId).toBe('user-1')
    expect(args.request.task).toBe(task)
  })

  it('ask에서 history를 빼면 빈 배열로 채워 넘긴다', async () => {
    const s = setup()
    const { history: _history, ...rest } = sampleRequests.ask
    await handleAi(post(rest), s.deps)
    expect(s.callModel.mock.calls[0][0].request).toMatchObject({ task: 'ask', history: [] })
  })

  it.each([
    ['refused', 422],
    ['busy', 503],
    ['not_configured', 503],
    ['failed', 500],
  ] as const)('모델이 %s를 돌려주면 그대로 전하고 쓴 횟수를 알려 준다', async (error, status) => {
    const s = setup({ take: 9, callModel: async () => ({ ok: false, error }) })
    const res = await handleAi(post(sampleRequests.ask), s.deps)
    expect(res.status).toBe(status)
    expect(await errorOf(res)).toEqual({ ok: false, error, usage: { used: 9, limit: DEFAULT_DAILY_LIMIT } })
  })

  it('callModel이 던져도 failed로 답한다', async () => {
    const s = setup({
      callModel: async () => {
        throw new Error('boom')
      },
    })
    const res = await handleAi(post(sampleRequests.suggest), s.deps)
    expect(res.status).toBe(500)
    expect((await errorOf(res)).error).toBe('failed')
  })

  it('다른 메서드는 405다', async () => {
    const s = setup()
    const res = await handleAi(new Request('https://app.test/api/ai', { method: 'DELETE' }), s.deps)
    expect(res.status).toBe(405)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('GET 상태에 오늘 쓴 횟수 덧붙이기', () => {
  const env = { ANTHROPIC_API_KEY: 'k', VITE_SUPABASE_URL: 'https://sb.example', VITE_SUPABASE_ANON_KEY: 'anon' }
  const get = (headers?: Record<string, string>) => new Request('https://app.example/api/ai', { method: 'GET', headers })
  const run = async (req: Request, fetchImpl: typeof fetch) => {
    const callModel = vi.fn()
    const res = await handleAi(req, { env, fetch: fetchImpl, callModel } as never)
    return { body: (await res.json()) as { configured: boolean; dailyLimit: number; used?: number }, callModel }
  }

  it('토큰이 없으면 횟수를 읽지 않는다', async () => {
    const f = vi.fn()
    const { body } = await run(get(), f as never)
    expect(body.used).toBeUndefined()
    expect(f).not.toHaveBeenCalled()
  })

  it('토큰이 있으면 그 사용자의 오늘 횟수를 읽는다', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/rest/v1/ai_usage?select=count&day=eq.')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      return new Response(JSON.stringify([{ count: 7 }]), { status: 200 })
    })
    const { body } = await run(get({ Authorization: 'Bearer tok' }), f as never)
    expect(body).toMatchObject({ configured: true, used: 7 })
  })

  it('오늘 기록이 없으면 0이다', async () => {
    const f = vi.fn(async () => new Response('[]', { status: 200 }))
    expect((await run(get({ Authorization: 'Bearer tok' }), f as never)).body.used).toBe(0)
  })

  it('횟수를 읽지 못해도 상태는 돌려준다', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500 }))
    const { body } = await run(get({ Authorization: 'Bearer tok' }), f as never)
    expect(body.configured).toBe(true)
    expect(body.used).toBeUndefined()
    const g = vi.fn(async () => {
      throw new Error('network')
    })
    expect((await run(get({ Authorization: 'Bearer tok' }), g as never)).body.used).toBeUndefined()
  })
})

// ── 로그인 확인과 횟수 쓰기를 함께 보내기 ─────────────────────────────

/** 서명은 가짜지만 모양은 로그인 토큰인 것. 서버는 모양만 보고 함께 보낼지 정하고, 진짜 확인은 Supabase가 한다. */
function jwt(payload: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.sig`
}
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600
const goodToken = () => jwt({ sub: 'user-1', email: 'me@example.com', exp: inAnHour() })
const withToken = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra })

describe('peekToken', () => {
  it('만료되지 않은 로그인 토큰의 모양이면 적힌 이메일을 돌려준다', () => {
    expect(peekToken(goodToken())).toEqual({ email: 'me@example.com' })
    expect(peekToken(jwt({ sub: 'u', exp: inAnHour() }))).toEqual({ email: null })
  })

  it('모양이 아니거나, 만료됐거나, 사용자가 없으면 null이다', () => {
    expect(peekToken('tok-123')).toBeNull()
    expect(peekToken('a.b.c')).toBeNull()
    expect(peekToken(jwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull()
    expect(peekToken(jwt({ sub: 'u' }))).toBeNull()
    expect(peekToken(jwt({ exp: inAnHour() }))).toBeNull()
    expect(peekToken(`${'x'.repeat(10)}.${Buffer.from('null').toString('base64url')}.s`)).toBeNull()
  })
})

describe('POST /api/ai: 확인을 함께 보내기', () => {
  it('통과할 것으로 보이는 요청은 로그인 확인이 끝나기를 기다리지 않고 횟수를 쓴다', async () => {
    let release: () => void = () => {}
    const s = setup({ holdAuth: new Promise<void>((r) => (release = r)), take: 5 })
    const pending = handleAi(post(sampleRequests.suggest, withToken(goodToken())), s.deps)
    await vi.waitFor(() => expect(s.usageCalls()).toHaveLength(1))
    expect(s.authCalls()).toHaveLength(1)
    // 로그인 확인이 아직 끝나지 않았으니 모델은 부르지 않았다.
    expect(s.callModel).not.toHaveBeenCalled()
    release()
    const res = await pending
    expect(res.status).toBe(200)
    expect(((await res.json()) as AiResponse).usage).toEqual({ used: 5, limit: DEFAULT_DAILY_LIMIT })
    expect(s.usageCalls()).toHaveLength(1)
    expect(s.callModel).toHaveBeenCalledTimes(1)
  })

  it('함께 보냈어도 로그인 확인이 떨어지면 unauthorized이고 모델을 부르지 않는다', async () => {
    const s = setup({ authStatus: 401, user: { message: 'invalid JWT' } })
    const res = await handleAi(post(sampleRequests.ask, withToken(goodToken())), s.deps)
    expect(res.status).toBe(401)
    expect((await errorOf(res)).error).toBe('unauthorized')
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('함께 보냈을 때도 한도를 넘으면 limit, 횟수를 확인하지 못하면 failed다', async () => {
    const over = setup({ take: -1 })
    const res = await handleAi(post(sampleRequests.ask, withToken(goodToken())), over.deps)
    expect(res.status).toBe(429)
    expect(await errorOf(res)).toEqual({ ok: false, error: 'limit', usage: { used: DEFAULT_DAILY_LIMIT, limit: DEFAULT_DAILY_LIMIT } })
    expect(over.callModel).not.toHaveBeenCalled()

    const down = setup({ fetchThrowsOn: 'usage' })
    expect((await handleAi(post(sampleRequests.ask, withToken(goodToken())), down.deps)).status).toBe(500)
    expect(down.callModel).not.toHaveBeenCalled()
  })

  it.each([
    ['형식이 틀린 요청', { task: 'nope' }, goodToken(), {}, 400, 'bad_request'],
    ['만료된 토큰', sampleRequests.ask, jwt({ sub: 'user-1', email: 'me@example.com', exp: 1 }), {}, 200, null],
    ['토큰의 이메일이 허용 목록에 없을 때', sampleRequests.ask, jwt({ sub: 'x', email: 'other@example.com', exp: inAnHour() }), { AI_ALLOWED_EMAILS: 'me@example.com' }, 200, null],
    ['허용 목록이 있는데 토큰에 이메일이 없을 때', sampleRequests.ask, jwt({ sub: 'x', exp: inAnHour() }), { AI_ALLOWED_EMAILS: 'me@example.com' }, 200, null],
  ] as const)('%s: 차례로 확인한다(로그인 확인이 끝나기 전에는 횟수를 쓰지 않는다)', async (_name, body, token, env, status, error) => {
    let release: () => void = () => {}
    const s = setup({ env: { ...ENV, ...env }, holdAuth: new Promise<void>((r) => (release = r)) })
    const pending = handleAi(post(body, withToken(token)), s.deps)
    await vi.waitFor(() => expect(s.authCalls()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 5))
    expect(s.usageCalls()).toHaveLength(0)
    release()
    const res = await pending
    expect(res.status).toBe(status)
    if (error) {
      expect((await errorOf(res)).error).toBe(error)
      expect(s.usageCalls()).toHaveLength(0)
    }
  })

  it('토큰에는 허용된 이메일이 적혀 있는데 확인된 계정이 다르면 forbidden이고 모델을 부르지 않는다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: 'me@example.com' }, user: { id: 'user-2', email: 'other@example.com' } })
    const res = await handleAi(post(sampleRequests.ask, withToken(goodToken())), s.deps)
    expect(res.status).toBe(403)
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('허용 목록에 있는 계정은 함께 보낸다', async () => {
    const s = setup({ env: { ...ENV, AI_ALLOWED_EMAILS: 'Me@Example.com' }, holdAuth: Promise.resolve() })
    const res = await handleAi(post(sampleRequests.ask, withToken(goodToken())), s.deps)
    expect(res.status).toBe(200)
    expect(s.usageCalls()).toHaveLength(1)
  })
})

// ── 조금씩 보내기 ───────────────────────────────────────────────

const STREAM = { Authorization: 'Bearer tok-123', Accept: `${AI_STREAM_MIME}, application/json` }

/** SSE 본문을 사건 목록으로 읽는다. onEvent는 사건이 도착하는 대로 불린다. */
async function readEvents(res: Response, onEvent?: (e: AiStreamEvent) => void): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = []
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      expect(frame.startsWith('data: ')).toBe(true)
      const event = JSON.parse(frame.slice(6)) as AiStreamEvent
      out.push(event)
      onEvent?.(event)
    }
  }
  expect(buf).toBe('')
  return out
}

describe('POST /api/ai: 조금씩 보내기', () => {
  it('ask: 시작, 쓰이는 중인 답, 끝을 차례로 보낸다. 끝은 한 덩어리 응답과 같은 내용이다', async () => {
    const gates: (() => void)[] = []
    const gate = () => new Promise<void>((r) => gates.push(r))
    const s = setup({
      take: 7,
      callModel: async ({ onPartial }) => {
        await gate()
        onPartial?.({ answer: '외식 날은' })
        await gate()
        onPartial?.({ answer: '외식 날은 범위 위쪽까지' })
        await gate()
        return { ok: true, result: sampleResults.ask }
      },
    })
    const res = await handleAi(post(sampleRequests.ask, STREAM), s.deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain(AI_STREAM_MIME)
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-transform')

    // 모델이 아직 한 글자도 쓰지 않았어도 응답은 이미 시작됐고, 사건은 모델이 쓰는 대로 하나씩 도착한다.
    const seen: string[] = []
    const usage = { used: 7, limit: DEFAULT_DAILY_LIMIT }
    const events = await readEvents(res, (e) => {
      seen.push(e.type)
      gates.shift()?.()
    })
    expect(seen).toEqual(['start', 'partial', 'partial', 'done'])
    expect(events).toEqual([
      { type: 'start', usage },
      { type: 'partial', result: { answer: '외식 날은' } },
      { type: 'partial', result: { answer: '외식 날은 범위 위쪽까지' } },
      { type: 'done', ok: true, result: sampleResults.ask, usage },
    ])
    expect(s.usageCalls()).toHaveLength(1)
    expect(s.callModel).toHaveBeenCalledTimes(1)
    expect(s.callModel.mock.calls[0][0]).toMatchObject({ userId: 'user-1', request: { task: 'ask' } })
    expect(s.callModel.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
  })

  it('week-review도 조금씩 보낸다', async () => {
    const s = setup({
      callModel: async ({ onPartial }) => {
        onPartial?.({ headline: '주 평균이' })
        return { ok: true, result: sampleResults['week-review'] }
      },
    })
    const events = await readEvents(await handleAi(post(sampleRequests['week-review'], STREAM), s.deps))
    expect(events.map((e) => e.type)).toEqual(['start', 'partial', 'done'])
    expect(events[1]).toEqual({ type: 'partial', result: { headline: '주 평균이' } })
    expect(events[2]).toMatchObject({ ok: true, result: sampleResults['week-review'] })
  })

  it.each([
    ['refused'],
    ['busy'],
    ['failed'],
  ] as const)('도중에 모델이 %s로 끝나면 error 사건으로 알리고 쓴 횟수를 함께 보낸다', async (error) => {
    const s = setup({
      take: 9,
      callModel: async ({ onPartial }) => {
        onPartial?.({ answer: '외식 날은' })
        return { ok: false, error }
      },
    })
    const res = await handleAi(post(sampleRequests.ask, STREAM), s.deps)
    expect(res.status).toBe(200)
    const events = await readEvents(res)
    expect(events.map((e) => e.type)).toEqual(['start', 'partial', 'error'])
    expect(events[2]).toEqual({ type: 'error', ok: false, error, usage: { used: 9, limit: DEFAULT_DAILY_LIMIT } })
  })

  it('callModel이 던져도 failed 사건으로 끝맺는다', async () => {
    const s = setup({
      callModel: async () => {
        throw new Error('boom')
      },
    })
    const events = await readEvents(await handleAi(post(sampleRequests.ask, STREAM), s.deps))
    expect(events[events.length - 1]).toMatchObject({ type: 'error', ok: false, error: 'failed', usage: { used: 3 } })
  })

  it('확인 단계의 실패는 조금씩 받겠다고 해도 평소의 JSON 오류와 상태 코드다', async () => {
    const cases: [Setup, unknown, Record<string, string>, number, string][] = [
      [{ env: { ...ENV, ANTHROPIC_API_KEY: '' } }, sampleRequests.ask, STREAM, 503, 'not_configured'],
      [{}, sampleRequests.ask, { Accept: AI_STREAM_MIME }, 401, 'unauthorized'],
      [{ authStatus: 401 }, sampleRequests.ask, STREAM, 401, 'unauthorized'],
      [{}, { task: 'ask' }, STREAM, 400, 'bad_request'],
      [{ env: { ...ENV, AI_ALLOWED_EMAILS: 'a@b.c' } }, sampleRequests.ask, STREAM, 403, 'forbidden'],
      [{ take: -1 }, sampleRequests.ask, STREAM, 429, 'limit'],
      [{ takeStatus: 500 }, sampleRequests.ask, STREAM, 500, 'failed'],
    ]
    for (const [o, body, headers, status, error] of cases) {
      const s = setup(o)
      const res = await handleAi(post(body, headers), s.deps)
      expect(res.status).toBe(status)
      expect(res.headers.get('Content-Type')).toContain('application/json')
      expect((await errorOf(res)).error).toBe(error)
      expect(s.callModel).not.toHaveBeenCalled()
    }
  })

  it('조금씩 받을 수 없는 task와 Accept를 붙이지 않은 요청은 JSON 한 덩어리로 답한다', async () => {
    for (const [body, headers] of [
      [sampleRequests['meal-text'], STREAM],
      [sampleRequests.suggest, STREAM],
      [sampleRequests.ask, { Authorization: 'Bearer tok-123' }],
      [sampleRequests.ask, { Authorization: 'Bearer tok-123', Accept: 'application/json' }],
    ] as const) {
      const s = setup()
      const res = await handleAi(post(body, headers), s.deps)
      expect(res.headers.get('Content-Type')).toContain('application/json')
      expect(((await res.json()) as AiResponse).ok).toBe(true)
      expect(s.callModel.mock.calls[0][0].onPartial).toBeUndefined()
    }
  })

  it('받는 쪽이 떠나면 모델 호출에 그만두라고 알린다', async () => {
    let signal: AbortSignal | undefined
    const s = setup({
      callModel: ({ signal: given, onPartial }) => {
        signal = given
        onPartial?.({ answer: '외식' })
        return new Promise((resolve) => given?.addEventListener('abort', () => resolve({ ok: false, error: 'busy' })))
      },
    })
    const res = await handleAi(post(sampleRequests.ask, STREAM), s.deps)
    const reader = res.body!.getReader()
    await reader.read()
    expect(signal?.aborted).toBe(false)
    await reader.cancel()
    expect(signal?.aborted).toBe(true)
  })
})
