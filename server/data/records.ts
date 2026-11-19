/**
 * 서버가 주인의 기록을 읽고 쓰는 곳. Supabase REST를 서비스 키로 부른다(행 수준 보안을 거치지 않는다).
 * 앱이 동기화하는 것은 모두 public.records 한 테이블에 있고, 여기서 쓴 행은 앱의 다음 동기화 때 내려간다.
 * 삭제는 행을 지우지 않고 deleted = true 로 표시한다.
 */
import type { Checkin, Favorite, MealEntry, Profile, WeightEntry } from '../../src/types.ts'

export type Env = Record<string, string | undefined>
export type RecordKind = 'profile' | 'weight' | 'meal' | 'favorite' | 'checkin'

export interface DataConfig {
  url: string
  serviceKey: string
  /** 주인의 앱 계정(Supabase auth user id). */
  userId: string
}

export interface UserData {
  profile: Profile | null
  weights: WeightEntry[]
  meals: MealEntry[]
  favorites: Favorite[]
  checkins: Checkin[]
}

export interface RecordWrite {
  kind: RecordKind
  key: string
  data: unknown
}

/** 읽거나 쓰지 못했다. status는 HTTP 상태나 'network'. 본문은 담지 않는다. */
export class DataError extends Error {
  readonly step: string
  readonly status: number | 'network' | 'unexpected'
  constructor(step: string, status: number | 'network' | 'unexpected') {
    super(`data ${step}: ${status}`)
    this.name = 'DataError'
    this.step = step
    this.status = status
  }
}

const value = (s: string | undefined): string => (s ?? '').trim()
const TIMEOUT_MS = 8_000
const PAGE = 1000

export function dataConfig(env: Env): DataConfig | null {
  const url = (value(env.SUPABASE_URL) || value(env.VITE_SUPABASE_URL)).replace(/\/+$/, '')
  const serviceKey = value(env.SUPABASE_SERVICE_ROLE_KEY)
  const userId = value(env.APP_OWNER_USER_ID)
  return url && serviceKey && /^[0-9a-f-]{36}$/i.test(userId) ? { url, serviceKey, userId } : null
}

/** 한국 날짜(UTC+9)의 오늘. 앱 사용자의 기기 날짜, 그리고 ai_take_for()가 세는 날짜와 같다. */
export function kstToday(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function headers(cfg: DataConfig, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, Accept: 'application/json', ...extra }
}

async function send(fetchFn: typeof fetch, step: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new DataError(step, 'network')
  }
  if (!res.ok) throw new DataError(step, res.status)
  return res
}

async function rowsOf(res: Response, step: string): Promise<Record<string, unknown>[]> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new DataError(step, 'unexpected')
  }
  if (!Array.isArray(body)) throw new DataError(step, 'unexpected')
  return body.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
}

// ── 읽은 JSON이 앱의 타입 모양인지 확인한다. 맞지 않는 행은 건너뛴다. ──────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

export function asMeal(v: unknown): MealEntry | null {
  if (!isObj(v) || !isStr(v.id) || !isDate(v.date) || !isNum(v.kcal) || !isStr(v.createdAt)) return null
  if (v.name !== undefined && !isStr(v.name)) return null
  return v as unknown as MealEntry
}
function asWeight(v: unknown): WeightEntry | null {
  return isObj(v) && isDate(v.date) && isNum(v.kg) ? (v as unknown as WeightEntry) : null
}
function asCheckin(v: unknown): Checkin | null {
  return isObj(v) && isDate(v.date) && isNum(v.targetKcal) && isNum(v.estimatedTdee) ? (v as unknown as Checkin) : null
}
function asFavorite(v: unknown): Favorite | null {
  return isObj(v) && isStr(v.id) && isStr(v.name) && isNum(v.kcal) ? (v as unknown as Favorite) : null
}
function asProfile(v: unknown): Profile | null {
  const ok =
    isObj(v) &&
    isNum(v.heightCm) &&
    isNum(v.birthYear) &&
    (v.sex === 'M' || v.sex === 'F') &&
    isNum(v.startWeightKg) &&
    isNum(v.goalWeightKg) &&
    isNum(v.weeklyLossKg) &&
    isStr(v.createdAt)
  return ok ? (v as unknown as Profile) : null
}

