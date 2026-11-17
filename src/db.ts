import Dexie, { type Table } from 'dexie'
import type { Checkin, Favorite, MealEntry, Profile, WeightEntry } from './types'

export interface KV {
  key: string
  value: unknown
}

/** 동기화 대상 레코드의 종류. */
export type RecordKind = 'profile' | 'weight' | 'meal' | 'favorite' | 'checkin'

/** 아직 서버에 올리지 않은 변경. 내용은 담지 않고 어떤 레코드가 바뀌었는지만 적는다. */
export interface OutboxEntry {
  kind: RecordKind
  key: string
  /** 같은 레코드가 올리는 도중에 또 바뀌었는지 구분하기 위한 값. */
  rev: number
}

export class AppDB extends Dexie {
  weights!: Table<WeightEntry, string>
  meals!: Table<MealEntry, string>
  favorites!: Table<Favorite, string>
  checkins!: Table<Checkin, string>
  kv!: Table<KV, string>
  outbox!: Table<OutboxEntry, [RecordKind, string]>

  constructor(name = 'trend-diet') {
    super(name)
    this.version(1).stores({
      weights: 'date',
      meals: 'id, date',
      favorites: 'id',
      checkins: 'date',
      kv: 'key',
    })
    this.version(2).stores({
      outbox: '[kind+key]',
    })
  }
}

export const db = new AppDB()

export const KV_PROFILE = 'profile'
export const KV_LAST_BACKUP = 'lastBackupAt'
/** 이 기기의 기록이 연결된 계정 id. */
export const KV_SYNC_USER = 'syncUser'
/** 서버에서 마지막으로 받아 온 변경의 시각. */
export const KV_SYNC_CURSOR = 'syncCursor'
export const KV_LAST_SYNCED = 'lastSyncedAt'

export type { Profile }
