/**
 * 동기화 엔진. 기기 안의 기록(IndexedDB)이 원본이고, 서버는 기기들 사이의 중계소다.
 *  - 올리기: outbox에 표시된 레코드의 현재 상태를 서버에 덮어쓴다. 기기에 없으면 삭제 표시로 올린다.
 *  - 받기: 마지막으로 받은 시각 이후에 서버에서 바뀐 레코드를 기기에 반영한다.
 * 같은 레코드를 두 기기에서 고치면 서버에 나중에 도착한 쪽이 남는다.
 */
import {
  db,
  KV_LAST_SYNCED,
  KV_PROFILE,
  KV_SYNC_CURSOR,
  KV_SYNC_USER,
  type RecordKind,
} from '../db'
import { allRecordKeys } from '../storage'
import type { Checkin, Favorite, MealEntry, Profile, WeightEntry } from '../types'

export interface RemoteRow {
  kind: RecordKind
  key: string
  data: unknown
  deleted: boolean
  /** 서버가 찍은 변경 시각. 올릴 때는 비워 둔다. */
  updated_at?: string
}

/** 서버와의 통신. 실제 구현은 supabase.ts, 테스트에서는 메모리 구현을 쓴다. */
export interface Remote {
  push(rows: RemoteRow[]): Promise<void>
  /** since 이후(포함)에 바뀐 행을 변경 시각 순으로 모두 돌려준다. null이면 전부. */
  pull(since: string | null): Promise<RemoteRow[]>
}

const TABLES = [db.weights, db.meals, db.favorites, db.checkins, db.kv, db.outbox]

async function readLocal(kind: RecordKind, key: string): Promise<unknown> {
  switch (kind) {
    case 'profile':
      return (await db.kv.get(KV_PROFILE))?.value
    case 'weight':
      return db.weights.get(key)
    case 'meal':
      return db.meals.get(key)
    case 'favorite':
      return db.favorites.get(key)
    case 'checkin':
      return db.checkins.get(key)
  }
}

async function applyRow(row: RemoteRow): Promise<void> {
  const gone = row.deleted || row.data == null
  switch (row.kind) {
    case 'profile':
      await (gone ? db.kv.delete(KV_PROFILE) : db.kv.put({ key: KV_PROFILE, value: row.data as Profile }))
      return
    case 'weight':
      await (gone ? db.weights.delete(row.key) : db.weights.put(row.data as WeightEntry))
      return
    case 'meal':
      await (gone ? db.meals.delete(row.key) : db.meals.put(row.data as MealEntry))
      return
    case 'favorite':
      await (gone ? db.favorites.delete(row.key) : db.favorites.put(row.data as Favorite))
      return
    case 'checkin':
      await (gone ? db.checkins.delete(row.key) : db.checkins.put(row.data as Checkin))
      return
  }
}

const kvGet = async (key: string) => ((await db.kv.get(key))?.value as string | undefined) ?? null
const lastCursor = (rows: RemoteRow[]) => rows[rows.length - 1]?.updated_at ?? null

/** outbox에 표시된 변경을 서버에 올린다. 올린 건수를 돌려준다. */
export async function pushChanges(remote: Remote): Promise<number> {
  const entries = await db.outbox.toArray()
  if (entries.length === 0) return 0
  const rows: RemoteRow[] = []
  for (const e of entries) {
    const data = await readLocal(e.kind, e.key)
    rows.push({ kind: e.kind, key: e.key, data: data ?? null, deleted: data === undefined })
  }
  await remote.push(rows)
  // 올리는 사이에 다시 바뀐 레코드는 표시를 남겨 다음에 또 올린다.
  await db.transaction('rw', db.outbox, async () => {
    for (const e of entries) {
      const cur = await db.outbox.get([e.kind, e.key])
      if (cur && cur.rev === e.rev) await db.outbox.delete([e.kind, e.key])
    }
  })
  return rows.length
}

/** 서버의 새 변경을 기기에 반영한다. 반영한 건수를 돌려준다. */
export async function pullChanges(remote: Remote): Promise<number> {
  const rows = await remote.pull(await kvGet(KV_SYNC_CURSOR))
  let applied = 0
  await db.transaction('rw', TABLES, async () => {
    for (const row of rows) {
      // 아직 올리지 않은 변경이 있는 레코드는 기기 쪽을 그대로 둔다.
      if (await db.outbox.get([row.kind, row.key])) continue
      await applyRow(row)
      applied++
    }
    const cursor = lastCursor(rows)
    if (cursor) await db.kv.put({ key: KV_SYNC_CURSOR, value: cursor })
    await db.kv.put({ key: KV_LAST_SYNCED, value: new Date().toISOString() })
  })
  return applied
}

export async function syncOnce(remote: Remote): Promise<{ pushed: number; applied: number }> {
  const pushed = await pushChanges(remote)
  const applied = await pullChanges(remote)
  return { pushed, applied }
}

export type LinkChoice = 'remote' | 'merge'
export type LinkResult =
  | { status: 'linked' }
  | { status: 'conflict'; localCount: number; remoteCount: number }

/**
 * 이 기기를 계정에 연결한다. 로그인 직후 한 번 부른다.
 *  - 이미 같은 계정에 연결돼 있으면 아무것도 하지 않는다.
 *  - 기기와 계정 양쪽에 기록이 있으면 choice가 있어야 한다:
 *    'remote'는 기기 기록을 버리고 계정 기록으로 바꾸고, 'merge'는 둘을 합치되 겹치면 기기 쪽을 남긴다.
 */
export async function linkAccount(
  remote: Remote,
  userId: string,
  choice?: LinkChoice,
): Promise<LinkResult> {
  if ((await kvGet(KV_SYNC_USER)) === userId) return { status: 'linked' }

  const rows = await remote.pull(null)
  const remoteCount = rows.filter((r) => !r.deleted).length
  const localKeys = await allRecordKeys()

  if (remoteCount > 0 && localKeys.length > 0 && !choice) {
    return { status: 'conflict', localCount: localKeys.length, remoteCount }
  }

  await db.transaction('rw', TABLES, async () => {
    await db.outbox.clear()
    if (remoteCount > 0 && (choice === 'remote' || localKeys.length === 0)) {
      await Promise.all([
        db.weights.clear(),
        db.meals.clear(),
        db.favorites.clear(),
        db.checkins.clear(),
        db.kv.delete(KV_PROFILE),
      ])
      for (const row of rows) await applyRow(row)
      const cursor = lastCursor(rows)
      if (cursor) await db.kv.put({ key: KV_SYNC_CURSOR, value: cursor })
      else await db.kv.delete(KV_SYNC_CURSOR)
    } else {
      // 계정이 비어 있거나 합치기를 골랐다: 기기 기록 전부를 올릴 대상으로 표시한다.
      await db.outbox.bulkPut(localKeys.map(([kind, key], i) => ({ kind, key, rev: i })))
      await db.kv.delete(KV_SYNC_CURSOR)
    }
    await db.kv.put({ key: KV_SYNC_USER, value: userId })
  })
  return { status: 'linked' }
}

/** 계정 연결을 끊는다. 기기의 기록은 그대로 둔다. */
export async function unlinkAccount(): Promise<void> {
  await db.kv.bulkDelete([KV_SYNC_USER, KV_SYNC_CURSOR, KV_LAST_SYNCED])
}

export const getLinkedUser = () => kvGet(KV_SYNC_USER)
export const getLastSyncedAt = () => kvGet(KV_LAST_SYNCED)
