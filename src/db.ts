import Dexie, { type Table } from 'dexie'
import type { Checkin, Favorite, MealEntry, Profile, WeightEntry } from './types'

export interface KV {
  key: string
  value: unknown
}

export class AppDB extends Dexie {
  weights!: Table<WeightEntry, string>
  meals!: Table<MealEntry, string>
  favorites!: Table<Favorite, string>
  checkins!: Table<Checkin, string>
  kv!: Table<KV, string>

  constructor(name = 'trend-diet') {
    super(name)
    this.version(1).stores({
      weights: 'date',
      meals: 'id, date',
      favorites: 'id',
      checkins: 'date',
      kv: 'key',
    })
  }
}

export const db = new AppDB()

export const KV_PROFILE = 'profile'
export const KV_LAST_BACKUP = 'lastBackupAt'

export type { Profile }