/** 주인의 지워지지 않은 기록을 모두 읽어 앱과 같은 모양으로 모은다. */
export async function loadUserData(fetchFn: typeof fetch, cfg: DataConfig): Promise<UserData> {
  const out: UserData = { profile: null, weights: [], meals: [], favorites: [], checkins: [] }
  for (let offset = 0; ; offset += PAGE) {
    const query = `select=kind,key,data&user_id=eq.${cfg.userId}&deleted=is.false&order=kind.asc,key.asc&limit=${PAGE}&offset=${offset}`
    const res = await send(fetchFn, 'load', `${cfg.url}/rest/v1/records?${query}`, { method: 'GET', headers: headers(cfg) })
    const rows = await rowsOf(res, 'load')
    for (const row of rows) {
      switch (row.kind) {
        case 'profile':
          out.profile = asProfile(row.data) ?? out.profile
          break
        case 'weight': {
          const w = asWeight(row.data)
          if (w) out.weights.push(w)
          break
        }
        case 'meal': {
          const m = asMeal(row.data)
          if (m) out.meals.push(m)
          break
        }
        case 'favorite': {
          const f = asFavorite(row.data)
          if (f) out.favorites.push(f)
          break
        }
        case 'checkin': {
          const c = asCheckin(row.data)
          if (c) out.checkins.push(c)
          break
        }
      }
    }
    if (rows.length < PAGE) break
  }
  out.weights.sort((a, b) => a.date.localeCompare(b.date))
  out.meals.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return out
}

/** 레코드를 쓴다. 같은 (user_id, kind, key)가 있으면 덮어쓰고, 지워졌던 것이면 되살린다. 여러 건은 한 번에 들어간다. */
export async function upsertRecords(fetchFn: typeof fetch, cfg: DataConfig, writes: RecordWrite[]): Promise<void> {
  if (writes.length === 0) return
  const body = writes.map((w) => ({ user_id: cfg.userId, kind: w.kind, key: w.key, data: w.data, deleted: false }))
  await send(fetchFn, 'upsert', `${cfg.url}/rest/v1/records?on_conflict=user_id,kind,key`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(body),
  })
}

/** 레코드에 삭제 표시를 한다. 이미 지워진 것에 다시 해도 달라지는 것이 없다. */
export async function markDeleted(fetchFn: typeof fetch, cfg: DataConfig, kind: RecordKind, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const list = keys.map((k) => `"${k.replaceAll('"', '')}"`).join(',')
  const query = `user_id=eq.${cfg.userId}&kind=eq.${kind}&key=in.(${encodeURIComponent(list)})`
  await send(fetchFn, 'delete', `${cfg.url}/rest/v1/records?${query}`, {
    method: 'PATCH',
    headers: headers(cfg, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ deleted: true }),
  })
}

export interface BatchMeal {
  key: string
  meal: MealEntry
  deleted: boolean
}

/** 디스코드에서 한 번에 기록한 식사 묶음을 찾는다. 이미 지워진 것도 함께 돌려준다. */
export async function findMealsByBatch(fetchFn: typeof fetch, cfg: DataConfig, batch: string): Promise<BatchMeal[]> {
  const query = `select=key,data,deleted&user_id=eq.${cfg.userId}&kind=eq.meal&data->>batch=eq.${encodeURIComponent(batch)}`
  const res = await send(fetchFn, 'find', `${cfg.url}/rest/v1/records?${query}`, { method: 'GET', headers: headers(cfg) })
  const out: BatchMeal[] = []
  for (const row of await rowsOf(res, 'find')) {
    const meal = asMeal(row.data)
    if (meal && isStr(row.key)) out.push({ key: row.key, meal, deleted: row.deleted === true })
  }
  return out.sort((a, b) => a.meal.createdAt.localeCompare(b.meal.createdAt))
}

/**
 * 주인의 오늘 AI 횟수를 하나 쓴다(ai_take_for). 쓴 뒤의 횟수, 한도를 넘었으면 -1.
 * 확인하지 못했으면 null이고, 그때는 Claude를 부르지 않는다.
 */
export async function takeAiUse(fetchFn: typeof fetch, cfg: DataConfig, limit: number): Promise<number | null> {
  try {
    const res = await send(fetchFn, 'usage', `${cfg.url}/rest/v1/rpc/ai_take_for`, {
      method: 'POST',
      headers: headers(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_user: cfg.userId, p_limit: limit }),
    })
    const count: unknown = await res.json()
    return typeof count === 'number' && Number.isInteger(count) && (count === -1 || count >= 1) ? count : null
  } catch {
    return null
  }
}
