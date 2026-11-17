/**
 * 저장 계층. 화면과 스토어는 Dexie를 직접 만지지 않고 이 모듈만 쓴다.
 * 모든 쓰기는 같은 트랜잭션 안에서 outbox에 "이 레코드가 바뀌었다"는 표시를 남기고,
 * 동기화 엔진(src/sync/engine.ts)이 그 표시를 보고 서버에 올린다.
 */
import { db, KV_LAST_BACKUP, KV_PROFILE, type RecordKind } from './db'
import type { BackupFile, Checkin, Favorite, MealEntry, Profile, WeightEntry } from './types'

export interface Snapshot {
  profile: Profile | null
  weights: WeightEntry[]
  meals: MealEntry[]
  favorites: Favorite[]
  checkins: Checkin[]
  lastBackupAt: string | null
}

const DATA_TABLES = [db.weights, db.meals, db.favorites, db.checkins, db.kv, db.outbox]

let rev = 0
const nextRev = () => Date.now() * 1000 + (rev++ % 1000)

const listeners = new Set<() => void>()
/** 기기 안의 기록이 바뀔 때마다 불린다. 해제 함수를 돌려준다. */
export function onLocalChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const notify = () => listeners.forEach((cb) => cb())

type Mark = [RecordKind, string]
const mark = (marks: Mark[]) =>
  db.outbox.bulkPut(marks.map(([kind, key]) => ({ kind, key, rev: nextRev() })))

/** 쓰기와 outbox 표시를 한 트랜잭션으로 묶는다. */
async function write(marks: Mark[], fn: () => Promise<unknown>): Promise<void> {
  await db.transaction('rw', DATA_TABLES, async () => {
    await fn()
    await mark(marks)
  })
  notify()
}

export async function loadAll(): Promise<Snapshot> {
  const [profile, weights, meals, favorites, checkins, lastBackup] = await Promise.all([
    db.kv.get(KV_PROFILE),
    db.weights.orderBy('date').toArray(),
    db.meals.toArray(),
    db.favorites.toArray(),
    db.checkins.orderBy('date').toArray(),
    db.kv.get(KV_LAST_BACKUP),
  ])
  return {
    profile: (profile?.value as Profile | undefined) ?? null,
    weights,
    meals,
    favorites,
    checkins,
    lastBackupAt: (lastBackup?.value as string | undefined) ?? null,
  }
}

export const saveProfile = (p: Profile) =>
  write([['profile', 'profile']], () => db.kv.put({ key: KV_PROFILE, value: p }))
export const putWeight = (w: WeightEntry) => write([['weight', w.date]], () => db.weights.put(w))
export const deleteWeight = (date: string) => write([['weight', date]], () => db.weights.delete(date))
export const putMeal = (m: MealEntry) => write([['meal', m.id]], () => db.meals.put(m))
export const deleteMeal = (id: string) => write([['meal', id]], () => db.meals.delete(id))
export const putFavorite = (f: Favorite) => write([['favorite', f.id]], () => db.favorites.put(f))
export const deleteFavorite = (id: string) => write([['favorite', id]], () => db.favorites.delete(id))
export const putCheckin = (c: Checkin) => write([['checkin', c.date]], () => db.checkins.put(c))
export const setLastBackupAt = (iso: string) => db.kv.put({ key: KV_LAST_BACKUP, value: iso })

/** 기기에 있는 모든 레코드의 (종류, 키) 목록. */
export async function allRecordKeys(): Promise<Mark[]> {
  const [profile, weights, meals, favorites, checkins] = await Promise.all([
    db.kv.get(KV_PROFILE),
    db.weights.toCollection().primaryKeys(),
    db.meals.toCollection().primaryKeys(),
    db.favorites.toCollection().primaryKeys(),
    db.checkins.toCollection().primaryKeys(),
  ])
  return [
    ...(profile ? ([['profile', 'profile']] as Mark[]) : []),
    ...weights.map((k): Mark => ['weight', k]),
    ...meals.map((k): Mark => ['meal', k]),
    ...favorites.map((k): Mark => ['favorite', k]),
    ...checkins.map((k): Mark => ['checkin', k]),
  ]
}

