/** 테스트에서 함께 쓰는 가짜들: 메모리 Supabase, 디스코드 REST, 서명 열쇠. 실제 네트워크는 쓰지 않는다. */
import { vi } from 'vitest'
import type { Checkin, MealEntry, Profile, WeightEntry } from '../../src/types.ts'
import type { CallModel } from '../ai/model.ts'
import type { Env } from '../data/records.ts'

export const OWNER = '111111111111111111'
export const USER_ID = '0b0e7c1e-1111-4222-8333-444455556666'
export const APP_ID = '999999999999999999'
export const BOT_TOKEN = 'bot-token-SECRET'
export const SERVICE_KEY = 'service-key-SECRET'
export const CRON_SECRET = 'cron-secret-SECRET'
export const INTERACTION_TOKEN = 'interaction-token-SECRET'
export const SB = 'https://proj.supabase.co'
/** 한국 시각 2026-11-19(목) 12:00. */
export const NOW = new Date('2026-11-19T03:00:00Z')
export const TODAY = '2026-11-19'

export interface Row {
  user_id: string
  kind: string
  key: string
  data: unknown
  deleted: boolean
}

export const profile: Profile = {
  heightCm: 175,
  birthYear: 1992,
  sex: 'M',
  activityFactor: 1.4,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  phase: 'lose',
  phaseStartedAt: '2026-11-02',
  createdAt: '2026-11-02T00:00:00.000Z',
}
export const checkin: Checkin = {
  date: '2026-11-16',
  kind: 'initial',
  trendKg: 80,
  estimatedTdee: 2550,
  targetKcal: 2000,
  createdAt: '2026-11-16T00:00:00.000Z',
}
export const meal = (id: string, date: string, kcal: number, name?: string): MealEntry => ({
  id,
  date,
  kcal,
  name,
  source: 'exact',
  createdAt: `${date}T03:00:00.000Z`,
})
export const weightEntry = (date: string, kg: number): WeightEntry => ({ date, kg })

const row = (kind: string, key: string, data: unknown, deleted = false): Row => ({ user_id: USER_ID, kind, key, data, deleted })

/** 처음 설정을 마친 주인의 기록. 이번 주(11/16 월~): 월 2,000 · 화 2,300 · 수 1,950, 오늘은 아침 한 끼 600. */
export function seedRows(): Row[] {
  return [
    row('profile', 'profile', profile),
    row('checkin', checkin.date, checkin),
    row('meal', 'm-mon', meal('m-mon', '2026-11-16', 2000, '월요일 식사')),
    row('meal', 'm-tue', meal('m-tue', '2026-11-17', 2300, '화요일 식사')),
    row('meal', 'm-wed', meal('m-wed', '2026-11-18', 1950, '수요일 식사')),
    row('meal', 'm-today', meal('m-today', TODAY, 600, '아침 토스트')),
    row('meal', 'm-gone', meal('m-gone', TODAY, 900, '지운 식사'), true),
    row('weight', '2026-11-16', weightEntry('2026-11-16', 79.6)),
    row('weight', '2026-11-18', weightEntry('2026-11-18', 79.2)),
  ]
}

export function env(extra: Env = {}): Env {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-SECRET',
    VITE_SUPABASE_URL: `${SB}/`,
    VITE_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    CRON_SECRET,
    APP_OWNER_USER_ID: USER_ID,
    DISCORD_BOT_TOKEN: BOT_TOKEN,
    DISCORD_APPLICATION_ID: APP_ID,
    DISCORD_OWNER_ID: OWNER,
    ...extra,
  }
}

export interface WorldOptions {
  rows?: Row[]
  /** ai_take_for가 돌려줄 값. */
  take?: unknown
  /** 이 단계의 Supabase 호출을 실패시킨다. */
  failOn?: 'load' | 'upsert' | 'delete' | 'find' | 'usage'
  /** 디스코드가 이 호출을 거절하게 한다. */
  discordFail?: 'edit' | 'dm-channel' | 'dm-message' | 'commands' | 'endpoint'
  /** 첨부 파일 주소가 돌려줄 바이트. null이면 404. */
  attachment?: Uint8Array | null
}

