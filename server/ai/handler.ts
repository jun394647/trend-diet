/**
 * /api/ai 의 본체. 환경변수, fetch, 모델 호출을 deps로 받아 테스트에서 가짜를 끼울 수 있다.
 * 확인 순서: 키 → 로그인 → 요청 형식 → 허용 목록 → 하루 한도 → Claude.
 * 답하는 순서는 언제나 이대로지만, 로그인 확인과 횟수 쓰기는 기다리는 시간을 줄이려고 함께 보낼 때가 있다(handlePost).
 */
import {
  AI_STREAM_MIME,
  AiRequestSchema,
  DEFAULT_DAILY_LIMIT,
  isAiStreamTask,
  type AiErrorBody,
  type AiErrorCode,
  type AiRequest,
  type AiResponse,
  type AiResultMap,
  type AiTask,
  type AiStatus,
  type AiStreamEvent,
  type AiUsage,
} from '../../src/ai/contract.ts'
import type { CallModel, ModelOutcome } from './model.ts'

export type Env = Record<string, string | undefined>

export interface AiDeps {
  env: Env
  fetch: typeof fetch
  callModel: CallModel
}

const STATUS: Record<AiErrorCode, number> = {
  not_configured: 503,
  unauthorized: 401,
  bad_request: 400,
  forbidden: 403,
  limit: 429,
  refused: 422,
  busy: 503,
  failed: 500,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function fail(error: AiErrorCode, usage?: AiUsage): Response {
  const body: AiErrorBody = usage ? { ok: false, error, usage } : { ok: false, error }
  return json(body, STATUS[error])
}

const value = (s: string | undefined): string => (s ?? '').trim()

export function dailyLimit(env: Env): number {
  const raw = value(env.AI_DAILY_LIMIT)
  const n = /^-?\d+$/.test(raw) ? Number.parseInt(raw, 10) : DEFAULT_DAILY_LIMIT
  return Math.min(500, Math.max(1, n))
}

function supabaseConfig(env: Env): { url: string; anonKey: string } | null {
  const url = (value(env.SUPABASE_URL) || value(env.VITE_SUPABASE_URL)).replace(/\/+$/, '')
  const anonKey = value(env.SUPABASE_ANON_KEY) || value(env.VITE_SUPABASE_ANON_KEY)
  return url && anonKey ? { url, anonKey } : null
}

function allowedEmails(env: Env): Set<string> | null {
  const list = value(env.AI_ALLOWED_EMAILS)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.length > 0 ? new Set(list) : null
}

function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(value(request.headers.get('authorization') ?? undefined))
  return m ? m[1] : null
}

export function aiStatus(env: Env): AiStatus {
  return { configured: Boolean(value(env.ANTHROPIC_API_KEY)), dailyLimit: dailyLimit(env) }
}

type AuthResult = { ok: true; id: string; email: string | null } | { ok: false; error: 'unauthorized' | 'failed' }