async function clearRecords(): Promise<void> {
  await Promise.all([
    db.weights.clear(),
    db.meals.clear(),
    db.favorites.clear(),
    db.checkins.clear(),
    db.kv.delete(KV_PROFILE),
  ])
}

export async function exportBackup(): Promise<BackupFile> {
  const s = await loadAll()
  return {
    app: 'trend-diet',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: s.profile,
    weights: s.weights,
    meals: s.meals,
    favorites: s.favorites,
    checkins: s.checkins,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isDate = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** 백업 파일 내용을 검증한다. 형식이 맞지 않으면 사유를 담아 예외를 던진다. */
export function parseBackup(raw: unknown): BackupFile {
  const fail = (why: string): never => {
    throw new Error(`백업 파일 형식이 올바르지 않아요: ${why}`)
  }
  if (typeof raw !== 'object' || raw === null) fail('객체가 아님')
  const o = raw as Record<string, unknown>
  if (o.app !== 'trend-diet') fail('이 앱의 백업 파일이 아님')
  if (o.version !== 1) fail(`지원하지 않는 버전 ${String(o.version)}`)
  for (const k of ['weights', 'meals', 'favorites', 'checkins'] as const) {
    if (!Array.isArray(o[k])) fail(`${k} 항목 없음`)
  }
  const weights = o.weights as WeightEntry[]
  const meals = o.meals as MealEntry[]
  const favorites = o.favorites as Favorite[]
  const checkins = o.checkins as Checkin[]
  if (!weights.every((w) => w && isDate(w.date) && isNum(w.kg))) fail('체중 기록 손상')
  if (!meals.every((m) => m && isStr(m.id) && isDate(m.date) && isNum(m.kcal))) fail('식사 기록 손상')
  if (!favorites.every((f) => f && isStr(f.id) && isStr(f.name) && isNum(f.kcal))) fail('즐겨찾기 손상')
  if (!checkins.every((c) => c && isDate(c.date) && isNum(c.estimatedTdee) && isNum(c.targetKcal)))
    fail('체크인 기록 손상')
  const p = o.profile as Profile | null | undefined
  if (p != null && !(isNum(p.heightCm) && isNum(p.birthYear) && (p.sex === 'M' || p.sex === 'F')))
    fail('프로필 손상')
  return {
    app: 'trend-diet',
    version: 1,
    exportedAt: isStr(o.exportedAt) ? o.exportedAt : new Date().toISOString(),
    profile: p ?? null,
    weights,
    meals,
    favorites,
    checkins,
  }
}

/**
 * 기존 기록을 모두 지우고 백업 내용으로 교체한다.
 * 지워진 것과 새로 들어온 것 모두 outbox에 표시해 서버에도 같은 교체가 반영되게 한다.
 */
export async function restoreBackup(b: BackupFile): Promise<void> {
  await db.transaction('rw', DATA_TABLES, async () => {
    await mark(await allRecordKeys())
    await clearRecords()
    await db.kv.delete(KV_LAST_BACKUP)
    await db.weights.bulkPut(b.weights)
    await db.meals.bulkPut(b.meals)
    await db.favorites.bulkPut(b.favorites)
    await db.checkins.bulkPut(b.checkins)
    if (b.profile) await db.kv.put({ key: KV_PROFILE, value: b.profile })
    await mark(await allRecordKeys())
  })
  notify()
}

/** 기록을 모두 지운다. 계정에 연결돼 있으면 다음 동기화 때 서버에서도 지워진다. */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', DATA_TABLES, async () => {
    await mark(await allRecordKeys())
    await clearRecords()
    await db.kv.delete(KV_LAST_BACKUP)
  })
  notify()
}
