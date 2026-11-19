/**
 * /api/ai 의 본체. 환경변수, fetch, 모델 호출을 deps로 받아 테스트에서 가짜를 끼울 수 있다.
 * 확인 순서: 키 → 로그인 → 요청 형식 → 허용 목록 → 하루 한도 → Claude.
 */
import {
  AiRequestSchema,
  DEFAULT_DAILY_LIMIT,
  type AiErrorBody,
  type AiErrorCode,
  type AiRequest,
  type AiResponse,
  type AiStatus,
  type AiUsage,
} from '../../src/ai/contract.ts'
import type { CallModel } from './model.ts'

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

async function handlePost(request: Request, deps: AiDeps): Promise<Response> {
  const { env } = deps
  const sb = supabaseConfig(env)
  if (!value(env.ANTHROPIC_API_KEY) || !sb) return fail('not_configured')

  const token = bearerToken(request)
  if (!token) return fail('unauthorized')
  const user = await verifyUser(deps, sb, token)
  if (!user.ok) return fail(user.error)

  // 횟수를 쓰기 전에 요청부터 확인한다.
  let raw: unknown
  try {
    raw = JSON.parse(await request.text())
  } catch {
    return fail('bad_request')
  }
  const parsed = AiRequestSchema.safeParse(raw)
  if (!parsed.success) return fail('bad_request')
  const aiRequest: AiRequest = parsed.data

  const allow = allowedEmails(env)
  if (allow && !(user.email && allow.has(user.email.trim().toLowerCase()))) return fail('forbidden')

  const limit = dailyLimit(env)
  const count = await takeUsage(deps, sb, token, limit)
  // 횟수를 확인하지 못하면 Claude를 부르지 않는다.
  if (count === null) return fail('failed')
  if (count === -1) return fail('limit', { used: limit, limit })
  const usage: AiUsage = { used: count, limit }

  let outcome: Awaited<ReturnType<CallModel>>
  try {
    outcome = await deps.callModel({ request: aiRequest, userId: user.id })
  } catch {
    console.log(JSON.stringify({ evt: 'ai', step: 'model', task: aiRequest.task, user: user.id, status: 'threw' }))
    outcome = { ok: false, error: 'failed' }
  }
  if (!outcome.ok) return fail(outcome.error, usage)
  const body: AiResponse = { ok: true, result: outcome.result, usage }
  return json(body)
}

export async function handleAi(request: Request, deps: AiDeps): Promise<Response> {
  if (request.method === 'GET') return json(aiStatus(deps.env))
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