export interface Sent {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

/** 가짜 fetch 하나로 Supabase, 디스코드, 첨부 파일 저장소를 흉내 낸다. */
export function world(o: WorldOptions = {}) {
  const rows: Row[] = o.rows ?? seedRows()
  const sent: Sent[] = []
  let takes = 0
  const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const fetchFake = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    sent.push({ method, url, headers, body })
    const u = new URL(url)

    if (url.startsWith(SB)) {
      if (headers.apikey !== SERVICE_KEY || headers.authorization !== `Bearer ${SERVICE_KEY}`) return jsonRes({ message: 'no key' }, 401)
      if (u.pathname === '/rest/v1/rpc/ai_take_for') {
        if (o.failOn === 'usage') return jsonRes({ message: 'boom' }, 500)
        takes += 1
        return jsonRes(o.take ?? takes)
      }
      if (u.pathname !== '/rest/v1/records') return jsonRes({ message: 'not found' }, 404)
      const q = u.searchParams
      const mine = (r: Row) => q.get('user_id') === `eq.${r.user_id}`
      if (method === 'GET') {
        const batch = q.get('data->>batch')
        if (batch !== null) {
          if (o.failOn === 'find') return jsonRes({ message: 'boom' }, 500)
          const want = batch.replace(/^eq\./, '')
          return jsonRes(rows.filter((r) => mine(r) && r.kind === 'meal' && (r.data as { batch?: string } | null)?.batch === want))
        }
        if (o.failOn === 'load') return jsonRes({ message: 'boom' }, 500)
        const offset = Number(q.get('offset') ?? 0)
        const limit = Number(q.get('limit') ?? 1000)
        const live = rows.filter((r) => mine(r) && (q.get('deleted') === 'is.false' ? !r.deleted : true))
        return jsonRes(live.slice(offset, offset + limit))
      }
      if (method === 'POST') {
        if (o.failOn === 'upsert') return jsonRes({ message: 'boom' }, 500)
        if (q.get('on_conflict') !== 'user_id,kind,key' || !headers.prefer?.includes('resolution=merge-duplicates')) {
          return jsonRes({ message: 'not an upsert' }, 400)
        }
        for (const w of body as Row[]) {
          const i = rows.findIndex((r) => r.user_id === w.user_id && r.kind === w.kind && r.key === w.key)
          if (i >= 0) rows[i] = { ...w }
          else rows.push({ ...w })
        }
        return new Response(null, { status: 201 })
      }
      if (method === 'PATCH') {
        if (o.failOn === 'delete') return jsonRes({ message: 'boom' }, 500)
        const keys = [...(q.get('key') ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1])
        for (const r of rows) {
          if (mine(r) && q.get('kind') === `eq.${r.kind}` && keys.includes(r.key)) Object.assign(r, body as object)
        }
        return new Response(null, { status: 204 })
      }
    }

    if (u.hostname === 'discord.com') {
      const p = u.pathname.replace('/api/v10', '')
      const refuse = (what: WorldOptions['discordFail']) => (o.discordFail === what ? jsonRes({ message: 'Discord says no', code: 50007 }, 403) : null)
      if (method === 'PATCH' && p === `/webhooks/${APP_ID}/${INTERACTION_TOKEN}/messages/@original`) return refuse('edit') ?? jsonRes({ id: 'msg-1' })
      if (method === 'POST' && p === '/users/@me/channels') return refuse('dm-channel') ?? jsonRes({ id: 'dm-1' })
      if (method === 'POST' && p === '/channels/dm-1/messages') return refuse('dm-message') ?? jsonRes({ id: 'msg-2' })
      if (method === 'PUT' && p === `/applications/${APP_ID}/commands`) return refuse('commands') ?? jsonRes(body)
      if (method === 'PATCH' && p === '/applications/@me') return refuse('endpoint') ?? jsonRes({ id: APP_ID })
      return jsonRes({ message: 'unknown route' }, 404)
    }

    if (u.hostname === 'cdn.discordapp.com') {
      if (o.attachment === null || o.attachment === undefined) return new Response('gone', { status: 404 })
      return new Response(o.attachment.slice().buffer, { status: 200 })
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })

  const of = (method: string, part: string) => sent.filter((s) => s.method === method && s.url.includes(part))
  return {
    fetch: fetchFake as unknown as typeof fetch,
    rows,
    sent,
    /** 원래 응답을 고친 호출들의 본문. */
    edits: () => of('PATCH', '/messages/@original').map((s) => s.body as { content: string; components: unknown[]; allowed_mentions: unknown }),
    /** 주인에게 보낸 개인 메시지들의 본문. */
    dms: () => of('POST', '/channels/dm-1/messages').map((s) => s.body as { content: string }),
    upserts: () => of('POST', '/rest/v1/records').flatMap((s) => s.body as Row[]),
    takeCalls: () => of('POST', '/rpc/ai_take_for'),
    live: (kind: string) => rows.filter((r) => r.kind === kind && !r.deleted),
  }
}

/** 응답을 돌려준 뒤에 이어지는 일을 모아 두었다가 테스트가 끝까지 기다릴 수 있게 한다. */
export function waiter() {
  const pending: Promise<unknown>[] = []
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p)
    },
    pending,
    settle: () => Promise.all(pending),
  }
}

export const modelOk =
  (result: unknown): CallModel =>
  async () =>
    ({ ok: true, result }) as Awaited<ReturnType<CallModel>>

// ── 서명 ────────────────────────────────────────────────────────

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function keypair() {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = hex(await crypto.subtle.exportKey('raw', pair.publicKey))
  const sign = async (timestamp: string, body: string): Promise<string> =>
    hex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(timestamp + body)))
  return { publicKey, sign }
}

/** 로그 어디에도 적은 글이나 비밀값이 없는지 본다. */
export function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
}
export const SECRETS = [BOT_TOKEN, SERVICE_KEY, CRON_SECRET, INTERACTION_TOKEN, 'sk-ant-SECRET']