async function verifyUser(deps: AiDeps, sb: { url: string; anonKey: string }, token: string): Promise<AuthResult> {
  try {
    const res = await deps.fetch(`${sb.url}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: sb.anonKey, Authorization: `Bearer ${token}` },
    })
    if (res.status === 200) {
      const user = (await res.json()) as { id?: unknown; email?: unknown } | null
      if (user && typeof user.id === 'string' && user.id) {
        return { ok: true, id: user.id, email: typeof user.email === 'string' ? user.email : null }
      }
      return { ok: false, error: 'unauthorized' }
    }
    // 4xx는 토큰이 틀렸거나 만료된 것. 그 밖(5xx)은 로그인 탓이 아니다.
    if (res.status >= 400 && res.status < 500) return { ok: false, error: 'unauthorized' }
    console.log(JSON.stringify({ evt: 'ai', step: 'auth', status: res.status }))
    return { ok: false, error: 'failed' }
  } catch {
    console.log(JSON.stringify({ evt: 'ai', step: 'auth', status: 'network' }))
    return { ok: false, error: 'failed' }
  }
}

/** 오늘 횟수를 하나 쓴다. 쓴 뒤의 횟수, 한도를 넘었으면 -1, 확인하지 못했으면 null. */
async function takeUsage(deps: AiDeps, sb: { url: string; anonKey: string }, token: string, limit: number): Promise<number | null> {
  try {
    const res = await deps.fetch(`${sb.url}/rest/v1/rpc/ai_take`, {
      method: 'POST',
      headers: { apikey: sb.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: limit }),
    })
    if (!res.ok) {
      console.log(JSON.stringify({ evt: 'ai', step: 'usage', status: res.status }))
      return null
    }
    const count: unknown = await res.json()
    if (typeof count === 'number' && Number.isInteger(count) && (count === -1 || count >= 1)) return count
    console.log(JSON.stringify({ evt: 'ai', step: 'usage', status: 'unexpected' }))
    return null
  } catch {
    console.log(JSON.stringify({ evt: 'ai', step: 'usage', status: 'network' }))
    return null
  }
}

/**
 * 토큰이 지금 쓸 수 있는 로그인 토큰처럼 생겼는지 본다. 서명은 확인하지 않는다(확인은 Supabase가 한다).
 * 여기서 읽은 값은 믿지 않고, 로그인 확인과 횟수 쓰기를 함께 보내도 되는지 정하는 데만 쓴다.
 */
export function peekToken(token: string, nowMs: number = Date.now()): { email: string | null } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown; email?: unknown } | null
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) return null
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null
    return { email: typeof payload.email === 'string' ? payload.email : null }
  } catch {
    return null
  }
}

const inAllowList = (allow: Set<string> | null, email: string | null): boolean => !allow || Boolean(email && allow.has(email.trim().toLowerCase()))

/** 화면이 조금씩 받겠다고 했고, 그렇게 줄 수 있는 task인지. */
function wantsStream(request: Request, task: AiTask): boolean {
  return isAiStreamTask(task) && (request.headers.get('accept') ?? '').toLowerCase().includes(AI_STREAM_MIME)
}

/**
 * 조금씩 보내는 응답. run이 send로 넘긴 사건을 SSE로 한 줄씩 내보내고, run이 끝나면 닫는다.
 * 받는 쪽이 떠나면 signal로 알려 모델 호출을 그만두게 한다.
 */
function streamResponse(run: (send: (event: AiStreamEvent) => void, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const gone = new AbortController()
  let open = true
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AiStreamEvent): void => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          open = false
        }
      }
      void run(send, gone.signal)
        .catch(() => {
          console.log(JSON.stringify({ evt: 'ai', step: 'stream', status: 'threw' }))
          send({ type: 'error', ok: false, error: 'failed' })
        })
        .finally(() => {
          if (!open) return
          open = false
          try {
            controller.close()
          } catch {
            // 이미 닫혔다.
          }
        })
    },
    cancel() {
      open = false
      gone.abort()
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': `${AI_STREAM_MIME}; charset=utf-8`,
      // 중간에서 모아 두거나 바꾸지 않고 오는 대로 넘기게 한다.
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function handlePost(request: Request, deps: AiDeps): Promise<Response> {
  const { env } = deps
  const sb = supabaseConfig(env)
  if (!value(env.ANTHROPIC_API_KEY) || !sb) return fail('not_configured')

  const token = bearerToken(request)
  if (!token) return fail('unauthorized')

  // 요청 형식은 네트워크 없이 볼 수 있으니 먼저 읽어 둔다. 답하는 순서는 그대로 로그인이 먼저다.
  let aiRequest: AiRequest | null = null
  try {
    const parsed = AiRequestSchema.safeParse(JSON.parse(await request.text()))
    if (parsed.success) aiRequest = parsed.data
  } catch {
    aiRequest = null
  }

  const allow = allowedEmails(env)
  const limit = dailyLimit(env)

  // 로그인 확인과 횟수 쓰기는 둘 다 Supabase를 한 번씩 다녀온다. 이 요청이 통과할 것으로 보이면
  // (형식이 맞고, 토큰이 만료되지 않은 로그인 토큰처럼 생겼고, 토큰에 적힌 이메일이 허용 목록에 있으면)
  // 둘을 함께 보내 한 번 다녀오는 시간만 기다린다. 그렇지 않으면 예전처럼 차례로 확인해, 통과하지 못할
  // 요청이 횟수를 쓰는 일이 없게 한다. 가짜 토큰은 Supabase가 서명에서 걸러 내므로 횟수를 쓰지 못한다.
  // 함께 보냈는데 로그인 확인만 떨어지는 드문 경우(막 로그아웃한 토큰)에는 그 사용자의 오늘 횟수 하나가 쓰인다.
  const peek = aiRequest ? peekToken(token) : null
  const together = peek !== null && inAllowList(allow, peek.email)
  const early = together ? takeUsage(deps, sb, token, limit) : null

  const user = await verifyUser(deps, sb, token)
  if (!user.ok) return fail(user.error)

  // 횟수를 쓰기 전에 요청부터 확인한다.
  if (!aiRequest) return fail('bad_request')
  if (!inAllowList(allow, user.email)) return fail('forbidden')

  const count = await (early ?? takeUsage(deps, sb, token, limit))
  // 횟수를 확인하지 못하면 Claude를 부르지 않는다.
  if (count === null) return fail('failed')
  if (count === -1) return fail('limit', { used: limit, limit })
  const usage: AiUsage = { used: count, limit }

  const task = aiRequest.task
  const call = async (extra: Pick<Parameters<CallModel>[0], 'onPartial' | 'signal'> = {}): Promise<ModelOutcome> => {
    try {
      return await deps.callModel({ request: aiRequest, userId: user.id, ...extra })
    } catch {
      console.log(JSON.stringify({ evt: 'ai', step: 'model', task, user: user.id, status: 'threw' }))
      return { ok: false, error: 'failed' }
    }
  }

  if (wantsStream(request, task)) {
    return streamResponse(async (send, signal) => {
      send({ type: 'start', usage })
      const outcome = await call({ signal, onPartial: (result) => send({ type: 'partial', result }) })
      if (!outcome.ok) send({ type: 'error', ok: false, error: outcome.error, usage })
      else send({ type: 'done', ok: true, result: outcome.result as AiResultMap[AiTask], usage })
    })
  }

  const outcome = await call()
  if (!outcome.ok) return fail(outcome.error, usage)
  // 이 경로로 오는 요청은 브라우저 계약의 task뿐이라 결과도 그 범위 안이다(서버 전용 task는 여기로 오지 않는다).
  const body: AiResponse = { ok: true, result: outcome.result as AiResultMap[AiTask], usage }
  return json(body)
}

/** 서버 날짜 기준(한국 시간)의 오늘. ai_take()가 세는 날짜와 같아야 한다. */
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 상태 응답. 로그인 토큰이 함께 오면 그 사용자가 오늘 쓴 횟수를 읽어 덧붙인다.
 * 횟수를 읽지 못해도 상태 응답 자체는 돌려준다(화면은 첫 호출 뒤에 알게 된다).
 */
async function statusFor(request: Request, deps: AiDeps): Promise<AiStatus> {
  const status = aiStatus(deps.env)
  const token = bearerToken(request)
  const sb = supabaseConfig(deps.env)
  if (!status.configured || !token || !sb) return status
  try {
    const res = await deps.fetch(`${sb.url}/rest/v1/ai_usage?select=count&day=eq.${kstToday()}`, {
      method: 'GET',
      headers: { apikey: sb.anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.status !== 200) return status
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows)) return status
    const count = rows.length > 0 ? Number((rows[0] as { count?: unknown }).count) : 0
    return Number.isFinite(count) && count >= 0 ? { ...status, used: count } : status
  } catch {
    return status
  }
}

export async function handleAi(request: Request, deps: AiDeps): Promise<Response> {
  if (request.method === 'GET') return json(await statusFor(request, deps))
  if (request.method === 'POST') {
    try {
      return await handlePost(request, deps)
    } catch {
      console.log(JSON.stringify({ evt: 'ai', step: 'handler', status: 'threw' }))
      return fail('failed')
    }
  }
  const res = fail('bad_request')
  return new Response(res.body, { status: 405, headers: { ...Object.fromEntries(res.headers), Allow: 'GET, POST' } })
}
